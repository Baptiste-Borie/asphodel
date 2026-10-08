import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// StaticData creates a CardEdition.Reader for this deliberately empty folder.
// StorageReaderFolder requires it to exist even when custom cards are disabled.
// Prepare it while building: /opt and mounted AppImages are read-only at runtime.
export const EMPTY_FORGE_EDITIONS = 'asphodel-empty-custom-editions';
export const FORGE_DIRECTORY_MARKER = 'asphodel-directory.marker';
export async function prepareForgeAssets(assets) {
  const directory = join(assets, EMPTY_FORGE_EDITIONS);
  await mkdir(directory, { recursive: true });
  // electron-builder's resource walker drops empty folders. Keep a normal file
  // that Forge's CardEdition.Reader ignores (it reads only names ending in .txt).
  await writeFile(join(directory, FORGE_DIRECTORY_MARKER), 'Packaging marker: retain this directory. No custom Forge editions.\n');
}
