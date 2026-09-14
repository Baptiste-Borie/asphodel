import type { LexiconEntry } from "./voice-types.js";

/**
 * V0 persistence for human-APPROVED vocabulary only — the shipped `DEFAULT_LEXICON`
 * (voice-lexicon.ts) never touches storage at all, so it can always be told apart from what a human
 * actually approved, inspected, or reset (spec: "Keep default vocabulary separate from
 * user-approved additions"). A small versioned JSON blob, per spec ("Do not introduce a database
 * unless the repository architecture genuinely requires it… a small versioned JSON/local
 * configuration mechanism is acceptable") — there is no backend endpoint for this in V0, so it
 * lives in the browser, injected behind a tiny interface so it stays fully testable without a real
 * `localStorage` (the frontend's own test runner is plain Node — see decision-gate.test.ts and
 * friends, none of which touch the DOM either).
 */
export interface VoiceVocabularyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "asphodel.voice.approvedVocabulary.v1";
const STORAGE_VERSION = 1;

interface StoredVocabularyFile {
  version: number;
  entries: Array<Pick<LexiconEntry, "term" | "intent" | "contexts">>;
}

/** A `VoiceVocabularyStorage` backed by a plain in-memory `Map` — the safe fallback when no real `localStorage` exists (this Node test runner, a server-side render, a private-mode browser that throws on access), and the only backend voice-vocabulary-store.test.ts needs. */
export function createMemoryVoiceVocabularyStorage(): VoiceVocabularyStorage {
  const backing = new Map<string, string>();
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, value); },
  };
}

/** The browser's real `localStorage` when it is actually usable, else the in-memory fallback — never throws either way, so calling this is always safe at module load time. */
export function defaultVoiceVocabularyStorage(): VoiceVocabularyStorage {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.getItem(STORAGE_KEY); // touch it once — a throwing private-mode localStorage falls back immediately, before anything relies on it.
      return localStorage;
    }
  } catch {
    /* falls through to the in-memory fallback below */
  }
  return createMemoryVoiceVocabularyStorage();
}

/** Never throws: a corrupt/foreign/missing value is treated as "no approved vocabulary yet", never a crash. */
export function loadApprovedVocabulary(storage: VoiceVocabularyStorage): LexiconEntry[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredVocabularyFile>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.map((e) => ({ term: e.term, intent: e.intent, contexts: e.contexts, origin: "approved" }) as LexiconEntry);
  } catch {
    return [];
  }
}

/** Best-effort only: a storage write failure (quota, disabled storage) never throws back into the resolver — the approval simply won't survive a reload this time. */
export function saveApprovedVocabulary(storage: VoiceVocabularyStorage, entries: readonly LexiconEntry[]): void {
  const payload: StoredVocabularyFile = {
    version: STORAGE_VERSION,
    entries: entries.map((e) => ({ term: e.term, intent: e.intent, contexts: e.contexts })),
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* best-effort persistence only */
  }
}
