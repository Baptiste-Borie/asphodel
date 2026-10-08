import { parsePlaytestReview, type PlaytestReview } from './playtest-review.mjs';
import { parseBuilderProject, type BuilderProject } from './builder-project.mjs';

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export const MAX_STORAGE_BYTES = 4 * 1024 * 1024;
export interface BackupCard {
  id: number; scryfallId: string; oracleId: string | null; name: string; normalizedName: string;
  manaCost: string | null; manaValue: number; typeLine: string; oracleText: string | null;
  colors: string[]; colorIdentity: string[]; imageUri: string | null;
}
export interface BackupDeck { id: number; name: string; createdAt: string; updatedAt: string }
export interface BackupEntry {
  deckId: number; cardId: number; quantity: number; section: 'commander' | 'mainboard' | 'maybeboard';
  category: string; categoryPosition: number;
}
export interface LibrarySnapshot {
  reviews?: PlaytestReview[];
  decks: BackupDeck[]; cards: BackupCard[]; entries: BackupEntry[];
  projects: { deckId: number; projectId: string; state: BuilderProject }[];
}
export interface LibraryBackup {
  format: 'asphodel-library'; version: 1; createdAt: string; appVersion: string;
  library: LibrarySnapshot; storage: Record<string, string>; display: { fullscreen: boolean };
}
export class InvalidBackupError extends Error {}
const fail = (): never => { throw new InvalidBackupError('Sauvegarde Asphodel invalide ou incompatible. Aucune donnée n’a été remplacée.'); };
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const date = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const normalize = (v: string) => v.trim().normalize('NFKC').toLowerCase();
const unique = (values: unknown[]) => new Set(values).size === values.length;

export function isBackupStorageKey(key: string): boolean {
  return key === 'asphodel.play-presentation.v1' || key === 'asphodel.deck-lab.selection.v1' || key === 'asphodel.voice.approvedVocabulary.v1'
    || /^asphodel\.deck-table\.v1\.\d+$/.test(key) || /^asphodel\.builder-draft\.v1\.[a-zA-Z0-9_-]+$/.test(key);
}
export function parseBackupStorage(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const entries = Object.entries(value);
  if (entries.length > 10000 || entries.some(([k, v]) => !isBackupStorageKey(k) || !text(v, MAX_STORAGE_BYTES))) return fail();
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_STORAGE_BYTES) return fail();
  // Keep unreadable journals too: a backup must not silently discard a damaged draft.
  return Object.fromEntries(entries) as Record<string, string>;
}
export function parseLibrarySnapshot(value: unknown): LibrarySnapshot {
  const l = value as LibrarySnapshot;
  if (!l || !Array.isArray(l.decks) || l.decks.length > 5000 || !Array.isArray(l.cards) || l.cards.length > 100000
    || !Array.isArray(l.entries) || l.entries.length > 150000 || !Array.isArray(l.projects) || l.projects.length > l.decks.length) return fail();
  if (!l.decks.every(d => d && id(d.id) && text(d.name, 120) && !!d.name.trim() && date(d.createdAt) && date(d.updatedAt))
    || !unique(l.decks.map(d => d.id))) return fail();
  if (!l.cards.every(c => c && id(c.id) && text(c.name) && !!c.name.trim() && text(c.scryfallId) && !!c.scryfallId
    && c.normalizedName === normalize(c.name) && typeof c.manaValue === 'number' && Number.isFinite(c.manaValue)
    && text(c.typeLine, 1000) && (c.oracleId === null || text(c.oracleId))
    && ['manaCost', 'oracleText', 'imageUri'].every(k => (c as any)[k] === null || text((c as any)[k], 20000))
    && [c.colors, c.colorIdentity].every(a => Array.isArray(a) && a.length <= 5 && a.every(s => ['W','U','B','R','G'].includes(s))))
    || !unique(l.cards.map(c => c.id)) || !unique(l.cards.map(c => c.scryfallId)) || !unique(l.cards.map(c => c.normalizedName))) return fail();
  const deckIds = new Set(l.decks.map(d => d.id));
  const cardById = new Map(l.cards.map(c => [c.id, c]));
  if (!l.entries.every(e => e && deckIds.has(e.deckId) && cardById.has(e.cardId) && Number.isSafeInteger(e.quantity) && e.quantity > 0 && e.quantity <= 1000000
    && ['commander','mainboard','maybeboard'].includes(e.section) && text(e.category, 60) && !!e.category.trim()
    && Number.isSafeInteger(e.categoryPosition) && e.categoryPosition >= 0 && e.categoryPosition <= 10000)
    || !unique(l.entries.map(e => JSON.stringify([e.deckId, e.cardId, e.section, e.category])))) return fail();
  if (!unique(l.projects.map(p => p?.deckId)) || !unique(l.projects.map(p => p?.projectId))) return fail();
  const decks = new Map(l.decks.map(d => [d.id, d]));
  for (const p of l.projects) {
    if (!p || !deckIds.has(p.deckId)) return fail();
    try { parseBuilderProject(p.state); } catch { return fail(); }
    if (p.projectId !== p.state.projectId || p.state.name !== decks.get(p.deckId)!.name) return fail();
    // The complete table and the flattened game deck must describe the same membership.
    const expected = new Map<string, { quantity: number; position: number }>();
    p.state.groups.forEach((g, position) => g.entries.forEach(e => {
      const key = JSON.stringify([normalize(e.card.name), g.commander ? 'commander' : g.maybeboard ? 'maybeboard' : 'mainboard', g.name]);
      const prior = expected.get(key);
      expected.set(key, { quantity: (prior?.quantity ?? 0) + e.quantity, position: prior?.position ?? position });
    }));
    const actual = new Map(l.entries.filter(e => e.deckId === p.deckId).map(e => [
      JSON.stringify([cardById.get(e.cardId)!.normalizedName, e.section, e.category]), { quantity: e.quantity, position: e.categoryPosition },
    ]));
    if (expected.size !== actual.size || [...expected].some(([k,v]) => actual.get(k)?.quantity !== v.quantity || actual.get(k)?.position !== v.position)) return fail();
  }
  if (l.reviews !== undefined) {
    if (!Array.isArray(l.reviews) || l.reviews.length > 10000 || !unique(l.reviews.map(r=>r?.sessionId))) return fail();
    try { l.reviews.forEach(parsePlaytestReview); } catch { return fail(); }
  }
  return l;
}
export function parseLibraryBackup(value: unknown): LibraryBackup {
  const b = value as LibraryBackup;
  if (!b || b.format !== 'asphodel-library' || b.version !== 1 || !date(b.createdAt) || !text(b.appVersion, 60)
    || !b.display || typeof b.display.fullscreen !== 'boolean') return fail();
  parseLibrarySnapshot(b.library);
  parseBackupStorage(b.storage);
  if (new TextEncoder().encode(JSON.stringify(b)).length > MAX_BACKUP_BYTES) return fail();
  return b;
}
