import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, statfs, readdir, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { generationPaths, generationId, selectCatalog, CATALOG_FILES } from './catalog-paths.mjs';
import { isTrustedDesktopFrame } from './display-preferences.mjs';
const TYPES = ['oracle_cards', 'default_cards'];
const MAX_BULK_BYTES = 2 * 1024 ** 3;
const abort = () => Object.assign(new Error('Téléchargement interrompu.'), { name: 'AbortError' });
const message = error => error.code === 'ENOSPC' || /database or disk is full/i.test(error.message ?? '') ? 'Le disque est plein. Libère de l’espace puis reprends.' : error.message;
export async function atomicCatalogWrite(file, value) {
  const temp = file + '.tmp';
  try { await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, file); }
  catch (error) { await rm(temp, { force: true }).catch(() => {}); throw error; }
}
export function bulkMetadata(value, type) {
  if (!value || value.type !== type || !TYPES.includes(type) || typeof value.jsonl_download_uri !== 'string'
    || !Number.isSafeInteger(value.compressed_size) || value.compressed_size < 1 || value.compressed_size > MAX_BULK_BYTES
    || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) throw new Error('Scryfall n’a pas fourni de catalogue JSONL compressé valide.');
  const url = new URL(value.jsonl_download_uri);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.href.length > 4000
    || !['scryfall.io','scryfall.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw new Error('Adresse du catalogue refusée.');
  return { type, url: url.href, bytes: value.compressed_size, updatedAt: value.updated_at, etag: null };
}
async function bytes(file) { return (await stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))?.size ?? 0; }
async function directoryBytes(root) {
  let size = 0;
  for (const entry of await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) size += await directoryBytes(path);
    else if (entry.isFile()) size += await bytes(path);
  }
  return size;
}

