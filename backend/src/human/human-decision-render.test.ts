import assert from "node:assert/strict";
import { it } from "node:test";
import { validateHumanChoice as validateChoice } from "./validate-human-choice.js";
import { describeDecision } from "./human-decision-render.js";
import type { AgentObservation, AgentSelfPlayerObservation, ForgePendingCombatDecision, ForgePendingExternalDecision as Decision, ForgePendingManaPaymentDecision } from "../forge/forge-protocol.js";

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

it("target_selection (V2e.5): a card target carries its cardRef, a player target carries null", () => {
  const targetDecision: Extract<Decision, { type: "target_selection" }> = {
    decisionId: "d-2", type: "target_selection", playerId: "player-1",
    context: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 1 },
    source: { actionId: null, cardRef: "spell-1", cardName: "Putrefy", abilityText: null },
    prompt: "Choose a target", minTargets: 1, maxTargets: 1, selectedTargetIds: [], canFinish: false, finishTargetId: null,
    targets: [
      { targetId: "t-1", type: "player", label: "Opponent", playerId: "player-2", cardRef: null, stackRef: null, name: "player-2", zone: null, controllerId: "player-2", faceDown: false, hidden: false },
      { targetId: "t-2", type: "card", label: "Sol Ring", playerId: null, cardRef: "sol-ring-1", stackRef: null, name: "Sol Ring", zone: "battlefield", controllerId: "player-2", faceDown: false, hidden: false },
    ],
  };
  const prompt = describeDecision(observation(), targetDecision);
  assert.equal(prompt.kind, "menu");
  if (prompt.kind !== "menu") return;
  const byTargetId = new Map(prompt.items.map(i => [i.choice.choice, i.cardRef]));
  assert.equal(byTargetId.get("t-1"), null, "a player target has no card to click");
  assert.equal(byTargetId.get("t-2"), "sol-ring-1", "a card target carries its own cardRef");
});

it("attackers_selection (V2e.5): an add/remove option carries its cardRef; finish carries null", () => {
  const combatDecision: ForgePendingCombatDecision = {
    decisionId: "d-4", type: "attackers_selection", playerId: "player-1",
    context: { turn: 1, phase: "combat_declare_attackers", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 0 },
    options: [
      { objectId: "o-1", operation: "add" as const, cardRef: "krenko-1", relatedRef: "player-2", label: "Add" },
      { objectId: "o-2", operation: "finish" as const, cardRef: null, relatedRef: null, label: "Finish" },
    ],
    selected: [],
  };
  const prompt = describeDecision(observation(), combatDecision);
  assert.equal(prompt.kind, "menu");
  if (prompt.kind !== "menu") return;
  const byObjectId = new Map(prompt.items.map(i => [i.choice.choice, i.cardRef]));
  assert.equal(byObjectId.get("o-1"), "krenko-1");
  assert.equal(byObjectId.get("o-2"), null);
});

it("cost_object_selection (V2e.5, e.g. sacrifice) carries each option's cardRef", () => {
  const costDecision: Extract<Decision, { type: "cost_object_selection" }> = {
    decisionId: "d-5", type: "cost_object_selection", playerId: "player-1",
    context: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 0 },
    source: { actionId: null, cardRef: null, cardName: null, abilityText: null },
    prompt: "Sacrifice a creature", selectionKind: "sacrifice", minSelections: 1, maxSelections: 1,
    selectedIds: [], canFinish: false, finishChoiceId: null,
    options: [{ objectId: "o-1", cardRef: "bear-cub-1", name: "Bear Cub", zone: "battlefield", controllerId: "player-1", faceDown: false, hidden: false }],
  };
  const prompt = describeDecision(observation(), costDecision);
  assert.equal(prompt.kind, "menu");
  if (prompt.kind !== "menu") return;
  assert.equal(prompt.items[0]?.cardRef, "bear-cub-1");
});

it("decision families with no per-item card (mode/value) still leave MenuItem.cardRef unset", () => {
  const modeDecision: Extract<Decision, { type: "mode_selection" }> = {
    decisionId: "d-3", type: "mode_selection", playerId: "player-1",
    context: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 0 },
    source: { actionId: null, cardRef: null, cardName: null, abilityText: null },
    prompt: "Choose a mode", minModes: 1, maxModes: 1, selectedModeIds: [], canFinish: false, finishModeId: null,
    modes: [{ modeId: "m-1", label: "Draw a card", description: null }],
  };
  const prompt = describeDecision(observation(), modeDecision);
  assert.equal(prompt.kind, "menu");
  if (prompt.kind !== "menu") return;
  for (const item of prompt.items) assert.equal(item.cardRef, undefined);
});

