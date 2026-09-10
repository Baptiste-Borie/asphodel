import type { WebPlaytestStateDTO } from "./types.js";

/**
 * V2h.1 "MANA/PAYMENT OVERLAY LIFECYCLE": bridges a transient `pendingDecision: null` poll — Forge
 * still computing the next step of the SAME multi-step mana payment (see playtest-view.ts's earlier
 * "V2h MANA/PAYMENT DECISION UI MUST NOT REMOUNT" comment) — without also treating "the payment has
 * genuinely ended and the game is simply between decisions right now" (the opponent's whole turn, or
 * a human priority Forge auto-passed for them — both leave `pendingDecision` null for an unbounded
 * stretch) as if it were still the same payment.
 *
 * `state.manaPaymentActive` is the backend's own reliable signal for this — see
 * `WebPlaytestStateDTO.manaPaymentActive`'s doc comment: it stays true only until a decision (of any
 * type, either seat) is actually PROCESSED that is not itself a human `mana_payment` step, whether or
 * not that decision was ever visible to the browser. A pure predicate (no DOM) so both directions —
 * "bridge this null" (A) and "this is a real end, close it" (B) — are covered by a plain unit test,
 * not just eyeballed from a running game.
 */
export function shouldBridgeManaOverlayNull(
  state: Pick<WebPlaytestStateDTO, "pendingDecision" | "manaPaymentActive" | "status">,
  overlayIsOpen: boolean,
  terminalStatuses: ReadonlySet<string>,
): boolean {
  return overlayIsOpen && state.pendingDecision === null && state.manaPaymentActive && !terminalStatuses.has(state.status);
}
