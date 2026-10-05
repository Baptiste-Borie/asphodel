import { isBackupStorageKey, parseBackupStorage } from '../../shared/library-backup.mjs';

export function captureLibraryStorage(storage: Storage): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && isBackupStorageKey(key)) {
      const value = storage.getItem(key);
      if (value !== null) values[key] = value;
    }
  }
  return parseBackupStorage(values);
}

/** Apply before mounting the builder; unrelated browser data is left intact. */
export function restoreLibraryStorage(storage: Storage, values: Record<string, string>): void {
  const next = parseBackupStorage(values);
  const before = captureLibraryStorage(storage);
  const apply = (snapshot: Record<string, string>) => {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key && isBackupStorageKey(key)) keys.push(key); }
    for (const key of keys) storage.removeItem(key);
    for (const [key, value] of Object.entries(snapshot)) storage.setItem(key, value);
  };
  try { apply(next); }
  catch (error) { apply(before); throw error; }
}
