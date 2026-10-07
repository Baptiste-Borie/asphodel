import { createReadStream } from 'node:fs';
import { stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { setImmediate } from 'node:timers/promises';
import { DeckLabSearch } from './deck-lab-search.js';

/** Streaming verification keeps malformed/partial bulk files away from the installed catalog. */
export async function validateCatalogBulk(path: string, printing: boolean, progress: (cards: number) => void = () => {}) {
  const input = createReadStream(path), gzip = createGunzip();
  input.on('error', error => gzip.destroy(error));
  input.pipe(gzip);
  let buffer = '', bytes = 0, cards = 0;
  const parse = (line: string) => {
    if (!line.trim()) return;
    const card = JSON.parse(line) as Record<string, unknown>;
    const text = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max;
    if (!card || !text(card.id, 100) || !text(card.name, 1000)
      || (printing && (!text(card.set, 20) || !text(card.set_name, 1000) || !text(card.collector_number, 100) || !text(card.lang, 8) || !text(card.rarity, 30)))
      || (card.cmc !== undefined && (typeof card.cmc !== 'number' || !Number.isFinite(card.cmc)))
      || (card.color_identity !== undefined && (!Array.isArray(card.color_identity) || !card.color_identity.every(c => typeof c === 'string')))) throw new Error('Objet carte invalide dans le catalogue.');
    const optionalText = (value: unknown, max = 20000) => value === undefined || value === null || (typeof value === 'string' && value.length <= max);
    const stringArray = (value: unknown) => value === undefined || value === null || (Array.isArray(value) && value.length <= 20 && value.every(c => typeof c === 'string'));
    const image = (value: unknown) => value === undefined || value === null || (typeof value === 'object' && optionalText((value as {normal?:unknown}).normal, 4000));
    if (!['mana_cost','type_line','oracle_text','power','toughness','loyalty'].every(key => optionalText(card[key]))
      || !stringArray(card.colors) || !image(card.image_uris)
      || (card.card_faces !== undefined && card.card_faces !== null && (!Array.isArray(card.card_faces) || card.card_faces.length > 10
        || !card.card_faces.every(face => face && typeof face === 'object' && optionalText(face.name,1000) && optionalText(face.oracle_text) && optionalText(face.mana_cost) && image(face.image_uris))))
      || (card.all_parts !== undefined && card.all_parts !== null && (!Array.isArray(card.all_parts) || !card.all_parts.every(part => part && typeof part === 'object' && optionalText(part.name,1000))))) throw new Error('Métadonnées de carte invalides dans le catalogue.');
    cards++;
  };
  try {
    // Decode complete lines as UTF-8; chunk boundaries may split an accented character.
    gzip.setEncoding('utf8');
    for await (const chunk of gzip) {
      bytes += Buffer.byteLength(chunk as string);
      if (bytes > 12 * 1024 ** 3) throw new Error('Catalogue décompressé trop volumineux.');
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        if (newline > 2_000_000) throw new Error('Ligne du catalogue trop volumineuse.');
        parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        if (cards % 1000 === 0) { progress(cards); await setImmediate(); }
      }
      if (buffer.length > 2_000_000) throw new Error('Ligne du catalogue trop volumineuse.');
    }
    parse(buffer);
    if (!cards) throw new Error('Le catalogue ne contient aucune carte.');
    progress(cards); return cards;
  } catch (error) { throw Object.assign(new Error(error instanceof Error ? error.message : 'Catalogue illisible.'), { code: 'CATALOG_INVALID' }); }
  finally { input.destroy(); gzip.destroy(); }
}

export async function prepareCatalog(directory: string, progress: (phase: string, cards: number) => void = () => {}) {
  await validateCatalogBulk(join(directory, 'scryfall-oracle-cards.jsonl.gz'), false, n => progress('verifying-oracle', n));
  await validateCatalogBulk(join(directory, 'scryfall-default-cards.jsonl.gz'), true, n => progress('verifying-printings', n));
  const indexPath = join(directory, 'deck-lab-search.sqlite');
  for (const suffix of ['', '-wal', '-shm']) await rm(indexPath + suffix, { force: true });
  const search = new DeckLabSearch({ bulkPath: join(directory, 'scryfall-default-cards.jsonl.gz'), indexPath, onProgress: n => progress('indexing', n) });
  try {
    const catalog = await search.getCatalog();
    if (!catalog.printings || !(await stat(indexPath)).size) throw new Error('Index du catalogue vide.');
    return catalog;
  } finally { await search.close(); }
}
