import type { HumanSafePublicBoardObservation } from "./public-game-frame.js";

/**
 * V2h "RECENT ACTIONS / HUMAN COMPREHENSION": extra "Recent Actions" lines worth narrating between
 * two consecutive human-safe public observations of the SAME game, on top of whatever
 * `describeAgentAction` already reported for the action that caused them — life changes, and new
 * non-land battlefield arrivals (a land play is already announced via its own "plays <land>" line,
 * so it is deliberately excluded here to avoid a duplicate).
 *
 * A pure display comparison between two already-sanitized, already-computed observations — never a
 * parallel rules engine, and (unlike the CLI's own `renderEventDelta`) never assumes which player is
 * "you": both `previous`/`next` are always the HUMAN-safe view (`sanitizeAgentObservation` already
 * normalizes `selfPlayerId` to the human), so `role === "self"` here is always genuinely the human,
 * never Asphodel's own hand mislabeled as "your" hand.
 */
export function describeObservationDelta(
  previous: HumanSafePublicBoardObservation | null,
  next: HumanSafePublicBoardObservation,
): string[] {
  if (!previous || previous.gameRef !== next.gameRef) return [];
  const lines: string[] = [];
  for (const nextPlayer of next.players) {
    const prevPlayer = previous.players.find((p) => p.playerId === nextPlayer.playerId);
    if (!prevPlayer) continue;
    const label = nextPlayer.role === "self" ? "You" : nextPlayer.name;

    if (prevPlayer.life !== nextPlayer.life) {
      const delta = nextPlayer.life - prevPlayer.life;
      lines.push(`${label} ${delta > 0 ? "gained" : "lost"} ${Math.abs(delta)} life`);
    }

    const previousRefs = new Set(prevPlayer.battlefield.map((card) => card.cardRef));
    for (const card of nextPlayer.battlefield) {
      if (previousRefs.has(card.cardRef)) continue;
      if (card.hidden || card.faceDown || !card.name) continue;
      if (card.typeLine && /land/i.test(card.typeLine)) continue; // already announced via "plays <land>".
      lines.push(`${card.name} entered the battlefield`);
    }
  }
  return lines;
}
