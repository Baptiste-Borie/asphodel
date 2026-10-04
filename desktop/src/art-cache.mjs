import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  constructor(directory, seedDirectory, fetchImage = globalThis.fetch) {
    this.directory = directory;
    this.seedDirectory = seedDirectory;
    this.fetchImage = fetchImage;
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
      try { return await readFile(join(directory, key)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const response = await this.fetchImage(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Artwork download failed (${response.status})`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 5_000_000 || !/^image\/(jpeg|png)/.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid artwork response');
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${key}.tmp`);
    await writeFile(temporary, data);
    await rename(temporary, join(this.directory, key));
    return data;
  }
}