/** Downloads never overwrite the files used by the running backend. */
export class CatalogLibrary {
  constructor({ data, fetch: fetcher = globalThis.fetch, prepare, active, onError = console.error }) {
    this.data = data; this.fetcher = fetcher; this.prepare = prepare; this.onError = onError;
    this.jobFile = join(data, 'catalog-download.json'); this.manifestFile = join(data, 'catalog-current.json');
    this.active = active; this.latest = null; this.job = null; this.running = false; this.checking = false; this.closed = false;
    this.lastCheck = null; this.error = null; this.serial = Promise.resolve();
    this.ready = this.initialize();
  }
  exclusive(work) { const next = this.serial.then(work); this.serial = next.catch(() => {}); return next; }
  async initialize() {
    await mkdir(this.data, { recursive: true });
    this.installed = await selectCatalog(this.data);
    this.active ??= this.installed;
    try {
      const value = JSON.parse(await readFile(this.jobFile, 'utf8'));
      if (value.version !== 1 || (value.latest !== null && (!Array.isArray(value.latest) || value.latest.length !== 2))) throw new Error('Réglages de téléchargement invalides.');
      this.latest = value.latest?.map((asset, i) => bulkMetadata({ type: asset.type, jsonl_download_uri: asset.url, compressed_size: asset.bytes, updated_at: asset.updatedAt }, TYPES[i])) ?? null;
      this.lastCheck = typeof value.lastCheck === 'string' ? value.lastCheck : null;
      this.error = typeof value.error === 'string' ? value.error.slice(0, 2000) : null;
      if (value.job) {
        const job = value.job;
        if (!generationId(job.generation) || !['downloading','verifying','indexing','activating','paused','completed','canceled'].includes(job.status) || !Array.isArray(job.assets) || job.assets.length !== 2) throw new Error('Téléchargement sauvegardé invalide.');
        const assets = job.assets.map((asset, i) => ({ ...bulkMetadata({ type: asset.type, jsonl_download_uri: asset.url, compressed_size: asset.bytes, updated_at: asset.updatedAt }, TYPES[i]), etag: typeof asset.etag === 'string' && asset.etag.length < 500 ? asset.etag : null }));
        this.job = { generation: job.generation, assets, status: ['completed','canceled'].includes(job.status) ? job.status : 'paused', startedAt: job.startedAt, phase: '', cards: 0,
          error: ['completed','canceled'].includes(job.status) ? null : typeof job.error === 'string' ? job.error.slice(0, 2000) : 'Reprends le téléchargement pour terminer cette version.' };
        // A crash after the atomic manifest switch is a completed installation, not a fresh download.
        if (this.installed.generation === job.generation) this.job.status = 'completed';
      }
    } catch (error) { if (error.code !== 'ENOENT') { this.error = 'Les réglages du téléchargement sont illisibles. Le catalogue installé reste disponible ; vérifie les mises à jour pour recommencer.'; this.onError(error); } }
  }
  save() { return this.exclusive(() => atomicCatalogWrite(this.jobFile, { version: 1, latest: this.latest, lastCheck: this.lastCheck, error: this.error, job: this.job })); }
  async state() {
    await this.ready; await this.serial;
    const installedBytes = await directoryBytes(join(this.data, 'catalogs'));
    const old = await this.oldGenerations();
    const reclaimableBytes = (await Promise.all(old.map(path => directoryBytes(path)))).reduce((n, value) => n + value, 0);
    const legacyBytes = await Promise.all(Object.values(CATALOG_FILES).map(name => bytes(join(this.data, name))));
    const available = await statfs(this.data).then(s => s.bavail * s.bsize).catch(() => null);
    const printingBytes = await bytes(this.active.paths.printing);
    let job = null;
    if (this.job) {
      const paths = generationPaths(this.data, this.job.generation);
      const received = await Promise.all(this.job.assets.map((asset, i) => bytes((i ? paths.printing : paths.oracle)).then(n => n || bytes((i ? paths.printing : paths.oracle) + '.part'))));
      job = { generation: this.job.generation, status: this.job.status, startedAt: this.job.startedAt, phase: this.job.phase, cards: this.job.cards,
        receivedBytes: received.reduce((sum, n) => sum + n, 0), totalBytes: this.job.assets.reduce((sum, a) => sum + a.bytes, 0), error: this.job.error, active: this.running };
    }
    return { installed: printingBytes > 0, updatedAt: this.active.info?.updatedAt ?? (printingBytes ? (await stat(this.active.paths.printing)).mtime.toISOString() : null),
      printings: this.active.info?.printings ?? null, reclaimableBytes, usedBytes: installedBytes + legacyBytes.reduce((sum, n) => sum + n, 0), availableBytes: available,
      needsRestart: this.installed.generation !== this.active.generation, latest: this.latest ? { updatedAt: this.latest[1].updatedAt, bytes: this.latest.reduce((sum, a) => sum + a.bytes, 0) } : null,
      lastCheck: this.lastCheck, checking: this.checking, error: this.error ?? this.installed.recoveryError, job };
  }
  async check() {
    await this.ready;
    if (this.closed || this.checking || this.running || this.controlling) throw new Error('Attends la fin de l’opération en cours.');
    this.checking = true; this.error = null; this.lastCheck = new Date().toISOString();
    try {
      const metadata = [];
      for (const type of TYPES) {
        if (metadata.length) await new Promise(r => setTimeout(r, 200));
        const response = await this.fetcher(`https://api.scryfall.com/bulk-data/${type}`, { headers: { 'User-Agent': 'Asphodel/0.1.9 (https://github.com/Baptiste-Borie/asphodel)', Accept: 'application/json' }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
        if (!response.ok) throw new Error(`Vérification Scryfall impossible (HTTP ${response.status}). Réessaie plus tard.`);
        if (Number(response.headers.get('content-length')) > 100_000) throw new Error('Réponse Scryfall trop volumineuse.');
        const text = await response.text(); if (text.length > 100_000) throw new Error('Réponse Scryfall trop volumineuse.');
        metadata.push(bulkMetadata(JSON.parse(text), type));
      }
      this.latest = metadata; this.lastCheck = new Date().toISOString(); await this.save();
    } catch (error) { this.error = message(error); await this.save().catch(this.onError); throw error; }
    finally { this.checking = false; }
    return this.state();
  }
  async start() {
    await this.ready;
    if (this.closed || this.running || this.checking || this.controlling || !this.latest) throw new Error('Vérifie d’abord les mises à jour et attends la fin des opérations.');
    if (this.job && !['completed','canceled'].includes(this.job.status)) throw new Error('Reprends ou annule le téléchargement précédent.');
    if (this.installed.generation !== this.active.generation) throw new Error('Relance Asphodel pour utiliser la version préparée.');
    const previous = this.job;
    this.job = { generation: randomUUID(), assets: structuredClone(this.latest), startedAt: new Date().toISOString(), status: 'downloading', phase: '', cards: 0, error: null };
    try { await mkdir(generationPaths(this.data, this.job.generation).directory, { recursive: true }); await this.save(); }
    catch (error) { this.job = previous; throw error; }
    this.run(); return this.state();
  }
  async download(asset, file, signal) {
    if (await bytes(file) === asset.bytes) return;
    const part = file + '.part'; let offset = await bytes(part);
    if (offset > asset.bytes || !asset.etag || asset.etag.startsWith('W/')) offset = 0;
    if (offset === asset.bytes) { await rename(part, file); return; }
    const headers = { 'User-Agent': 'Asphodel/0.1.9 (https://github.com/Baptiste-Borie/asphodel)', Accept: 'application/gzip,*/*;q=0.8', 'Accept-Encoding': 'identity' };
    if (offset) { headers.Range = `bytes=${offset}-`; headers['If-Range'] = asset.etag; }
    const requestController = new AbortController();
    const relayAbort = () => requestController.abort(signal.reason);
    signal.addEventListener('abort', relayAbort, { once: true });
    if (signal.aborted) relayAbort();
    const headerTimeout = setTimeout(() => requestController.abort(new Error('Le serveur du catalogue ne répond pas. Reprends pour réessayer.')), 30_000);
    try {
    let response;
    try { response = await this.fetcher(asset.url, { headers, signal: requestController.signal, redirect: 'error' }); }
    finally { clearTimeout(headerTimeout); }
    if (!response.ok || !response.body) throw new Error(`Téléchargement du catalogue impossible (HTTP ${response.status}).`);
    if (!['identity',null].includes(response.headers.get('content-encoding'))) { await response.body.cancel(); throw new Error('Le serveur a changé le format compressé du catalogue.'); }
    const etag = response.headers.get('etag');
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
      if (!offset || !range || Number(range[1]) !== offset || Number(range[2]) !== asset.bytes - 1 || Number(range[3]) !== asset.bytes || etag !== asset.etag) { await response.body.cancel(); throw new Error('La reprise du catalogue est incohérente. Annule puis recommence.'); }
    } else if (response.status === 200) offset = 0;
    else { await response.body.cancel(); throw new Error('Réponse de téléchargement inattendue.'); }
    asset.etag = etag; await this.save();
    const handle = await open(part, offset ? 'a' : 'w'); const reader = response.body.getReader(); let received = offset;
    const cancelRead = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', cancelRead, { once: true });
    try {
      while (true) {
        if (signal.aborted) throw abort();
        const read = reader.read();
        // An idle connection is interrupted without throwing away the completed partial file.
        let timer; const timeout = new Promise((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error('Le téléchargement ne répond plus. Reprends pour réessayer.')); }, 30_000); });
        let chunk; try { chunk = await Promise.race([read, timeout]); } finally { clearTimeout(timer); }
        if (chunk.done) break;
        received += chunk.value.length; if (received > asset.bytes) throw new Error('Le catalogue dépasse la taille annoncée.');
        await handle.writeFile(chunk.value);
      }
      if (signal.aborted) throw abort();
      if (received !== asset.bytes) throw new Error('Téléchargement incomplet. Reprends les octets manquants.');
      await handle.sync();
    } finally { signal.removeEventListener('abort', cancelRead); await reader.cancel().catch(() => {}); reader.releaseLock(); await handle.close(); }
    await rename(part, file);
    } finally { clearTimeout(headerTimeout); signal.removeEventListener('abort', relayAbort); }
  }
  run() {
    if (this.running || this.closed) return;
    this.running = true; this.controller = new AbortController(); const job = this.job, signal = this.controller.signal;
    this.work = (async () => {
      const paths = generationPaths(this.data, job.generation);
      await this.download(job.assets[0], paths.oracle, signal);
      if (signal.aborted) throw abort();
      await this.download(job.assets[1], paths.printing, signal);
      if (signal.aborted) throw abort();
      job.status = 'verifying'; await this.save();
      const catalog = await this.prepare(paths.directory, (phase, cards) => { job.phase = phase; job.cards = cards; job.status = phase === 'indexing' ? 'indexing' : 'verifying'; }, signal);
      if (signal.aborted) throw abort();
      const info = { updatedAt: job.assets[1].updatedAt, printings: catalog.printings, installedAt: new Date().toISOString() };
      await atomicCatalogWrite(join(paths.directory, 'catalog-info.json'), info);
      if (signal.aborted) throw abort();
      job.status = 'activating';
      // Preserve a separate manifest as well as all old generation files. One rename activates
      // a complete, verified pair and its derived index for the next launch.
      if (this.installed.generation) await atomicCatalogWrite(join(this.data, 'catalog-current.previous.json'), { version: 1, current: this.installed.generation, previous: null });
      await atomicCatalogWrite(this.manifestFile, { version: 1, current: job.generation, previous: this.installed.generation });
      this.installed = { generation: job.generation, paths, info, recoveryError: null }; job.status = 'completed'; job.error = null;
    })().catch(async error => {
      if (job.status !== 'canceled') job.status = 'paused';
      if (error.name !== 'AbortError') job.error = message(error);
      if (error.code === 'CATALOG_INVALID') {
        const paths = generationPaths(this.data, job.generation);
        for (const path of [paths.oracle, paths.printing, paths.index]) await rm(path, { force: true }).catch(this.onError);
      }
    }).finally(async () => { this.running = false; await this.save().catch(error => { job.error = message(error); this.onError(error); }); });
  }
  async control(action) {
    if (!['pause','resume','cancel'].includes(action)) throw new Error('Commande de catalogue invalide.'); await this.ready;
    if (this.controlling || this.checking || this.job?.status === 'activating') throw new Error('Attends la fin de l’opération en cours.');
    if (!this.job || ['completed','canceled'].includes(this.job.status)) throw new Error('Aucun téléchargement à reprendre.');
    this.controlling = true;
    try {
      if (action === 'resume') {
        if (this.running || this.closed) throw new Error('Attends la fin de l’opération en cours.');
        const previous = { status: this.job.status, error: this.job.error };
        this.job.status = 'downloading'; this.job.error = null;
        try { await this.save(); } catch (error) { Object.assign(this.job, previous); throw error; }
        this.run();
      } else {
        this.job.status = action === 'pause' ? 'paused' : 'canceled'; this.controller?.abort();
        await this.work; await this.save();
        if (action === 'cancel') await rm(generationPaths(this.data, this.job.generation).directory, { recursive: true, force: true });
      }
    } finally { this.controlling = false; }
    return this.state();
  }
  async oldGenerations() {
    const protectedIds = new Set([this.installed.generation, this.active.generation, this.job?.generation]);
    try { const manifest = JSON.parse(await readFile(this.manifestFile, 'utf8')); if (generationId(manifest.previous)) protectedIds.add(manifest.previous); } catch {}
    return (await readdir(join(this.data, 'catalogs'), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; }))
      .filter(entry => entry.isDirectory() && generationId(entry.name) && !protectedIds.has(entry.name)).map(entry => generationPaths(this.data, entry.name).directory);
  }
  async cleanup() {
    await this.ready;
    if (this.running || this.checking || this.controlling) throw new Error('Attends la fin de l’opération en cours.');
    this.controlling = true;
    try { for (const path of await this.oldGenerations()) await rm(path, { recursive: true, force: true }); }
    finally { this.controlling = false; }
    return this.state();
  }
  async close() { this.closed = true; await this.ready; this.controller?.abort(); await this.work; await this.save(); }
}
export function installCatalogCommands({ ipcMain, window, library, restart }) {
  const contents = window.webContents;
  const commands = { 'asphodel:catalog-state': () => library.state(), 'asphodel:catalog-check': () => library.check(), 'asphodel:catalog-install': () => library.start(), 'asphodel:catalog-control': action => library.control(action), 'asphodel:catalog-cleanup': () => library.cleanup(), 'asphodel:catalog-restart': () => restart() };
  for (const [channel, action] of Object.entries(commands)) ipcMain.handle(channel, (event, ...args) => {
    if (contents.isDestroyed() || !isTrustedDesktopFrame(event, contents)) throw new Error('Desktop catalog command refused'); return action(...args);
  });
  window.once('closed', () => { for (const channel of Object.keys(commands)) ipcMain.removeHandler(channel); });
}
