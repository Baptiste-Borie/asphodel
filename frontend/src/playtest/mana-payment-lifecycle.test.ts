import assert from "node:assert/strict";
import { it } from "node:test";
import { shouldBridgeManaOverlayNull } from "./mana-payment-lifecycle.js";
import type { WebPlaytestStateDTO } from "./types.js";

const TERMINAL = new Set(["completed", "ended_by_human", "failed"]);

function state(overrides: Partial<Pick<WebPlaytestStateDTO, "pendingDecision" | "manaPaymentActive" | "status">>): Pick<WebPlaytestStateDTO, "pendingDecision" | "manaPaymentActive" | "status"> {
  return { pendingDecision: null, manaPaymentActive: false, status: "waiting_for_human", ...overrides };
}

// A. transient null INSIDE the same payment: the overlay must stay open.
it("A — bridges a transient null while Forge is still mid the SAME payment sequence (manaPaymentActive true)", () => {
  const bridged = shouldBridgeManaOverlayNull(
    state({ pendingDecision: null, manaPaymentActive: true, status: "running" }),
    true,
    TERMINAL,
  );
  assert.equal(bridged, true, "a transient null mid-payment must not close the overlay");
});

// B. real end of payment: even though pendingDecision is ALSO null (auto-passed priority, or the
// opponent's whole turn), manaPaymentActive has already flipped false — the overlay must close.
it("B — does NOT bridge once the payment has truly ended, even while pendingDecision is still null (e.g. an auto-passed human priority, or the opponent's turn)", () => {
  const bridged = shouldBridgeManaOverlayNull(
    state({ pendingDecision: null, manaPaymentActive: false, status: "running" }),
    true,
    TERMINAL,
  );
  assert.equal(bridged, false, "manaPaymentActive:false must close the overlay — this is the reported 'stuck until Cancel' bug");
});

it("never bridges once a real, non-null decision has arrived, regardless of manaPaymentActive", () => {
  const decision = { decisionId: "d-2", type: "priority_action", context: { turn: 1, phase: "main1", activePlayerId: "p1", priorityPlayerId: "p1" }, rendered: { kind: "menu" as const, title: "Priority", items: [] }, selectedCardRefs: null, combatPairings: null };
  const bridged = shouldBridgeManaOverlayNull(
    state({ pendingDecision: decision, manaPaymentActive: true, status: "waiting_for_human" }),
    true,
    TERMINAL,
  );
  assert.equal(bridged, false);
});

it("never bridges when the overlay is already closed (nothing to preserve)", () => {
  const bridged = shouldBridgeManaOverlayNull(
    state({ pendingDecision: null, manaPaymentActive: true, status: "running" }),
    false,
    TERMINAL,
  );
  assert.equal(bridged, false);
});

it("never bridges once the session has reached a terminal status, even mid-payment", () => {
  const bridged = shouldBridgeManaOverlayNull(
    state({ pendingDecision: null, manaPaymentActive: true, status: "completed" }),
    true,
    TERMINAL,
  );
  assert.equal(bridged, false, "a terminal status must always close the overlay, never leave it stuck");
});
