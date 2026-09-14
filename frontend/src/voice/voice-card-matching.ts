import type { AgentObservation } from "./voice-types.js";

function stripDiacritics(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/** Pure. Lowercase, diacritic-stripped, punctuation squashed to spaces (apostrophe kept). */
export function normalizeCardText(text: string): string {
  return stripDiacritics(text.toLowerCase()).replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Pure. Apostrophes are the one place STT commonly disagrees with the printed name ("K'rrik" heard as "Krrik") — comparisons always go through this so that disagreement alone never blocks a match. */
export function canon(text: string): string {
  return text.replace(/'/g, "");
}

const CARD_NAME_STOPWORDS: ReadonlySet<string> = new Set(["the", "of", "a", "an", "le", "la", "les", "du", "de", "des", "and", "et"]);

/** Pure. A card's own distinctive words, lowercased — e.g. "Kokusho, the Renegade Ninja" -> ["kokusho","renegade","ninja"]. Never includes filler words shared by half the deck ("the", "of"). */
export function significantCardWords(name: string): string[] {
  return normalizeCardText(name)
    .split(" ")
    .filter((word) => word.length > 1 && !CARD_NAME_STOPWORDS.has(word));
}

/**
 * cardRef -> visible display name, across every zone the human can legally reference right now.
 * Hidden/face-down cards are never included — Forge never legally lets voice (or a click) target
 * something the human observation itself reports as hidden.
 */
export function buildCardNameIndex(observation: AgentObservation): Map<string, string> {
  const map = new Map<string, string>();
  for (const player of observation.players) {
    const zones = [player.battlefield, player.graveyard, player.exile, player.command, ...(player.role === "self" ? [player.hand] : [])];
    for (const zone of zones) {
      for (const card of zone) {
        if (!card.hidden && card.name) map.set(card.cardRef, card.name);
      }
    }
  }
  return map;
}

/** Classic Levenshtein edit distance — pure, no external dependency. */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) dist[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i]![j] = Math.min(dist[i - 1]![j]! + 1, dist[i]![j - 1]! + 1, dist[i - 1]![j - 1]! + cost);
    }
  }
  return dist[rows - 1]![cols - 1]!;
}

/** Pure. 1 = identical; 0 = no similarity at all. */
export function wordSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

export type CardMatchLevel = "exact" | "fuzzy" | "none";

export interface CardMatchResult {
  level: CardMatchLevel;
  /** The card's own word (or full name) that matched — for diagnostics only. */
  matchedWord: string | null;
  /** Index into `meaningfulTokens` that produced the match — used to order a compound plan by the order names were actually spoken. `null` for a whole-name match spanning multiple tokens, or no match. */
  matchedTokenIndex: number | null;
}

const NO_MATCH: CardMatchResult = { level: "none", matchedWord: null, matchedTokenIndex: null };

/** Fuzzy matching never applies to a word shorter than this — a 3-letter word ("Sol", "Fog") is too close to countless unrelated syllables to fuzzy-match safely (spec: "fuzzy matching must remain conservative"). */
const MIN_FUZZY_WORD_LENGTH = 4;
/** A near-miss must clear this similarity to count as a fuzzy match at all. */
const FUZZY_SIMILARITY_THRESHOLD = 0.72;

/**
 * Pure. Conservative card-name matching against the transcript's own MEANINGFUL (non-filler)
 * tokens: an exact hit — either the whole normalized name as a contiguous substring of the
 * transcript, or any one of the card's own significant words appearing verbatim — always wins over
 * a fuzzy one. Fuzzy matching only ever considers one card word against one transcript token at a
 * time, and only for words of a reasonable length, specifically so a badly-deformed STT reading of
 * an unrelated short word never silently "recovers" into a card name (see docs "Card matching").
 */
export function matchCardName(name: string, meaningfulTokens: readonly string[], transcriptNormalized: string): CardMatchResult {
  const fullName = canon(normalizeCardText(name).replace(/\s+/g, ""));
  const flatTranscript = canon(transcriptNormalized.replace(/\s+/g, ""));
  if (fullName.length > 0 && flatTranscript.includes(fullName)) return { level: "exact", matchedWord: name, matchedTokenIndex: null };

  const words = significantCardWords(name);
  for (const word of words) {
    const index = meaningfulTokens.findIndex((token) => canon(token) === canon(word));
    if (index !== -1) return { level: "exact", matchedWord: word, matchedTokenIndex: index };
  }

  let best = 0;
  let bestWord: string | null = null;
  let bestIndex: number | null = null;
  for (const word of words) {
    if (word.length < MIN_FUZZY_WORD_LENGTH) continue;
    meaningfulTokens.forEach((token, index) => {
      const canonToken = canon(token);
      if (Math.abs(canonToken.length - word.length) > 2) return;
      const similarity = wordSimilarity(canon(word), canonToken);
      if (similarity > best) {
        best = similarity;
        bestWord = word;
        bestIndex = index;
      }
    });
  }
  if (best >= FUZZY_SIMILARITY_THRESHOLD) return { level: "fuzzy", matchedWord: bestWord, matchedTokenIndex: bestIndex };
  return NO_MATCH;
}
