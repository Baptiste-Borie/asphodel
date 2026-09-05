import assert from "node:assert/strict";
import { it } from "node:test";
import { AgentRunError, gameMetrics, runAgentMatch, type AgentMatchTransport } from "./agent/agent-runner.js";
import { BaselineAsphodelAgent } from "./agent/baseline-agent.js";
import type { ForgeExternalMatchSnapshot, ForgeExternalMatchProgress, ForgeDeckSpec } from "./forge/forge-protocol.js";
const decks: [ForgeDeckSpec, ForgeDeckSpec] = [{ name: "self", cards: [] }, { name: "enemy", cards: [] }];
const context = { turn: 1, phase: "MAIN1", activePlayerId: "self", priorityPlayerId: "self", stackSize: 0 };
const progress: ForgeExternalMatchProgress = {
  decisionsRequested: 0, decisionsSubmitted: 0, passesSubmitted: 0, primaryActionsSubmitted: 0, primaryActionsPlayed: 0,
  landsPlayed: 0, spellsCast: 0, abilitiesActivated: 0, targetDecisionsRequested: 0, targetDecisionsSubmitted: 0, targetsSelected: 0,
  modeDecisionsRequested: 0, modeDecisionsSubmitted: 0, modesSelected: 0, valueDecisionsRequested: 0, valueDecisionsSubmitted: 0,
  optionalCostDecisionsRequested: 0, optionalCostsSelected: 0, costObjectDecisionsRequested: 0, costObjectsSelected: 0,
  manaPaymentDecisionsRequested: 0, manaPaymentDecisionsSubmitted: 0, manaOptionsSelected: 0, manaPaymentsFallbackToAi: 0,
};
function paused(): ForgeExternalMatchSnapshot {
  return { sessionId: "session", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [],
    observation: { gameRef: "game", game: context, selfPlayerId: "self", players: [], stack: [] },
    pendingDecision: { decisionId: "d1", playerId: "self", context, type: "priority_action", actions: [{ actionId: "pass", type: "pass", label: "Pass", cardRef: null, cardName: null, sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false }] } };
}
function transport(snapshot = paused()) {
  let submissions = 0, cancelled = 0, polls = 0, starts = 0;
  const submit = async () => { submissions++; return { accepted: true as const }; };
  const client: AgentMatchTransport = {
    startSpecs: async () => { starts++; return { sessionId: "session", status: "running" }; },
    get: async () => { polls++; return snapshot; },
    cancel: async () => { cancelled++; return { sessionId: "session", status: "cancelled", cancelled: true }; },
    submitDecision: submit, submitTarget: submit, submitMode: submit, submitValue: submit,
    submitOptionalCost: submit, submitCostObject: submit, submitManaOption: submit, submitSelection: submit,
  };
  return { client, stats: () => ({ submissions, cancelled, polls, starts }) };
}
it("runner submits each ID once and cancels a stalled pending snapshot", async () => {
  const t = transport();
  await assert.rejects(runAgentMatch(t.client, new BaselineAsphodelAgent(), decks, { maxIdlePolls: 2, pollIntervalMs: 0 }), error => {
    assert.ok(error instanceof AgentRunError); assert.match(error.message, /agent_idle_limit/); assert.equal(error.recentTrace.length, 1); return true;
  });
  assert.equal(t.stats().submissions, 1); assert.equal(t.stats().cancelled, 1);
});
it("runner rejects invalid agent choice before transport and cancels", async () => {
  const t = transport();
  await assert.rejects(runAgentMatch(t.client, { choose: (_, d) => ({ decisionId: d.decisionId, kind: "action", choice: "invented", reason: "test" }) }, decks), /agent_invalid_choice/);
  assert.equal(t.stats().submissions, 0); assert.equal(t.stats().cancelled, 1);
});
it("runner aborts without starting when already cancelled", async () => {
  const t = transport();
  await assert.rejects(runAgentMatch(t.client, new BaselineAsphodelAgent(), decks, { signal: AbortSignal.abort(new Error("stop")) }), /stop/);
  assert.equal(t.stats().starts, 0);
});
it("runner cancels on abort during a match", async () => {
  const t = transport(), controller = new AbortController();
  t.client.get = async () => { controller.abort(new Error("stop")); return paused(); };
  await assert.rejects(runAgentMatch(t.client, new BaselineAsphodelAgent(), decks, { signal: controller.signal }), /stop/);
  assert.equal(t.stats().submissions, 0); assert.equal(t.stats().cancelled, 1);
});
it("runner bounds changing decisions and cancels before an extra submission", async () => {
  const t = transport(); let n = 0;
  t.client.get = async () => { const s = paused(); s.pendingDecision!.decisionId = `d${++n}`; return s; };
  await assert.rejects(runAgentMatch(t.client, new BaselineAsphodelAgent(), decks, { maxDecisions: 2, pollIntervalMs: 0 }), /agent_decision_limit/);
  assert.equal(t.stats().submissions, 2); assert.equal(t.stats().cancelled, 1);
});
it("runner cancels an incoherent observation without submitting", async () => {
  const s = paused(); s.observation!.game = { ...context, turn: 2 };
  const t = transport(s);
  await assert.rejects(runAgentMatch(t.client, new BaselineAsphodelAgent(), decks), /agent_incoherent_observation/);
  assert.equal(t.stats().submissions, 0); assert.equal(t.stats().cancelled, 1);
});
it("runner enforces elapsed timeout and reports cancellation failure too", async () => {
  const t = transport(); t.client.get = async () => ({ sessionId: "session", status: "running", progress, forgeAiStrategicFallbacks: [] });
  t.client.cancel = async () => { throw new Error("cancel failed"); };
  await assert.rejects(runAgentMatch(t.client, new BaselineAsphodelAgent(), decks, { timeoutMs: 1, pollIntervalMs: 2 }), error => {
    assert.ok(error instanceof AgentRunError); assert.equal(error.message, "agent_timeout"); assert.ok(error.cause instanceof AggregateError); return true;
  });
});
it("metrics count actual public damage separately and disclose unavailable telemetry", () => {
  const s = paused();
  assert.equal(gameMetrics(s, [], "self").damageDealt, null);
  s.publicTelemetry = { self: { damageToPlayers: 3, damageToCards: 4, attacks: 2, blocks: 1, commanderCasts: 1 } };
  const m = gameMetrics(s, [], "self"); assert.equal(m.damageDealt, 7); assert.equal(m.damageToPlayers, 3); assert.equal(m.commanderCasts, 1);
});