function manaPaymentDecision(options: ForgePendingManaPaymentDecision["options"]): ForgePendingManaPaymentDecision {
  return {
    decisionId: "d-6", type: "mana_payment", playerId: "player-1",
    context: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 1 },
    source: { actionId: null, cardRef: "spell-1", cardName: "Krenko, Tin Street Kingpin", abilityText: null },
    remainingCost: { text: "{2}{R}{R}", generic: 2, convertedManaCost: 4, shards: ["R", "R"] },
    manaPool: { total: 0, byColor: {} },
    options,
    canFinish: false,
  };
}

it("mana_payment (V2e.5.1): a land/permanent source option carries its exact sourceCardRef", () => {
  const prompt = describeDecision(observation(), manaPaymentDecision([
    { manaOptionId: "opt-1", type: "activate_mana_ability", sourceCardRef: "mtn-1", sourceCardName: "Mountain", abilityText: null, produces: ["R"], tapped: false, manaRef: null, color: null },
  ]));
  assert.equal(prompt.kind, "menu");
  if (prompt.kind !== "menu") return;
  assert.equal(prompt.items[0]?.cardRef, "mtn-1");
});

it("mana_payment (V2e.5.1): floating mana has no physical source, so cardRef is null", () => {
  const prompt = describeDecision(observation(), manaPaymentDecision([
    { manaOptionId: "opt-float", type: "spend_floating_mana", manaRef: "floating-1", color: "R", sourceCardRef: null, sourceCardName: null, abilityText: null, produces: ["R"], tapped: false },
  ]));
  assert.equal(prompt.kind, "menu");
  if (prompt.kind !== "menu") return;
  assert.equal(prompt.items[0]?.cardRef, null);
});

it("mana_payment (V2e.5.1): two same-named Mountains are two distinct mana sources, never conflated by name", () => {
  const prompt = describeDecision(observation(), manaPaymentDecision([
    { manaOptionId: "opt-1", type: "activate_mana_ability", sourceCardRef: "mtn-1", sourceCardName: "Mountain", abilityText: null, produces: ["R"], tapped: false, manaRef: null, color: null },
    { manaOptionId: "opt-2", type: "activate_mana_ability", sourceCardRef: "mtn-2", sourceCardName: "Mountain", abilityText: null, produces: ["R"], tapped: false, manaRef: null, color: null },
  ]));
  assert.equal(prompt.kind, "menu");
  if (prompt.kind !== "menu") return;
  const refs = prompt.items.map(i => i.cardRef);
  assert.deepEqual(refs, ["mtn-1", "mtn-2"]);
  assert.equal(new Set(refs).size, 2, "same-named sources must keep distinct cardRefs");
});

it("mana_payment (V2e.5.1): a multi-color source (e.g. Command Tower) preserves every exact option under the same cardRef", () => {
  const prompt = describeDecision(observation(), manaPaymentDecision([
    { manaOptionId: "opt-w", type: "activate_mana_ability", sourceCardRef: "tower-1", sourceCardName: "Command Tower", abilityText: null, produces: ["W"], tapped: false, manaRef: null, color: null },
    { manaOptionId: "opt-u", type: "activate_mana_ability", sourceCardRef: "tower-1", sourceCardName: "Command Tower", abilityText: null, produces: ["U"], tapped: false, manaRef: null, color: null },
  ]));
  assert.equal(prompt.kind, "menu");
  if (prompt.kind !== "menu") return;
  const sameSource = prompt.items.filter(i => i.cardRef === "tower-1");
  assert.equal(sameSource.length, 2, "both color options for the same source must both be preserved, not collapsed into one");
  assert.deepEqual(sameSource.map(i => i.choice.choice), ["opt-w", "opt-u"]);
});

it("exposes and validates cancellation only when the pending Forge payment supplies it", () => {
  const decision = manaPaymentDecision([]);
  const cancel = { decisionId: decision.decisionId, kind: 'mana' as const, choice: 'cancel-exact', reason: 'human_choice' };
  assert.throws(() => validateChoice(decision, cancel));
  decision.cancelChoiceId = 'cancel-exact';
  const prompt = describeDecision(observation(), decision);
  assert.equal(prompt.kind, 'menu');
  if (prompt.kind !== 'menu') return;
  assert.deepEqual(prompt.items.map(i => [i.control, i.choice.choice, i.cardRef]), [['cancel','cancel-exact',null]]);
  assert.doesNotThrow(() => validateChoice(decision, cancel));
  assert.throws(() => validateChoice(decision, {...cancel, choice: 'invented'}));
  assert.throws(() => validateChoice(decision, {...cancel, decisionId: 'stale'}));
  assert.equal(decision.options.length, 0, 'agent mana options remain unchanged');
});
