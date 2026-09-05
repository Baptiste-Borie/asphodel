import assert from "node:assert/strict";
import { it } from "node:test";
import { BaselineAsphodelAgent, validateChoice } from "./agent/baseline-agent.js";
import type { AgentCardObservation, AgentObservation, AgentSelfPlayerObservation, ForgePendingExternalDecision as Decision, ForgeExternalAction } from "./forge/forge-protocol.js";

const base = { decisionId: "d1", playerId: "self", context: { turn: 1, phase: "MAIN1", activePlayerId: "self", priorityPlayerId: "self", stackSize: 0 } };
const source = { actionId: null, cardRef: "source", cardName: "irrelevant", abilityText: null };
const card = (cardRef: string, power = 2, toughness = 2, extra: Partial<AgentCardObservation> = {}): AgentCardObservation => ({
  cardRef, name: "irrelevant", zone: "battlefield", ownerId: "self", controllerId: "self", faceDown: false, hidden: false,
  tapped: false, summoningSick: false, counters: {}, power, toughness, typeLine: "Creature", ...extra,
});
function observation(own: AgentCardObservation[] = [], enemy: AgentCardObservation[] = [], life = 40): AgentObservation {
  const self: AgentSelfPlayerObservation = { playerId: "self", role: "self", name: "self", life, startingLife: 40, handSize: 0, librarySize: 90,
    graveyardSize: 0, exileSize: 0, commandZoneSize: 1, battlefieldSize: own.length, externalController: true,
    battlefield: own, graveyard: [], exile: [], command: [], hand: [], commanders: [{ cardRef: "commander", name: "irrelevant", inCommandZone: true, castsFromCommand: 0 }] };
  const { hand: _, ...publicSelf } = self;
  return { gameRef: "game", game: base.context, selfPlayerId: "self", stack: [], players: [self,
    { ...publicSelf, playerId: "enemy", role: "opponent", battlefield: enemy, commanders: [], externalController: false }] };
}
const agent = new BaselineAsphodelAgent();
function choose(d: Decision, o = observation()) {
  const before = JSON.stringify({ o, d });
  const result = agent.choose(o, d);
  validateChoice(d, result);
  assert.deepEqual(agent.choose(structuredClone(o), structuredClone(d)), result);
  assert.equal(JSON.stringify({ o, d }), before);
  return result.choice;
}
const action = (id: string, type: "cast_spell" | "play_land" | "activate_ability", extra: Partial<Extract<ForgeExternalAction, { cardRef: string }>> = {}): ForgeExternalAction => ({ actionId: id, type, label: "irrelevant", cardRef: id, cardName: "irrelevant", sourceZone: "hand", abilityText: null, manaCost: null, requiresTargets: false, ...extra });
const pass: ForgeExternalAction = { actionId: "pass", type: "pass", label: "Pass", cardRef: null, cardName: null, sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false };
it("land precedes creature and commander", () => assert.equal(choose({ ...base, type: "priority_action", actions: [action("commander", "cast_spell", { sourceZone: "command" }), action("land", "play_land"), pass] }), "land"));
it("commander precedes other creatures", () => assert.equal(choose({ ...base, type: "priority_action", actions: [action("creature", "cast_spell"), action("commander", "cast_spell", { sourceZone: "command" })] }, observation([card("creature")])), "commander"));
it("creature precedes pass and other spells", () => assert.equal(choose({ ...base, type: "priority_action", actions: [pass, action("spell", "cast_spell"), action("creature", "cast_spell")] }, observation([card("creature")])), "creature"));
it("useful activation precedes other spell but unknown activation does not loop before pass", () => {
  assert.equal(choose({ ...base, type: "priority_action", actions: [action("spell", "cast_spell"), action("ability", "activate_ability", { abilityText: "Draw a card." }), pass] }), "ability");
  assert.equal(choose({ ...base, type: "priority_action", actions: [action("ability", "activate_ability"), pass] }), "pass");
});
it("X is the minimum positive legal value within every tested interval", () => {
  for (const [minValue, maxValue, expected] of [[0, 0, 0], [0, 9, 1], [3, 8, 3], [1, 1, 1]]) {
    assert.equal(choose({ ...base, type: "value_selection", source, prompt: null, valueKind: "x", minValue: minValue!, maxValue: maxValue!, suggestedValues: [] }), expected);
  }
});
it("optional costs conservatively decline", () => assert.equal(choose({ ...base, type: "optional_cost_selection", source, prompt: null, minSelections: 0, maxSelections: 1, declineCostId: "decline", costs: [{ costId: "k", type: "kicker", label: "Kicker", costText: "2" }] }), "decline"));
it("cost objects preserve commander and sacrifice the weakest visible card", () => {
  const options = ["commander", "big", "small"].map(objectId => ({ objectId, cardRef: objectId, name: null, zone: "battlefield", controllerId: "self", faceDown: false, hidden: false }));
  for (const selectionKind of ["sacrifice", "discard"] as const) assert.equal(choose({ ...base, type: "cost_object_selection", source, prompt: null, selectionKind, minSelections: 1, maxSelections: 1, selectedIds: [], canFinish: false, finishChoiceId: null, options }, observation([card("commander", 1, 1), card("big", 6, 6), card("small", 1, 1)])), "small");
  assert.equal(choose({ ...base, type: "cost_object_selection", source, prompt: null, selectionKind: "sacrifice", minSelections: 1, maxSelections: 1, selectedIds: [], canFinish: false, finishChoiceId: null, options: options.slice(0, 2) }, observation([card("commander", 1, 1), card("big", 2000, 2000)])), "big");
});
const mana = (id: string, produces: string[]) => ({ manaOptionId: id, type: "activate_mana_ability" as const, sourceCardRef: id, sourceCardName: null, abilityText: null, produces, tapped: false, manaRef: null, color: null });
it("mana uses floating first, exact colors, and avoids wasting a two-mana source", () => {
  const d: Extract<Decision, { type: "mana_payment" }> = { ...base, type: "mana_payment", source, remainingCost: { text: "1", generic: 1, convertedManaCost: 1, shards: [] }, manaPool: { total: 0, byColor: {} }, canFinish: false, options: [mana("double", ["C", "C"]), mana("single", ["R"])] };
  assert.equal(choose(d), "single");
  d.remainingCost = { text: "R", generic: 0, convertedManaCost: 1, shards: ["R"] };
  d.options = [mana("other", ["G"]), mana("red", ["R"])];
  assert.equal(choose(d), "red");
  d.options.push({ manaOptionId: "floating", type: "spend_floating_mana", manaRef: "m", color: "R", sourceCardRef: null, sourceCardName: null, abilityText: null, produces: ["R"], tapped: false });
  assert.equal(choose(d), "floating");
});
it("targets prefer hostile damage, friendly benefit, and stable unknown semantics", () => {
  const d: Extract<Decision, { type: "target_selection" }> = { ...base, type: "target_selection", source, prompt: "", minTargets: 1, maxTargets: 2, selectedTargetIds: [], canFinish: false, finishTargetId: "done", targets: ["self", "enemy"].map(id => ({ targetId: id, type: "player", label: id, playerId: id, name: id, controllerId: id, cardRef: null, stackRef: null, zone: null, hidden: false, faceDown: false })) };
  assert.equal(choose(d), "self");
  d.source = { ...source, abilityText: "Deal 2 damage to any target." };
  assert.equal(choose(d), "enemy");
  d.source = { ...source, abilityText: "Target player gains 3 life." };
  assert.equal(choose(d), "self");
  d.canFinish = true; d.selectedTargetIds = ["self"];
  assert.equal(choose(d), "done");
});
it("modes prefer draw and finish after minimum", () => {
  const d: Extract<Decision, { type: "mode_selection" }> = { ...base, type: "mode_selection", source, prompt: null, minModes: 1, maxModes: 2, selectedModeIds: [], canFinish: false, finishModeId: "done", modes: [{ modeId: "life", label: "Gain 3 life", description: null }, { modeId: "draw", label: "Draw a card", description: null }] };
  assert.equal(choose(d), "draw"); d.selectedModeIds = ["draw"]; d.canFinish = true; assert.equal(choose(d), "done");
});
const selection = (selectionKind: string, ids: string[]): Extract<Decision, { selectionKind: string; type: "yes_no" | "object_selection" | "ordering_selection" }> => ({ ...base, type: "object_selection", selectionKind, prompt: "", source, options: ids.map(objectId => ({ objectId, label: objectId, cardRef: objectId, finish: false })), selected: [], minSelections: 1, maxSelections: 1, canFinish: false });
it("legend rule retains the stronger permanent", () => assert.equal(choose({ ...selection("entity", ["small", "big"]), prompt: "Choose a legendary permanent to keep" }, observation([card("small", 1, 1), card("big", 5, 5)])), "big"));
it("unknown generic selections fall back deterministically to supplied order", () => assert.equal(choose(selection("future_kind", ["z", "a"])), "z"));
it("yes/no accepts benefits and declines explicit self costs", () => {
  const d = { ...selection("confirm", ["Yes", "No"]), type: "yes_no" as const, prompt: "Draw a card?" };
  assert.equal(choose(d), "Yes"); assert.equal(choose({ ...d, prompt: "Pay 5 life?" }), "No");
});
it("scry keeps unknown revealed cards and sends visibly low-value lands", () => {
  const d = selection("scry_top", ["land"]); d.canFinish = true; d.options.push({ objectId: "done", label: "Finish", cardRef: null, finish: true });
  assert.equal(choose(d), "land");
  assert.equal(choose(d, observation([card("land", 0, 0, { typeLine: "Land" })])), "done");
});
const combat = (type: "attackers_selection" | "blockers_selection", relatedRef: string): Extract<Decision, { type: "attackers_selection" | "blockers_selection" | "combat_order_selection" }> => ({ ...base, type, selected: [], options: [
  { objectId: "add", operation: "add", cardRef: "own", relatedRef, label: "" }, { objectId: "finish", operation: "finish", cardRef: null, relatedRef: null, label: "" },
] });
it("attacks an open opponent but avoids obvious suicide and holds a blocker at low life", () => {
  const d = combat("attackers_selection", "enemy");
  assert.equal(choose(d, observation([card("own")])), "add");
  assert.equal(choose(d, observation([card("own")], [card("foe", 4, 4)])), "finish");
  assert.equal(choose(d, observation([card("own", 5, 5)], [card("foe", 2, 2)], 5)), "finish");
});
it("blocks favorably, avoids bad trades, and chumps under life pressure", () => {
  const d = combat("blockers_selection", "foe");
  assert.equal(choose(d, observation([card("own", 4, 4)], [card("foe", 2, 2)])), "add");
  assert.equal(choose(d, observation([card("own", 1, 1)], [card("foe", 4, 4)])), "finish");
  assert.equal(choose(d, observation([card("own", 1, 1)], [card("foe", 4, 4)], 3)), "add");
});
it("only offered mandatory combat edits can be returned", () => {
  const d = combat("attackers_selection", "enemy"); d.options = d.options.filter(o => o.operation === "add");
  assert.equal(choose(d, observation([card("own")], [card("foe", 9, 9)])), "add");
});
it("does not read opponent hidden zones or use card names", () => {
  const o = observation([card("own")]);
  Object.defineProperty(o.players[1], "hand", { get() { throw new Error("hidden hand accessed"); } });
  Object.defineProperty(o.players[1], "library", { get() { throw new Error("hidden library accessed"); } });
  Object.defineProperty(o.players[0]!.battlefield[0], "name", { get() { throw new Error("name accessed"); } });
  assert.equal(agent.choose(o, { ...base, type: "priority_action", actions: [pass, action("own", "cast_spell")] }).choice, "own");
});
it("rejects wrong IDs, selector families, players, out-of-bounds and fractional X", () => {
  const d: Decision = { ...base, type: "priority_action", actions: [pass] };
  for (const choice of [{ decisionId: "old", kind: "action" as const, choice: "pass", reason: "test" }, { decisionId: "d1", kind: "target" as const, choice: "pass", reason: "test" }, { decisionId: "d1", kind: "action" as const, choice: "invented", reason: "test" }]) assert.throws(() => validateChoice(d, choice));
  assert.throws(() => agent.choose({ ...observation(), selfPlayerId: "wrong" }, d));
  const x: Decision = { ...base, type: "value_selection", source, prompt: null, valueKind: "x", minValue: 0, maxValue: 2, suggestedValues: [] };
  for (const value of [-1, 3, 1.5, NaN]) assert.throws(() => validateChoice(x, { decisionId: "d1", kind: "value", choice: value, reason: "test" }));
});
it("empty options fail closed", () => assert.throws(() => agent.choose(observation(), { ...base, type: "priority_action", actions: [] }), /agent_no_legal_options/));
