import assert from "node:assert/strict";
import { it } from "node:test";
import { describeDecision } from "./human-decision-render.js";
import type { AgentObservation, AgentSelfPlayerObservation, ForgePendingExternalDecision as Decision } from "../forge/forge-protocol.js";

function observation(): AgentObservation {
  const self: AgentSelfPlayerObservation = {
    role: "self", playerId: "player-1", name: "player-1", life: 40, startingLife: 40, handSize: 2, librarySize: 50,
    graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: 0, externalController: true,
    hand: [], battlefield: [], graveyard: [], exile: [], command: [], commanders: [],
  };
  return {
    selfPlayerId: "player-1", gameRef: "g", game: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1" }, stack: [],
    players: [self, { ...self, role: "opponent", playerId: "player-2" }],
  };
}

function priorityDecision(): Extract<Decision, { type: "priority_action" }> {
  return {
    decisionId: "d-1", type: "priority_action", playerId: "player-1",
    context: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 0 },
    actions: [
      { actionId: "pass", type: "pass", label: "Pass priority", cardRef: null, cardName: null, sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false },
      { actionId: "play-mtn-1", type: "play_land", label: "Play Mountain", cardRef: "mtn-1", cardName: "Mountain", sourceZone: "hand", abilityText: null, manaCost: null, requiresTargets: false },
      { actionId: "play-mtn-2", type: "play_land", label: "Play Mountain", cardRef: "mtn-2", cardName: "Mountain", sourceZone: "hand", abilityText: null, manaCost: null, requiresTargets: false },
    ],
  };
}

it("priority_action items carry the exact Forge cardRef for card-backed actions, and null for pass", () => {
  const prompt = describeDecision(observation(), priorityDecision());
  assert.equal(prompt.kind, "menu");
  if (prompt.kind !== "menu") return;
  const pass = prompt.items.find(i => i.label === "Pass priority")!;
  assert.equal(pass.cardRef, null);
  const byCardRef = new Map(prompt.items.map(i => [i.cardRef, i.label]));
  assert.equal(byCardRef.get("mtn-1"), "Play Mountain");
  assert.equal(byCardRef.get("mtn-2"), "Play Mountain");
  assert.notEqual("mtn-1", "mtn-2", "two same-named cards must still carry distinct cardRefs");
});

it("non-priority_action decisions leave MenuItem.cardRef unset — this patch never touched them", () => {
  const targetDecision: Extract<Decision, { type: "target_selection" }> = {
    decisionId: "d-2", type: "target_selection", playerId: "player-1",
    context: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 1 },
    source: { actionId: null, cardRef: "spell-1", cardName: "Putrefy", abilityText: null },
    prompt: "Choose a target", minTargets: 1, maxTargets: 1, selectedTargetIds: [], canFinish: false, finishTargetId: null,
    targets: [{ targetId: "t-1", type: "player", label: "Opponent", playerId: "player-2", cardRef: null, stackRef: null, name: "player-2", zone: null, controllerId: "player-2", faceDown: false, hidden: false }],
  };
  const prompt = describeDecision(observation(), targetDecision);
  assert.equal(prompt.kind, "menu");
  if (prompt.kind !== "menu") return;
  for (const item of prompt.items) assert.equal(item.cardRef, undefined);
});
