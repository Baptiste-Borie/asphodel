import assert from "node:assert/strict";
import { it } from "node:test";
import { autoPassChoice } from "./human/priority-auto-pass.js";
import type { ForgeExternalAction, ForgePendingExternalDecision as Decision } from "./forge/forge-protocol.js";

const context = { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 0 };
const pass: ForgeExternalAction = { actionId: "action-1", type: "pass", label: "Pass priority", cardRef: null, cardName: null, sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false };
const cast: ForgeExternalAction = { actionId: "action-2", type: "cast_spell", label: "Cast Putrefy", cardRef: "card-1", cardName: "Putrefy", sourceZone: "hand", abilityText: null, manaCost: "1 B B", requiresTargets: true };

function priorityDecision(actions: ForgeExternalAction[]): Extract<Decision, { type: "priority_action" }> {
  return { decisionId: "decision-1", type: "priority_action", playerId: "player-1", context, actions };
}

it("auto-submits the exact pass choice when it is the only legal priority action", () => {
  const choice = autoPassChoice(priorityDecision([pass]));
  assert.deepEqual(choice, { decisionId: "decision-1", kind: "action", choice: "action-1", reason: "auto_pass_no_other_legal_action" });
});

it("stops for the human when any other legal action exists alongside pass", () => {
  assert.equal(autoPassChoice(priorityDecision([cast, pass])), null);
  assert.equal(autoPassChoice(priorityDecision([pass, cast])), null);
});

it("stops for the human when there is a single legal action that is not pass (should not happen, but never guessed)", () => {
  assert.equal(autoPassChoice(priorityDecision([cast])), null);
});

it("never auto-answers any other decision family", () => {
  const target: Decision = {
    decisionId: "d", type: "target_selection", playerId: "player-1", context,
    source: { actionId: null, cardRef: "c", cardName: "Putrefy", abilityText: null },
    prompt: "Choose a target", minTargets: 1, maxTargets: 1, selectedTargetIds: [], canFinish: false, finishTargetId: null,
    targets: [],
  };
  assert.equal(autoPassChoice(target), null);
  const yesNo: Decision = {
    decisionId: "d", type: "yes_no", playerId: "player-1", context, selectionKind: "confirm", prompt: "Sure?",
    source: null, options: [{ objectId: "yes", label: "Yes", cardRef: null, finish: false }], selected: [], minSelections: 1, maxSelections: 1, canFinish: false,
  };
  assert.equal(autoPassChoice(yesNo), null);
});
