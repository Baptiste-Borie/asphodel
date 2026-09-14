import type { LexiconEntry, VoiceIntentWord } from "./voice-types.js";

function entry(term: string, intent: VoiceIntentWord, contexts: string[] | null = null): LexiconEntry {
  return { term, intent, contexts, origin: "default" };
}

/**
 * The shipped V0 vocabulary — French first, common English Magic terms alongside it (spec: "Support
 * French first, but English Magic vocabulary commonly used by the player may coexist naturally").
 * Every term is already normalized the same way `transcript-normalizer.ts` normalizes a transcript
 * (lowercase, no diacritics, apostrophes kept) so a plain string match is exact and cheap.
 *
 * "play"/"cast"/"activate" are three DELIBERATELY separate intents (per spec: "joue" must not be
 * permanently equivalent to one Forge action type) — they only ever bias scoring toward the
 * matching `VoiceItemCategory` (voice-candidates.ts); which literal card they apply to is always
 * resolved from the transcript's recognized card name and the current legal choices, never from
 * the verb alone.
 *
 * `contexts: [...]` entries are the "contextual association" mechanism the spec calls out by name
 * (e.g. "envoie" -> attack, but ONLY while attackers are actually being declared) — see
 * voice-scoring.ts's CONTEXTUAL bonus and voice-resolver.test.ts.
 */
export const DEFAULT_LEXICON: readonly LexiconEntry[] = [
  // Pass
  entry("passe", "pass"), entry("pass", "pass"), entry("passer", "pass"),
  // Yes / no
  entry("oui", "yes"), entry("yes", "yes"), entry("ouais", "yes"),
  entry("non", "no"), entry("no", "no"),
  // Finish
  entry("fini", "finish"), entry("finis", "finish"), entry("termine", "finish"), entry("terminer", "finish"), entry("finish", "finish"), entry("done", "finish"), entry("valider", "finish"), entry("valide", "finish"),
  // Cancel
  entry("annule", "cancel"), entry("annuler", "cancel"), entry("cancel", "cancel"),
  // Target
  entry("cible", "target"), entry("cibler", "target"), entry("vise", "target"), entry("viser", "target"), entry("target", "target"),
  // Attack — "envoie"/"envoyer" only mean attack while attackers are actually being declared (see spec example).
  entry("attaque", "attack"), entry("attaquer", "attack"), entry("attack", "attack"), entry("charge", "attack"),
  entry("envoie", "attack", ["attackers_selection"]), entry("envoyer", "attack", ["attackers_selection"]),
  // Block
  entry("bloque", "block"), entry("bloquer", "block"), entry("block", "block"), entry("intercepte", "block"), entry("intercepter", "block"),
  // Play a land
  entry("joue", "play"), entry("jouer", "play"), entry("pose", "play"), entry("poser", "play"),
  entry("place", "play"), entry("placer", "play"), entry("mets", "play"), entry("mettre", "play"),
  entry("play", "play"), entry("put", "play"),
  // Cast a spell
  entry("caste", "cast"), entry("lance", "cast"), entry("lancer", "cast"), entry("cast", "cast"),
  entry("invoque", "cast"), entry("invoquer", "cast"),
  // Activate an ability
  entry("active", "activate"), entry("activer", "activate"), entry("activate", "activate"),
  entry("utilise", "activate"), entry("utiliser", "activate"), entry("use", "activate"),
];

/** Pure. The default vocabulary plus every human-approved addition — later entries never overwrite earlier ones; both are looked up together (`lookupTerm`), so a context-scoped approval never has to redefine what "attaque" already means. */
export function mergeLexicon(base: readonly LexiconEntry[], approved: readonly LexiconEntry[]): LexiconEntry[] {
  return [...base, ...approved];
}

export interface LexiconMatch {
  entry: LexiconEntry;
  /** True when this specific entry is restricted to (and so was matched inside) a specific decision context — always outranks a same-term global synonym (voice-scoring.ts). */
  contextual: boolean;
}

/** Pure. Every lexicon entry for this exact normalized term that applies in `context` — a global (`contexts: null`) entry always applies; a context-restricted one only when `context` is in its list. */
export function lookupTerm(lexicon: readonly LexiconEntry[], term: string, context: string): LexiconMatch[] {
  return lexicon
    .filter((e) => e.term === term && (e.contexts === null || e.contexts.includes(context)))
    .map((e) => ({ entry: e, contextual: e.contexts !== null }));
}

/** Pure. Whether ANY entry (any context) maps this term to some intent at all — used only to classify a word as "known vocabulary" vs. "genuinely unknown" for diagnostics, independent of whether it applies to the CURRENT decision (see voice-candidates.ts's `computeUnknownTerms`). */
export function isKnownTerm(lexicon: readonly LexiconEntry[], term: string): boolean {
  return lexicon.some((e) => e.term === term);
}
