/**
 * Builds the small, contextual card-name vocabulary sent alongside a mic-capture recording as a
 * whisper.cpp `--prompt` hint (see backend/src/voice/whisper-prompt.ts). Deliberately NOT the
 * Voice Intent Resolver: this never ranks or resolves anything, and the resolver remains the sole
 * authority over what a transcript actually means — this only makes the raw transcript Whisper
 * hands the resolver more likely to contain the right spelling in the first place.
 *
 * Source priority (spec order — a name already added by a higher-priority source is never added
 * again, but nothing here is ever EXCLUDED for being lower priority, only truncated once the count
 * cap is hit):
 *  1. cards referenced by the CURRENT Forge legal choices (`pending.rendered.items` — exactly what
 *     the Voice Intent Resolver itself is about to score against, see voice-candidates.ts).
 *  2. the human's own known hand.
 *  3. permanents visible on any battlefield.
 *  4. commanders / command zone cards.
 *  5. anything else already visible to the human right now (graveyard/exile via `buildCardNameIndex`,
 *     plus the stack) — still legitimate public information, just the lowest priority to keep.
 *
 * Only ever reads `VoicePendingDecision`/`AgentObservation` — both already the exact information the
 * human's own screen shows them (see voice-types.ts's own "never hidden information" contract on
 * `buildCardNameIndex`). Never queries Forge, the backend, or any global state directly.
 */
import type { AgentObservation, VoicePendingDecision } from "./voice-types.js";
import { buildCardNameIndex } from "./voice-card-matching.js";

/** Small on purpose — see whisper-prompt.ts's MAX_PROMPT_CARD_NAMES on the backend, which re-caps
 * defensively anyway. Capping here too keeps the network payload small and keeps this list itself
 * meaningfully "small and contextual" per spec, independent of the backend's own limit. */
export const MAX_CONTEXTUAL_VOCABULARY_TERMS = 12;

function addUnique(target: string[], seen: Set<string>, name: string | null | undefined): void {
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  target.push(trimmed);
}

/**
 * Pure. Returns a deduplicated, priority-ordered, capped list of card names — `[]` when there is
 * neither a pending decision nor an observation (nothing to bias toward), which callers should
 * treat as "send no prompt at all" (see mic-capture.ts).
 */
export function buildContextualVocabulary(
  pending: VoicePendingDecision | null,
  observation: AgentObservation | null,
  maxTerms: number = MAX_CONTEXTUAL_VOCABULARY_TERMS,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  const cardIndex = observation ? buildCardNameIndex(observation) : new Map<string, string>();

  // 1. current legal choices — the exact set the resolver is about to score against.
  if (pending?.rendered.kind === "menu") {
    for (const item of pending.rendered.items) {
      if (!item.cardRef) continue;
      addUnique(names, seen, item.presentationName ?? cardIndex.get(item.cardRef) ?? null);
    }
  }

  if (observation) {
    // 2. the human's own hand.
    const self = observation.players.find((p) => p.role === "self");
    if (self) for (const card of self.hand) if (!card.hidden) addUnique(names, seen, card.name);

    // 3. permanents visible on any battlefield.
    for (const player of observation.players) for (const card of player.battlefield) if (!card.hidden) addUnique(names, seen, card.name);

    // 4. commanders / command zone.
    for (const player of observation.players) {
      for (const commander of player.commanders) addUnique(names, seen, commander.name);
      for (const card of player.command) if (!card.hidden) addUnique(names, seen, card.name);
    }

    // 5. everything else already visible (graveyard/exile via the card index, plus the stack).
    for (const name of cardIndex.values()) addUnique(names, seen, name);
    for (const item of observation.stack) if (!item.hidden) addUnique(names, seen, item.sourceCardName);
  }

  return names.slice(0, maxTerms);
}
