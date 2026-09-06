import assert from "node:assert/strict";
import { it } from "node:test";
import { combatSelectedCardRefs } from "./combat-selection.js";
import type { WebPendingDecisionDTO } from "./types.js";

function decision(overrides: Partial<WebPendingDecisionDTO>): WebPendingDecisionDTO {
  return {
    decisionId: "d-1", type: "attackers_selection",
    context: { turn: 1, phase: "combat_declare_attackers", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 0 },
    rendered: { kind: "menu", title: "Declare attackers", items: [] },
    selectedCardRefs: null,
    ...overrides,
  };
}

it("a declared attacker is reported as combat-selected", () => {
  const refs = combatSelectedCardRefs(decision({ type: "attackers_selection", selectedCardRefs: ["krenko-1"] }));
  assert.ok(refs?.has("krenko-1"));
});

it("removing the attacker (no longer in selectedCardRefs) loses the combat-selected state", () => {
  const refs = combatSelectedCardRefs(decision({ type: "attackers_selection", selectedCardRefs: [] }));
  assert.equal(refs?.has("krenko-1"), false);
});

it("works identically for blockers_selection", () => {
  const refs = combatSelectedCardRefs(decision({ type: "blockers_selection", selectedCardRefs: ["wall-1"] }));
  assert.ok(refs?.has("wall-1"));
});

it("is null for every other decision type — never fabricated", () => {
  assert.equal(combatSelectedCardRefs(decision({ type: "priority_action", selectedCardRefs: null })), null);
  assert.equal(combatSelectedCardRefs(decision({ type: "target_selection", selectedCardRefs: null })), null);
  assert.equal(combatSelectedCardRefs(decision({ type: "combat_order_selection", selectedCardRefs: null })), null);
});

it("is null when there is no pending decision at all", () => {
  assert.equal(combatSelectedCardRefs(null), null);
});

it("returns cardRefs only — never anything derived from a card's own tapped state", () => {
  // The whole point: a card can be selected (attacking) while untapped (vigilance) or tapped
  // (normal attack) — this function knows nothing about tapped at all, by construction.
  const refs = combatSelectedCardRefs(decision({ type: "attackers_selection", selectedCardRefs: ["vigilance-creature-1"] }));
  assert.deepEqual([...refs!], ["vigilance-creature-1"]);
});
