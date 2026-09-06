import type { AgentCardObservation } from "./types.js";

/**
 * Pure. A card is visually considered a land when its typeLine contains the Magic card type
 * "Land" as a whole word (so a subtype/ability text that happens to contain "Land" as part of a
 * longer word would not false-positive, though no standard Magic type line does this in practice).
 * Presentation only — this never moves a card between Forge zones and never derives any rules
 * input; Forge's own zone/battlefield state is completely unchanged by this partition.
 */
export function isLandCard(card: Pick<AgentCardObservation, "typeLine">): boolean {
  return card.typeLine !== null && /\bLand\b/.test(card.typeLine);
}

export interface BattlefieldPartition {
  lands: AgentCardObservation[];
  nonLands: AgentCardObservation[];
}

/**
 * Pure. Splits a zone's cards into lands vs everything else, preserving Forge's own reported
 * order within each partition — a presentation-only split so the tabletop can give lands their own
 * dedicated area instead of mixing them into the normal creature/artifact row.
 */
export function partitionBattlefield(cards: readonly AgentCardObservation[]): BattlefieldPartition {
  const lands: AgentCardObservation[] = [];
  const nonLands: AgentCardObservation[] = [];
  for (const card of cards) (isLandCard(card) ? lands : nonLands).push(card);
  return { lands, nonLands };
}
