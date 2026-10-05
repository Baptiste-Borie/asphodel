import { randomUUID } from 'node:crypto';
import { open, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function atomicWrite(file, value, raw = false) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(raw ? value : JSON.stringify(value), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}
export async function readBackup(file, codec) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > codec.MAX_BACKUP_BYTES) throw new Error('Le fichier doit être une sauvegarde Asphodel de moins de 64 Mio.');
    // Read a bounded buffer, including a byte beyond the limit if the file grows during the read.
    const chunks = []; let length = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      length += chunk.length;
      if (length > codec.MAX_BACKUP_BYTES) throw new Error('Sauvegarde trop volumineuse.');
      chunks.push(chunk);
    }
    return codec.parseLibraryBackup(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Ce fichier n’est pas une sauvegarde JSON lisible.');
    throw error;
  } finally { await handle.close(); }
}

/** Native file dialogs own paths; the renderer can only request these fixed commands. */
export class LibraryBackups {
  busy = false;
  chosen;
  constructor({ userData, version, codec, api, dialogs, getDisplay, setDisplay }) {
    Object.assign(this, { userData, version, codec, api, dialogs, getDisplay, setDisplay });
    this.pendingFile = join(userData, 'pending-library-restore.json');
  }
  async exclusive(action) {
    if (this.busy) throw new Error('Une opération de sauvegarde est déjà en cours.');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  async snapshot(storage) {
    return this.codec.parseLibraryBackup({
      format: 'asphodel-library', version: 1, createdAt: new Date().toISOString(), appVersion: this.version,
      library: await this.api.snapshot(), storage: this.codec.parseBackupStorage(storage), display: this.getDisplay(),
    });
  }
  save(storage) { return this.exclusive(async () => {
    const archive = await this.snapshot(storage);
    const file = await this.dialogs.save(`Asphodel-${archive.createdAt.slice(0,10)}.asphodel.json`);
    if (!file) return { canceled: true };
    await atomicWrite(file, archive);
    return { canceled: false, decks: archive.library.decks.length };
  }); }
  choose() { return this.exclusive(async () => {
    this.chosen = undefined;
    const file = await this.dialogs.open();
    if (!file) return null;
    this.chosen = await readBackup(file, this.codec);
    return { createdAt: this.chosen.createdAt, decks: this.chosen.library.decks.map(d => d.name),
      drafts: Object.keys(this.chosen.storage).filter(k => k.startsWith('asphodel.builder-draft.v1.')).length };
  }); }
  restore(storage) { return this.exclusive(async () => {
    if (!this.chosen) throw new Error('Choisis d’abord une sauvegarde.');
    const current = await this.snapshot(storage);
    if (!await this.dialogs.confirm(this.chosen, current.library.decks.length)) return { canceled: true };
    const rescue = join(this.userData, 'backups', `avant-restauration-${Date.now()}-${randomUUID()}.asphodel.json`);
    await atomicWrite(rescue, current);
    // A durable intent allows an interrupted restore to complete before the next renderer starts.
    // It stays until Chromium has flushed the corresponding storage and acknowledged it.
    await atomicWrite(this.pendingFile, this.chosen);
    try { await this.api.restore(this.chosen.library); }
    catch (error) {
      // A definite HTTP error means the backend transaction did not commit. A lost response is
      // ambiguous: keep the intent and require a restart, rather than reopening an old table.
      if (error.definite) await rm(this.pendingFile, { force: true });
      else return { canceled: false, restartRequired: true }; // reload retries the durable intent before mounting any table
      throw error;
    }
    this.chosen = undefined;
    return { canceled: false };
  }); }
  async pending() {
    try { return await readBackup(this.pendingFile, this.codec); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  resume() { return this.exclusive(async () => {
    const archive = await this.pending();
    if (archive) await this.api.restore(archive.library);
  }); }
  restoredStorage() { return this.exclusive(async () => {
    const archive = await this.pending();
    if (!archive) return null;
    await this.api.restore(archive.library);
    this.setDisplay(archive.display);
    return archive.storage;
  }); }
  async acknowledge() { await rm(this.pendingFile, { force: true }); }
}
