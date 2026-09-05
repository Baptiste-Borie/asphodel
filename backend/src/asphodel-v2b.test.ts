import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { BaselineAsphodelAgentV2a } from "./agent/policy-version.js";
import { BaselineAsphodelAgentV2b } from "./agent/improved-agent.js";
import { validateChoice } from "./agent/baseline-agent.js";
import { EvaluationDiagnostics } from "./agent/evaluation-diagnostics.js";
import { aggregateGames, evaluateAgent, type EvaluatedGame } from "./agent/evaluate-agent.js";
import type { AgentMatchTransport } from "./agent/agent-runner.js";
import type { AgentCardObservation as Card, AgentObservation, AgentSelfPlayerObservation, ForgePendingExternalDecision as Decision, ForgeExternalAction, ForgePendingCombatDecision, ForgeExternalMatchProgress, ForgeExternalMatchSnapshot } from "./forge/forge-protocol.js";

const context = { turn: 1, phase: "main1", activePlayerId: "self", priorityPlayerId: "self", stackSize: 0 };
const base = { decisionId: "d", playerId: "self", context };
const source = { actionId: null, cardRef: "source", cardName: "unused", abilityText: null };
const body = (cardRef: string, power = 2, toughness = 2, extra: Partial<Card> = {}): Card => ({ cardRef, name: "unused", zone: "battlefield", ownerId: "self", controllerId: "self", hidden: false, faceDown: false, tapped: false, summoningSick: false, power, toughness, counters: {}, typeLine: "Creature", combatKeywords: [], selfAttackTriggers: [], ...extra });
function observation(own: Card[] = [], enemy: Card[] = [], life = 40, enemyLife = 40): AgentObservation {
  const self: AgentSelfPlayerObservation = { role: "self", playerId: "self", name: "Self", life, startingLife: 40, handSize: 0, librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: own.length, externalController: true, hand: [], battlefield: own, graveyard: [], exile: [], command: [], commanders: [] };
  const { hand: _, ...publicSelf } = self;
  return { selfPlayerId: "self", gameRef: "game", game: context, stack: [], players: [self,
    { ...publicSelf, role: "opponent", playerId: "enemy", externalController: false, life: enemyLife, battlefield: enemy.map(c => ({ ...c, controllerId: "enemy" })) }] };
}
const agent = new BaselineAsphodelAgentV2b();
function choose(o: AgentObservation, d: Decision) {
  const before = JSON.stringify({ o, d });
  const c = agent.choose(o, d);
  validateChoice(d, c);
  assert.deepEqual(agent.choose(structuredClone(o), structuredClone(d)), c);
  assert.equal(JSON.stringify({ o, d }), before);
  return c;
}
function combat(type: "attackers_selection" | "blockers_selection", refs = ["own"]): ForgePendingCombatDecision {
  return { ...base, type, selected: [], options: [...refs.map(ref => ({ objectId: ref, operation: "add" as const, cardRef: ref, relatedRef: type === "attackers_selection" ? "enemy" : "foe", label: "" })),
    { objectId: "finish", operation: "finish", cardRef: null, relatedRef: null, label: "" }] };
}
const pass: ForgeExternalAction = { actionId: "pass", type: "pass", label: "", cardRef: null, cardName: null, sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false };
const action = (ref: string, type: "cast_spell" | "play_land", manaCost = "2 R"): ForgeExternalAction => ({ actionId: ref, type, label: "", cardRef: ref, cardName: "unused", sourceZone: "hand", manaCost, abilityText: null, requiresTargets: false });
it("V2a source remains byte-for-byte frozen at its validated commit", async () => {
  const bytes = await readFile(new URL("./agent/baseline-agent.ts", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "2f11293a555a65d8b3b84b764147ed925783b5cb710e52cfe528b7a05021f118");
  assert.equal(new BaselineAsphodelAgentV2a().version, "v2a"); assert.equal(agent.version, "v2b");
});
it("takes obvious free damage against a tapped blocker", () => {
  const c = choose(observation([body("own")], [body("foe", 8, 8, { tapped: true })]), combat("attackers_selection"));
  assert.equal(c.choice, "own"); assert.equal(c.reason, "attack_free_damage");
});
it("avoids an obvious losing attack", () => {
  const c = choose(observation([body("own", 1, 1)], [body("foe", 5, 5)]), combat("attackers_selection"));
  assert.equal(c.choice, "finish"); assert.equal(c.reason, "hold_bad_trade");
});
it("uses public flying and menace without assuming they are unblockable against valid defenders", () => {
  for (const keyword of ["flying", "menace"]) {
    assert.equal(choose(observation([body("own", 1, 1, { combatKeywords: [keyword] })], [body("foe", 5, 5)]), combat("attackers_selection")).choice, "own");
  }
  assert.equal(choose(observation([body("own", 1, 1, { combatKeywords: ["flying"] })], [body("foe", 5, 5, { combatKeywords: ["reach"] })]), combat("attackers_selection")).choice, "finish");
});
it("takes a count-based lethal group attack despite a stronger blocker", () => {
  const c = choose(observation([body("own", 3, 3), body("second", 3, 3)], [body("foe", 5, 5)], 40, 3), combat("attackers_selection", ["own", "second"]));
  assert.equal(c.reason, "attack_visible_lethal");
});
it("values generic public self-attack benefits but not harmful triggers", () => {
  const d = combat("attackers_selection");
  const o = observation([body("own", 1, 2, { selfAttackTriggers: ["Whenever CARDNAME attacks, create two creature tokens."] })], [body("foe", 4, 4)]);
  assert.equal(choose(o, d).reason, "attack_visible_trigger_value");
  o.players[0]!.battlefield[0]!.selfAttackTriggers = ["Whenever CARDNAME attacks, sacrifice another creature."];
  assert.equal(choose(o, d).choice, "finish");
});
it("respects visible deathtouch instead of attacking a smaller lethal blocker", () => {
  assert.equal(choose(observation([body("own", 5, 5)], [body("foe", 1, 1, { combatKeywords: ["deathtouch"] })]), combat("attackers_selection")).choice, "finish");
});
it("takes a favorable block and avoids an unnecessary bad block", () => {
  const d = combat("blockers_selection");
  assert.equal(choose(observation([body("own", 4, 4)], [body("foe", 2, 2)]), d).reason, "block_without_loss");
  assert.equal(choose(observation([body("own", 1, 1)], [body("foe", 4, 4)]), d).choice, "finish");
});
it("prevents lethal pressure including attackers with no legal block option", () => {
  const d = combat("blockers_selection");
  d.attackers = [{ cardRef: "foe", relatedRef: "self" }, { cardRef: "unblockable", relatedRef: "self" }];
  assert.equal(choose(observation([body("own", 1, 1)], [body("foe", 4, 4), body("unblockable", 6, 6)], 10), d).reason, "block_prevent_lethal_pressure");
});
it("does not add another blocker to an already profitable block", () => {
  const d = combat("blockers_selection"); d.selected = [{ cardRef: "partner", relatedRef: "foe" }];
  assert.equal(choose(observation([body("own", 2, 2), body("partner", 5, 5)], [body("foe", 2, 2)]), d).choice, "finish");
});
it("preserves the more valuable commander when a chump is necessary", () => {
  const o = observation([body("own", 1, 1), body("token", 1, 1)], [body("foe", 10, 10)], 5);
  o.players[0]!.commanders.push({ cardRef: "own", name: "unused", inCommandZone: false, castsFromCommand: 1 });
  assert.equal(choose(o, combat("blockers_selection", ["own", "token"])).choice, "token");
});
it("develops mana before spells and never passes over a visible creature", () => {
  const o = observation([body("own")]);
  assert.equal(choose(o, { ...base, type: "priority_action", actions: [pass, action("own", "cast_spell"), action("land", "play_land")] }).choice, "land");
  assert.equal(choose(o, { ...base, type: "priority_action", actions: [pass, action("own", "cast_spell")] }).choice, "own");
});
it("uses mana-efficient creature ordering once a board exists", () => {
  const o = observation([body("own"), body("cheap", 0, 0, { zone: "hand" }), body("expensive", 0, 0, { zone: "hand" })]);
  assert.equal(choose(o, { ...base, type: "priority_action", actions: [action("cheap", "cast_spell", "R"), action("expensive", "cast_spell", "3 R")] }).choice, "expensive");
});
it("targets a stronger hostile permanent and lethal player before nonlethal damage", () => {
  const o = observation([], [body("small", 1, 1), body("big", 6, 6)], 40, 2);
  const d: Extract<Decision, { type: "target_selection" }> = { ...base, type: "target_selection", source: { ...source, abilityText: "Destroy target creature." }, prompt: "", minTargets: 1, maxTargets: 1, selectedTargetIds: [], canFinish: false, finishTargetId: null,
    targets: ["small", "big"].map(ref => ({ targetId: ref, type: "card", cardRef: ref, controllerId: "enemy", label: "", name: null, zone: "battlefield", playerId: null, stackRef: null, hidden: false, faceDown: false })) };
  assert.equal(choose(o, d).choice, "big");
  d.source.abilityText = "Deal 2 damage to any target.";
  d.targets.push({ targetId: "player", type: "player", cardRef: null, controllerId: "enemy", label: "", name: "", zone: null, playerId: "enemy", stackRef: null, hidden: false, faceDown: false });
  assert.equal(choose(o, d).choice, "player");
});
it("beneficial targets prefer the stronger own permanent over the enemy", () => {
  const o = observation([body("own", 5, 5)], [body("foe", 8, 8)]);
  const d: Decision = { ...base, type: "target_selection", source: { ...source, abilityText: "Target creature gets +2/+2." }, prompt: "", minTargets: 1, maxTargets: 1, selectedTargetIds: [], canFinish: false, finishTargetId: null,
    targets: ["foe", "own"].map(ref => ({ targetId: ref, type: "card", cardRef: ref, controllerId: ref === "own" ? "self" : "enemy", label: "", name: null, zone: "battlefield", playerId: null, stackRef: null, hidden: false, faceDown: false })) };
  assert.equal(choose(o, d).choice, "own");
});
it("preserves flexible mana and avoids excess production while using floating mana first", () => {
  const option = (id: string, produces: string[]) => ({ manaOptionId: id, type: "activate_mana_ability" as const, sourceCardRef: id, sourceCardName: null, abilityText: null, produces, tapped: false, manaRef: null, color: null });
  const d: Extract<Decision, { type: "mana_payment" }> = { ...base, type: "mana_payment", source, remainingCost: { text: "R", generic: 0, convertedManaCost: 1, shards: ["R"] }, manaPool: { total: 0, byColor: {} }, canFinish: false,
    options: [option("flex", ["Any"]), option("double", ["C", "C"]), option("red", ["R"])] };
  assert.equal(choose(observation(), d).choice, "red");
  d.options.push({ manaOptionId: "float", type: "spend_floating_mana", manaRef: "m", color: "R", sourceCardRef: null, sourceCardName: null, abilityText: null, produces: [], tapped: false });
  assert.equal(choose(observation(), d).choice, "float");
});
it("scaling X uses native legal bounds and unknown X remains conservative", () => {
  const d: Extract<Decision, { type: "value_selection" }> = { ...base, type: "value_selection", source: { ...source, abilityText: "Draw X cards." }, prompt: null, valueKind: "x", minValue: 0, maxValue: 4, suggestedValues: [] };
  assert.equal(choose(observation(), d).choice, 4);
  d.source.abilityText = null; assert.equal(choose(observation(), d).choice, 1);
});
it("modes penalize a self cost and yes/no declines unknown effects", () => {
  const d: Decision = { ...base, type: "mode_selection", source, prompt: null, minModes: 1, maxModes: 1, selectedModeIds: [], canFinish: false, finishModeId: null, modes: [{ modeId: "cost", label: "Draw cards and sacrifice a creature", description: null }, { modeId: "tokens", label: "Create two tokens", description: null }] };
  assert.equal(choose(observation(), d).choice, "tokens");
  assert.equal(choose(observation(), { ...base, type: "yes_no", selectionKind: "confirm", prompt: "Unknown effect?", source, options: ["Yes", "No"].map(id => ({ objectId: id, label: id, cardRef: null, finish: false })), selected: [], minSelections: 1, maxSelections: 1, canFinish: false }).choice, "No");
});
it("V2b does not inspect hidden zones or card identities", () => {
  const o = observation([body("own")]);
  for (const field of ["hand", "library"]) Object.defineProperty(o.players[1], field, { get() { throw new Error("hidden"); } });
  Object.defineProperty(o.players[0]!.battlefield[0], "name", { get() { throw new Error("name"); } });
  assert.equal(agent.choose(o, combat("attackers_selection")).choice, "own");
});
it("diagnostics deduplicate attack opportunities across edits and do not count removals as attacks", () => {
  const diagnostics = new EvaluationDiagnostics(); const o = observation([body("own")]); const d = combat("attackers_selection");
  diagnostics.record(o, d, { decisionId: "d", kind: "object", choice: "own", reason: "attack" });
  d.options[0]!.operation = "remove";
  diagnostics.record(o, d, { decisionId: "d2", kind: "object", choice: "own", reason: "remove" });
  diagnostics.record(o, d, { decisionId: "d3", kind: "object", choice: "finish", reason: "finish" });
  assert.equal(diagnostics.result().attackOpportunities, 1); assert.equal(diagnostics.result().attacksTaken, 0);
});
it("aggregate rates retain failed games and means disclose missing measurements", () => {
  const diagnostics = new EvaluationDiagnostics().result();
  const failed: EvaluatedGame = { seed: 1, policyVersion: "test", status: "timeout", error: "timeout", winner: null, metrics: null, diagnostics };
  const aggregate = aggregateGames([failed]);
  assert.equal(aggregate.completionRate, 0); assert.equal(aggregate.timeoutErrorRate, 1); assert.equal(aggregate.averageDamage, null);
  assert.equal(aggregate.attackConversionRate, null); assert.equal(aggregate.winRate, 0);
});

const progress: ForgeExternalMatchProgress = {
  decisionsRequested: 0, decisionsSubmitted: 0, passesSubmitted: 0, primaryActionsSubmitted: 0, primaryActionsPlayed: 0, landsPlayed: 0, spellsCast: 0, abilitiesActivated: 0,
  targetDecisionsRequested: 0, targetDecisionsSubmitted: 0, targetsSelected: 0, modeDecisionsRequested: 0, modeDecisionsSubmitted: 0, modesSelected: 0,
  valueDecisionsRequested: 0, valueDecisionsSubmitted: 0, optionalCostDecisionsRequested: 0, optionalCostsSelected: 0, costObjectDecisionsRequested: 0, costObjectsSelected: 0,
  manaPaymentDecisionsRequested: 0, manaPaymentDecisionsSubmitted: 0, manaOptionsSelected: 0, manaPaymentsFallbackToAi: 0,
};
it("harness runs fixed seeds sequentially, reuses transport, and continues after a cancelled error", async () => {
  const started: number[] = []; let active = false, submitted = false, cancelled = 0;
  const submit = async () => { submitted = true; return { accepted: true as const }; };
  const client: AgentMatchTransport = {
    startSpecs: async (_, __, options) => { assert.equal(active, false); active = true; submitted = false; started.push(options?.seed ?? -1); return { sessionId: "s", status: "running" }; },
    get: async (): Promise<ForgeExternalMatchSnapshot> => {
      if (started.at(-1) === 2) throw new Error("simulated transport failure");
      if (!submitted) return { sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: observation(), pendingDecision: { ...base, type: "priority_action", actions: [pass] } };
      active = false;
      return { sessionId: "s", status: "completed", progress, forgeAiStrategicFallbacks: [], result: { gameId: "g", seed: started.at(-1)!, format: "commander", players: [], winnerId: "self", turns: 10, gameOver: true, draw: false, terminalReason: "AllOpponentsLost", commanderRulesActive: true } };
    },
    cancel: async () => { active = false; cancelled++; return { sessionId: "s", status: "cancelled", cancelled: true }; },
    submitDecision: submit, submitTarget: submit, submitMode: submit, submitValue: submit, submitOptionalCost: submit, submitManaOption: submit, submitCostObject: submit, submitSelection: submit,
  };
  const report = await evaluateAgent({ client, agent, decks: [{ name: "self", cards: [] }, { name: "enemy", cards: [] }], seeds: [1, 2, 3], opponent: "forge", limits: { pollIntervalMs: 0 } });
  assert.deepEqual(started, [1, 2, 3]); assert.equal(cancelled, 1); assert.equal(report.policyVersion, "v2b");
  assert.equal(report.aggregate.completed, 2); assert.equal(report.aggregate.errors, 1); assert.equal(report.aggregate.winRate, 2 / 3);
  assert.deepEqual(report.games.map(g => g.status), ["completed", "error", "completed"]);
});
