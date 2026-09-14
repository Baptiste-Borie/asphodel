import type { NormalizedToken, NormalizedTranscript } from "./voice-types.js";

/**
 * French connectives/pronouns/articles (plus the handful of English ones a bilingual player might
 * mix in) that never carry meaning on their own — always ignored, never scored, never reported as
 * "unknown vocabulary". This is deliberately conservative: a word only belongs here if it is
 * grammatical glue in EVERY context, never a real Magic term. See docs "Unknown vocabulary".
 */
export const FILLER_WORDS: ReadonlySet<string> = new Set([
  // French pronouns/determiners/connectives
  "je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",
  "vais", "va", "veux", "voudrais", "aimerais", "peux", "peut",
  "un", "une", "des", "le", "la", "les", "l", "du", "de", "d",
  "au", "aux", "avec", "et", "ou", "a", "pour", "sur", "dans", "chez",
  "ce", "cet", "cette", "ces", "c",
  "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "leur", "leurs",
  "que", "qu", "qui", "donc", "alors", "bien", "voila", "voici", "s", "n", "t", "m",
  // number/value marker words: neutral on their own — the actual number word/digit carries the meaning.
  "valeur", "value", "nombre", "montant", "numero",
  // English glue
  "the", "a", "an", "to", "with", "and", "of", "i", "my", "please", "is",
]);

/** Elided French pronoun/article prefixes ("j'attaque" -> "j" + "attaque", never split a card name like "K'rrik" — "k" is not one of these). */
const ELISION_PREFIXES: ReadonlySet<string> = new Set(["j", "l", "d", "qu", "n", "c", "s", "m", "t"]);

function stripDiacritics(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/** Pure. Lowercase, diacritic-stripped, punctuation-stripped (apostrophe kept — card names like "K'rrik" need it). */
export function normalizeWord(word: string): string {
  return stripDiacritics(word.toLowerCase()).replace(/[^a-z0-9']/g, "");
}

/** Pure. "j'attaque" -> ["j","attaque"]; "k'rrik" -> ["k'rrik"] (not an elision prefix); anything else -> [word]. */
export function splitElision(word: string): string[] {
  const idx = word.indexOf("'");
  if (idx > 0 && idx <= 2) {
    const prefix = word.slice(0, idx);
    const rest = word.slice(idx + 1);
    if (ELISION_PREFIXES.has(prefix) && rest.length > 0) return [prefix, rest];
  }
  return [word];
}

/**
 * Pure. Splits a raw STT transcript into normalized tokens, flagging known filler words. Never
 * drops the raw text — both the raw and normalized forms are kept on the result and on every token,
 * so a genuine STT mishearing ("je casse cric" instead of "je caste K'rrik") stays visibly distinct
 * from a normalization/parser miss (see docs "Speech-to-text debugging").
 */
export function normalizeTranscript(raw: string): NormalizedTranscript {
  const rawTrimmed = raw.trim();
  const rawWords = rawTrimmed.length ? rawTrimmed.split(/\s+/) : [];
  const tokens: NormalizedToken[] = [];
  for (const rawWord of rawWords) {
    for (const part of splitElision(rawWord)) {
      const normalized = normalizeWord(part);
      if (!normalized) continue;
      tokens.push({ raw: rawWord, normalized, ignored: FILLER_WORDS.has(normalized) });
    }
  }
  return { raw: rawTrimmed, normalized: tokens.map((t) => t.normalized).join(" "), tokens };
}
