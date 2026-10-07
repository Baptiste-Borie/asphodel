import { constants } from 'node:fs';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { selectCatalog } from './catalog-paths.mjs';

export const APP_ORIGIN = 'asphodel://app';
export const API_PREFIXES = ['/health', '/decks', '/playtests', '/cards', '/voice'];

export function isApiPath(pathname) {
  return API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function assetPath(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const path = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  return path.startsWith(`${resolve(root)}${sep}`) ? path : null;
}

export async function seedFile(source, destination) {
  await mkdir(resolve(destination, '..'), { recursive: true });
  try { await copyFile(source, destination, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

export async function prepareUserData(runtime, userData) {
  const data = join(userData, 'data');
  await mkdir(data, { recursive: true });
  await seedFile(join(runtime, 'backend/data/asphodel.sqlite'), join(data, 'asphodel.sqlite'));
  for (const name of ['scryfall-oracle-cards.jsonl.gz', 'scryfall-default-cards.jsonl.gz']) {
    const source = join(runtime, 'backend/data', name);
    if (await access(source).then(() => true, () => false)) await seedFile(source, join(data, name));
  }
  const catalog = await selectCatalog(data);
  return {
    DB_FILE_NAME: `file:${join(data, 'asphodel.sqlite')}`,
    SCRYFALL_BULK_PATH: catalog.paths.oracle,
    SCRYFALL_PRINTING_BULK_PATH: catalog.paths.printing,
    ASPHODEL_SEARCH_INDEX: catalog.paths.index,
    ASPHODEL_REPORTS_ROOT: join(userData, 'playtest-reports'),
    WHISPER_MODEL_PATH: join(userData, 'whisper-models'),
    ASPHODEL_FORGE_JAR: join(runtime, 'forge-bridge/app/target/asphodel-forge-bridge.jar'),
    ASPHODEL_FORGE_ASSETS: join(runtime, 'vendor/forge/forge-gui/res'),
    ASPHODEL_JAVA_PATH: join(runtime, 'java/bin', process.platform === 'win32' ? 'java.exe' : 'java'),
  };
}
