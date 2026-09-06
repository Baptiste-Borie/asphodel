import type { AgentCardObservation } from "./types.js";

export interface CardGroup {
  /** Stable across renders as long as the signature is unchanged — safe to use as a DOM reconciliation key. */
  key: string;
  /** One member of the group, used purely for display (image/name/tapped/etc. — every member shares the exact same signature, so any one of them renders identically to the rest). */
  representative: AgentCardObservation;
  /** Every underlying Forge cardRef in this group, in the order Forge reported them. Never collapsed into a fake single object. */
  cardRefs: string[];
  count: number;
}

/**
 * Pure. The grouping signature: cards sharing every one of these dimensions are visually
 * indistinguishable right now, so they may be shown as one stacked card with a count. This never
 * merges Forge identities — see `CardGroup.cardRefs` — only what's rendered as one visual unit.
 * Anything not covered here (arbitrary future visible state) errs toward NOT grouping by simply
 * being a distinct object shape below; when in doubt, add a dimension here rather than risk
 * hiding a real difference behind a shared stack.
 */
function groupSignature(card: AgentCardObservation): string {
  const counters = card.counters
    ? Object.entries(card.counters).sort(([a], [b]) => a.localeCompare(b)).map(([type, n]) => `${type}:${n}`).join(",")
    : "";
  return JSON.stringify([
    card.name,
    card.tapped,
    card.summoningSick,
    card.power,
    card.toughness,
    counters,
    Boolean(card.token),
  ]);
}

/**
 * Pure. Groups a zone's cards by `groupSignature`, preserving Forge's own reported order (a
 * group's position is wherever its FIRST member first appeared). Every real cardRef is retained —
 * this is a display grouping only, never a fake merged game object. A hidden/unnamed card (e.g.
 * Asphodel's own hand, never reachable here anyway) still groups consistently since `null` is a
 * valid, stable signature value.
 */
export function groupCards(cards: readonly AgentCardObservation[]): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  const order: string[] = [];
  for (const card of cards) {
    const key = groupSignature(card);
    let group = groups.get(key);
    if (!group) {
      group = { key, representative: card, cardRefs: [], count: 0 };
      groups.set(key, group);
      order.push(key);
    }
    group.cardRefs.push(card.cardRef);
    group.count++;
  }
  return order.map((key) => groups.get(key)!);
}
