import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ArtCache } from '../src/art-cache.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const database = new DatabaseSync(join(desktop, '../backend/data/asphodel.sqlite'), { readOnly: true });
let urls;
try { urls = database.prepare('SELECT DISTINCT image_uri FROM cards WHERE image_uri IS NOT NULL').all().map(row => row.image_uri); }
finally { database.close(); }
const cache = new ArtCache(join(desktop, '.cache/card-art'));
let failures = 0;
for (const [index, url] of urls.entries()) {
  try { await cache.get(url); }
  catch (error) { failures++; console.error(`${url}: ${error.message}`); }
  if ((index + 1) % 25 === 0) console.log(`${index + 1}/${urls.length} illustrations préparées`);
}
console.log(`${urls.length - failures}/${urls.length} illustrations disponibles hors ligne pour le prochain build.`);
if (failures) process.exitCode = 1;
