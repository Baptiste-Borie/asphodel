import type { AgentCardObservation, AgentObservation } from "./types.js";

/**
 * V2h "NEWLY PLAYED CARD REVEAL": pure. The cards that are on ANY player's battlefield in `next`
 * but were not in `previous` — a genuinely new permanent landing, worth a restrained large reveal
 * before it settles into its small battlefield spot.
 *
 * Deliberately a direct "present now, absent before" battlefield-set comparison rather than reusing
 * `visual-transitions.ts`'s `diffLocations` (which is built for the FLIP zone-change animation and
 * needs a KNOWN previous zone to animate a ghost FROM — it intentionally reports nothing for a
 * cardRef that was never seen in any tracked zone before, e.g. straight out of an opponent's opaque
 * hand). That conservatism is correct for an animation origin, but wrong here: the overwhelmingly
 * common case this feature exists for — Asphodel casting a creature straight from its hidden hand —
 * is exactly a cardRef with no prior sighting at all, and it must still be revealed.
 *
 * Excludes:
 *   - a concealed arrival (hidden/face-down/no name) — nothing legitimate to show yet;
 *   - a LAND — already announced via its own "plays <land>" Recent Actions line (see
 *     backend/src/human/public-event-delta.ts, which excludes it from ITS OWN narration the same
 *     way, so a land is never silently double-announced).
 * `previous: null` (the very first observation) or a different game (`gameRef` changed) reveals
 * nothing — there is no genuine "before" to compare against.
 */
export function newlyArrivedPermanents(previous: AgentObservation | null, next: AgentObservation): AgentCardObservation[] {
  if (!previous || previous.gameRef !== next.gameRef) return [];
  const previousRefs = new Set<string>();
  for (const player of previous.players) for (const card of player.battlefield) previousRefs.add(card.cardRef);

  const revealed: AgentCardObservation[] = [];
  for (const player of next.players) {
    for (const card of player.battlefield) {
      if (previousRefs.has(card.cardRef)) continue;
      if (card.hidden || card.faceDown || !card.name) continue;
      if (card.typeLine && /land/i.test(card.typeLine)) continue;
      revealed.push(card);
    }
  }
  return revealed;
}
