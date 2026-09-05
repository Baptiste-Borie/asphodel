import type { AgentCardObservation } from "./types.js";

/** Pure. Never invents an identity Forge did not reveal. */
export function cardDisplayName(card: Pick<AgentCardObservation, "name" | "hidden" | "faceDown">): string {
  if (card.hidden || card.name === null) return card.faceDown ? "Face-down card" : "Hidden card";
  return card.name;
}

export type CardCategory = "land" | "other";

/** Pure. Uses only the printed type line already in the DTO — no Magic rules engine, no card-name special-casing. */
export function categorizeCard(typeLine: string | null | undefined): CardCategory {
  return typeLine && /land/i.test(typeLine) ? "land" : "other";
}

/** Pure: readable counter list, e.g. { "+1/+1": 2, "loyalty": 3 } -> "2 +1/+1, 3 loyalty". */
export function formatCounters(counters: Record<string, number> | null | undefined): string | null {
  if (!counters || !Object.keys(counters).length) return null;
  return Object.entries(counters).map(([type, n]) => `${n} ${type}`).join(", ");
}
