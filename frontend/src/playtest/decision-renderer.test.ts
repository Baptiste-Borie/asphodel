import assert from "node:assert/strict";
import { it } from "node:test";
import { describeDecisionFamily } from "./decision-renderer.js";

it("maps every known Forge decision type to a human label, never the raw type string", () => {
  assert.equal(describeDecisionFamily("priority_action"), "Priority");
  assert.equal(describeDecisionFamily("attackers_selection"), "Combat — Attackers");
  assert.equal(describeDecisionFamily("blockers_selection"), "Combat — Blockers");
  assert.equal(describeDecisionFamily("combat_order_selection"), "Combat — Order");
  assert.equal(describeDecisionFamily("mana_payment"), "Mana Payment");
  assert.equal(describeDecisionFamily("yes_no"), "Confirm");
});

it("falls back to a generic label for an unrecognized type instead of throwing", () => {
  assert.equal(describeDecisionFamily("something_new"), "Decision");
});
