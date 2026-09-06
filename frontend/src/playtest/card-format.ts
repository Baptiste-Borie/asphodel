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

export interface CounterBadge {
  type: string;
  count: number;
}

/**
 * Pure. One compact battlefield badge per counter type Forge reports — never hardcoded to a
 * specific type (+1/+1, loyalty, charge, -1/-1, or any other Forge-visible counter type all use
 * the same generic path). A zero-count entry is dropped (nothing to show). Sorted by type name for
 * a deterministic, stable stacking order across renders.
 */
export function counterBadges(counters: Record<string, number> | null | undefined): CounterBadge[] {
  if (!counters) return [];
  return Object.entries(counters)
    .filter(([, count]) => count !== 0)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type));
}
