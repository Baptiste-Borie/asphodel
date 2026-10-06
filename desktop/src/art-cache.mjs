import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export function byteSafeArtworkHeaders(headers = {}) {
  // Electron 44's session.fetch converts Chromium response headers with
  // Headers.set outside its promise's error handler. A decoded Unicode
  // filename (e.g. Island ★.jpg) therefore throws an uncaught ByteString
  // error. Artwork is keyed by URL, so discard Content-Disposition filenames
  // altogether (Chromium and Node may decode these differently). Keep safe headers,
  // including content type, compression, caching and security headers.
  return Object.fromEntries(Object.entries(headers).filter(([name, values]) =>
    name.toLowerCase() !== 'content-disposition' && !/[^\u0000-\u00ff]/.test(name) &&
    [values].flat().every(value => !/[^\u0000-\u00ff]/.test(value))));
}

export function installArtworkHeaderGuard(downloads) {
  // Run before session.fetch builds its Response, on the dedicated artwork
  // session only. A catch around await fetch cannot catch that native event.
  downloads.webRequest.onHeadersReceived({ urls: ['https://cards.scryfall.io/*'] }, (details, callback) => {
    callback({ responseHeaders: byteSafeArtworkHeaders(details.responseHeaders) });
  });
}

export function artKey(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'cards.scryfall.io' || url.port || url.username || url.password || !/\.(jpg|png)$/.test(url.pathname)) {
    throw new Error('Unsupported card artwork URL');
  }
  // Scryfall's timestamp query does not change the printing/image identity.
  return createHash('sha256').update(url.origin + url.pathname).digest('hex') + (url.pathname.endsWith('.png') ? '.png' : '.jpg');
}

export class ArtCache {
  pending = new Map();
  constructor(directory, seedDirectory, fetchImage = globalThis.fetch, hooks = {}) {
    this.directory = directory;
    this.seedDirectory = seedDirectory;
    this.fetchImage = fetchImage;
    this.hooks = hooks;
  }
  async get(url) {
    const key = artKey(url);
    if (!this.pending.has(key)) this.pending.set(key, this.load(url, key).finally(() => this.pending.delete(key)));
    return this.pending.get(key);
  }
  async response(url, method = 'GET') {
    if (method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const data = await this.get(url);
    return new Response(method === 'HEAD' ? null : data, { headers: {
      'content-type': new URL(url).pathname.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'cache-control': 'public, max-age=31536000',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    } });
  }
  async load(url, key) {
    for (const directory of [this.directory, this.seedDirectory].filter(Boolean)) {
      try { const data = await readFile(join(directory, key)); if(data.length){this.hooks.read?.(key);return data;} }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const response = await this.fetchImage(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Artwork download failed (${response.status})`);
    if (!/^image\/(jpeg|png)(?:;|$)/.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length')) > 5_000_000) throw new Error('Invalid artwork response');
    const reader = response.body?.getReader(), chunks = []; let size = 0;
    if (!reader) throw new Error('Empty artwork response');
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
        if (size > 5_000_000) { await reader.cancel(); throw new Error('Artwork exceeds 5 MB'); } chunks.push(Buffer.from(value)); }
    } finally { reader.releaseLock(); }
    if (!size) throw new Error('Empty artwork response');
    const data = Buffer.concat(chunks);
    if (this.hooks.store) await this.hooks.store(key, data, () => this.write(key, data));
    else await this.write(key, data);
    return data;
  }
  async write(key, data) {
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${key}.tmp`);
    try { await writeFile(temporary, data); await rename(temporary, join(this.directory, key)); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
}
