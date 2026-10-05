import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class DisplayPreferences {
  #fullscreen = true;
  constructor(file, onError = console.error) {
    this.file = file;
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      if (stored.version !== 1 || typeof stored.fullscreen !== 'boolean') throw new Error('Invalid display preferences');
      this.#fullscreen = stored.fullscreen;
    } catch (error) {
      if (error.code !== 'ENOENT') onError(error);
    }
  }
  get fullscreen() { return this.#fullscreen; }
  setFullscreen(fullscreen) {
    if (typeof fullscreen !== 'boolean') throw new TypeError('Fullscreen must be a boolean');
    // This tiny synchronous write serializes rapid shortcuts and completes
    // before quitting. Atomic replacement leaves the previous file intact
    // when a write fails; do not change the in-memory preference on failure.
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, fullscreen }), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
    this.#fullscreen = fullscreen;
  }
}

export function isTrustedDesktopFrame(event, contents) {
  if (event.sender !== contents || event.senderFrame !== contents.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'asphodel:' && url.host === 'app';
  } catch { return false; }
}
