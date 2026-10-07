import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
export const CATALOG_FILES = { oracle: 'scryfall-oracle-cards.jsonl.gz', printing: 'scryfall-default-cards.jsonl.gz', index: 'deck-lab-search.sqlite' };
export const generationId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
export function generationPaths(data, id) {
  if (!generationId(id)) throw new Error('Version de catalogue invalide.');
  const directory = join(data, 'catalogs', id);
  return { directory, oracle: join(directory, CATALOG_FILES.oracle), printing: join(directory, CATALOG_FILES.printing), index: join(directory, CATALOG_FILES.index) };
}
export async function selectCatalog(data) {
  const legacy = { generation: null, paths: { directory: data, oracle: join(data, CATALOG_FILES.oracle), printing: join(data, CATALOG_FILES.printing), index: join(data, CATALOG_FILES.index) }, info: null };
  let recoveryError = null;
  for (const name of ['catalog-current.json', 'catalog-current.previous.json']) {
    try {
      const manifest = JSON.parse(await readFile(join(data, name), 'utf8'));
      if (manifest.version !== 1 || !generationId(manifest.current)) throw new Error('Manifest invalide');
      for (const id of [manifest.current, manifest.previous].filter(generationId)) {
        try {
          const paths = generationPaths(data, id);
          for (const file of [paths.oracle, paths.printing, paths.index]) { const entry = await stat(file); if (!entry.isFile() || !entry.size) throw new Error('Catalogue incomplet'); }
          const info = JSON.parse(await readFile(join(paths.directory, 'catalog-info.json'), 'utf8'));
          return { generation: id, paths, info, recoveryError };
        } catch { recoveryError = 'La dernière version est incomplète. Le catalogue précédent est conservé.'; }
      }
    } catch (error) { if (error.code !== 'ENOENT') recoveryError = 'Le réglage du catalogue est illisible. Une version précédente est utilisée si disponible.'; }
  }
  return { ...legacy, recoveryError };
}
