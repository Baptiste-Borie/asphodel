import type { WebPendingDecisionDTO } from "./types.js";

/**
 * Pure. The cardRefs Forge currently reports as declared attackers/blockers for THIS decision —
 * `null` for every other decision type, or when the decision carries no such data. This is Forge's
 * own `selected` list, relayed verbatim as `WebPendingDecisionDTO.selectedCardRefs` — never derived
 * from `tapped`, never guessed locally. The tabletop's "combat-selected" visual (V2e.6) is driven
 * entirely by this, kept completely independent of a card's own tapped state.
 */
export function combatSelectedCardRefs(pending: WebPendingDecisionDTO | null): ReadonlySet<string> | null {
  if (!pending) return null;
  if (pending.type !== "attackers_selection" && pending.type !== "blockers_selection") return null;
  if (!pending.selectedCardRefs) return null;
  return new Set(pending.selectedCardRefs);
}
