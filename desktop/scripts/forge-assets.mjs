import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// StaticData creates a CardEdition.Reader for this deliberately empty folder.
// StorageReaderFolder requires it to exist even when custom cards are disabled.
// Prepare it while building: /opt and mounted AppImages are read-only at runtime.
export const EMPTY_FORGE_EDITIONS = 'asphodel-empty-custom-editions';
export async function prepareForgeAssets(assets) {
  await mkdir(join(assets, EMPTY_FORGE_EDITIONS), { recursive: true });
}
