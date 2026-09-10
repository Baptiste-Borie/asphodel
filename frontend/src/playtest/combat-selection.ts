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

/** V2h "COMBAT READABILITY": one declared card's role plus what it is paired with — a live attacker's `relatedRef` is the defending player's id, a live blocker's is the attacker's own cardRef. Never derived/guessed; copied verbatim from `WebPendingDecisionDTO.combatPairings` (itself Forge's own `ForgePendingCombatDecision.selected`). */
export interface CombatRelation {
  role: "attacker" | "blocker";
  relatedRef: string;
}

/** Pure. `null` outside attackers_selection/blockers_selection, or when the pairing data is absent (an older backend). */
export function combatRelations(pending: WebPendingDecisionDTO | null): ReadonlyMap<string, CombatRelation> | null {
  if (!pending) return null;
  if (pending.type !== "attackers_selection" && pending.type !== "blockers_selection") return null;
  if (!pending.combatPairings) return null;
  const role: CombatRelation["role"] = pending.type === "attackers_selection" ? "attacker" : "blocker";
  const map = new Map<string, CombatRelation>();
  for (const pair of pending.combatPairings) map.set(pair.cardRef, { role, relatedRef: pair.relatedRef });
  return map;
}
