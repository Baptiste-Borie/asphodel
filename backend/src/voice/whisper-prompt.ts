/**
 * Turns a small contextual card-name vocabulary into whisper.cpp's `--prompt` initial-prompt
 * string. Benchmarked against real whisper-cli output (tiny/fr/greedy — see
 * whisper-transcription-service.ts) before this was wired up: a short prompt naming only the
 * cards plausible right now measurably fixed exactly the failure mode it targets — e.g. "Kokusho"
 * heard as "coquuchon" without a prompt came back as an exact "Kokusho" with one, and "Vilis" heard
 * as "vimice" came back exact too — without moving latency outside the sub-second budget, PROVIDED
 * whisper.cpp's temperature-fallback retry path is disabled (see `WHISPER_NO_FALLBACK` in
 * whisper-transcription-service.ts): on one benchmarked sample, a prompt alone pushed a normally
 * ~200ms greedy decode into two fallback retries and ~900ms, without it. The prompt is a hint only —
 * it does not always produce the exact spelling (a lone "K'rrik" with no other context sometimes
 * still comes back wrong), so the Voice Intent Resolver's own fuzzy matching remains load-bearing.
 */

/** Deliberately small — whisper-cli's own help documents the initial prompt as capped at
 * "max n_text_ctx/2 tokens" (224 for this model), and a long prompt only adds noise for a decoder
 * this constrained. Kept well under that in characters, not tokens, since we never tokenize here. */
export const MAX_PROMPT_CARD_NAMES = 12;
export const MAX_PROMPT_CHARS = 300;

const PROMPT_PREFIX = "Magic: The Gathering. Noms de cartes probables : ";
const PROMPT_SUFFIX = ".";

/** Case-insensitive dedup that preserves the FIRST occurrence's exact casing and the caller's own
 * ordering (the caller already orders by relevance — see voice-context-vocabulary.ts's priority
 * list) — never re-sorts, so the same context always yields the same prompt (stable tests, stable
 * behavior). */
function dedupeCardNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/**
 * Pure. `null` for an empty/absent vocabulary — no prompt at all is the correct behavior then (a
 * prompt with no real content would just be dead weight on every request). Truncates by whichever
 * limit (card count or total character budget) is hit first, never splitting a name in half.
 */
export function buildWhisperPrompt(vocabulary: readonly string[] | undefined, opts: { maxCardNames?: number; maxChars?: number } = {}): string | null {
  if (!vocabulary || vocabulary.length === 0) return null;
  const maxCardNames = opts.maxCardNames ?? MAX_PROMPT_CARD_NAMES;
  const maxChars = opts.maxChars ?? MAX_PROMPT_CHARS;

  const deduped = dedupeCardNames(vocabulary).slice(0, maxCardNames);
  if (deduped.length === 0) return null;

  const budget = maxChars - PROMPT_PREFIX.length - PROMPT_SUFFIX.length;
  const included: string[] = [];
  let length = 0;
  for (const name of deduped) {
    const addition = included.length === 0 ? name.length : name.length + 2; // ", "
    if (length + addition > budget) break;
    included.push(name);
    length += addition;
  }
  if (included.length === 0) return null;

  return `${PROMPT_PREFIX}${included.join(", ")}${PROMPT_SUFFIX}`;
}
