import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { AgentMatchTransport } from "./agent/agent-runner.js";
import type { AgentChoice, AsphodelAgent } from "./agent/baseline-agent.js";
import {
  PlaytestSessionError,
  PlaytestSessionManager,
  type PlaytestBridge,
} from "./human/playtest-session-manager.js";
import type {
  AgentObservation,
  AgentSelfPlayerObservation,
  ForgeExternalMatchProgress,
  ForgeExternalMatchSnapshot,
  ForgePendingExternalDecision as Decision,
} from "./forge/forge-protocol.js";

const progress: ForgeExternalMatchProgress = {
  decisionsRequested: 0, decisionsSubmitted: 0, passesSubmitted: 0, primaryActionsSubmitted: 0, primaryActionsPlayed: 0, landsPlayed: 0, spellsCast: 0, abilitiesActivated: 0,
  targetDecisionsRequested: 0, targetDecisionsSubmitted: 0, targetsSelected: 0, modeDecisionsRequested: 0, modeDecisionsSubmitted: 0, modesSelected: 0,
  valueDecisionsRequested: 0, valueDecisionsSubmitted: 0, optionalCostDecisionsRequested: 0, optionalCostsSelected: 0, costObjectDecisionsRequested: 0, costObjectsSelected: 0,
  manaPaymentDecisionsRequested: 0, manaPaymentDecisionsSubmitted: 0, manaOptionsSelected: 0, manaPaymentsFallbackToAi: 0,
};
const HUMAN_HAND_CARD = "Human Secret Card Name";
const AGENT_HAND_CARD = "Asphodel Secret Card Name";

function observation(selfId: string, opponentId: string, turn: number, hand: AgentSelfPlayerObservation["hand"]): AgentObservation {
  const context = { turn, phase: "main1", activePlayerId: selfId, priorityPlayerId: selfId };
  const self: AgentSelfPlayerObservation = { role: "self", playerId: selfId, name: selfId, life: 40, startingLife: 40, handSize: hand.length, librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: 0, externalController: true, hand, battlefield: [], graveyard: [], exile: [], command: [], commanders: [] };
  const { hand: _hand, ...publicSelf } = self;
  return { selfPlayerId: selfId, gameRef: "g", game: context, stack: [], players: [self, { ...publicSelf, role: "opponent", playerId: opponentId, name: opponentId, externalController: false, battlefield: [] }] };
}
function humanCard() {
  return { cardRef: "human-card", name: HUMAN_HAND_CARD, zone: "hand" as const, ownerId: "player-1", controllerId: "player-1", faceDown: false, hidden: false, tapped: null, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Instant" };
}
function agentCard() {
  return { cardRef: "agent-card", name: AGENT_HAND_CARD, zone: "hand" as const, ownerId: "player-2", controllerId: "player-2", faceDown: false, hidden: false, tapped: null, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Creature" };
}
function humanObservation(turn = 1) { return observation("player-1", "player-2", turn, [humanCard()]); }
function agentObservation(turn = 1) { return observation("player-2", "player-1", turn, [agentCard()]); }

// Two legal actions (pass + a real one) so a human decision actually reaches the browser instead
// of being safely auto-passed by the backend (see priority-auto-pass.test.ts for that behavior).
function priorityDecision(playerId: string, id: string): Extract<Decision, { type: "priority_action" }> {
  return { decisionId: id, type: "priority_action", playerId, context: { turn: 1, phase: "main1", activePlayerId: playerId, priorityPlayerId: playerId, stackSize: 0 },
    actions: [
      { actionId: "pass", type: "pass", label: "Pass priority", cardRef: null, cardName: null, sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false },
      { actionId: "cast-1", type: "cast_spell", label: "Cast a spell", cardRef: "card-1", cardName: "Some Spell", sourceZone: "hand", abilityText: null, manaCost: "1", requiresTargets: false },
    ] };
}

function fakeBridge(): PlaytestBridge {
  return { start: async () => {}, stop: async () => {} };
}
class FakeAgent implements AsphodelAgent {
  choose(_o: AgentObservation, d: Decision): AgentChoice {
    return { decisionId: d.decisionId, kind: "action", choice: (d as Extract<Decision, { type: "priority_action" }>).actions[0]!.actionId, reason: "fake_agent" };
  }
}

/** A scripted fake transport: each call to `get()` advances to the next step, holding on the last one. */
function scriptedTransport(steps: (() => ForgeExternalMatchSnapshot)[]): { client: AgentMatchTransport; cancelCount: () => number } {
  let index = 0, cancelCount = 0;
  const submit = async () => ({ accepted: true as const });
  return {
    cancelCount: () => cancelCount,
    client: {
      startSpecs: async () => ({ sessionId: "s", status: "running" as const }),
      get: async () => steps[Math.min(index++, steps.length - 1)]!(),
      cancel: async () => { cancelCount++; return { sessionId: "s", status: "cancelled" as const, cancelled: true as const }; },
      submitDecision: submit, submitTarget: submit, submitMode: submit, submitValue: submit,
      submitOptionalCost: submit, submitManaOption: submit, submitCostObject: submit, submitSelection: submit,
    },
  };
}

async function withTempReports<T>(fn: (reportsRoot: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "asphodel-playtest-session-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

it("starts a playtest, exposes the human observation while waiting, accepts a submitted choice, and completes naturally with a report", async () => {
  await withTempReports(async reportsRoot => {
    const { client } = scriptedTransport([
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: humanObservation(1), pendingDecision: priorityDecision("player-1", "d-1") }),
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: agentObservation(1), pendingDecision: priorityDecision("player-2", "d-2") }),
      () => ({
        sessionId: "s", status: "completed", progress, forgeAiStrategicFallbacks: [],
        publicTelemetry: { "player-1": { attacks: 0, damageToPlayers: 0, damageToCards: 0, spellsCast: 0 }, "player-2": { attacks: 0, damageToPlayers: 0, damageToCards: 0, spellsCast: 1 } },
        result: { gameId: "g", format: "commander", seed: 42, players: [], winnerId: "player-1", turns: 3, gameOver: true, draw: false, terminalReason: "AllOpponentsLost", commanderRulesActive: true },
      }),
    ]);
    const manager = new PlaytestSessionManager({ createBridge: fakeBridge, createClient: () => client, createAgent: () => new FakeAgent(), reportsRoot });
    const started = await manager.start({ humanDeck: { type: "fixture" }, asphodelDeck: { type: "fixture" }, seed: 42 });
    assert.ok(started.sessionId);

    // Poll until the human decision is visible (the background match loop needs a tick to reach it).
    let state = manager.getState(started.sessionId);
    for (let i = 0; i < 50 && state.pendingDecision === null; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      state = manager.getState(started.sessionId);
    }
    assert.equal(state.status, "waiting_for_human");
    assert.equal(state.humanDeckName, "Krenko, Tin Street Kingpin 100-card controller validation");
    assert.ok(state.observation, "the human observation must be exposed while waiting for the human");
    assert.equal(state.observation!.selfPlayerId, "player-1");
    assert.equal(state.pendingDecision!.decisionId, "d-1");
    assert.equal(state.pendingDecision!.rendered.kind, "menu");

    manager.submitChoice(started.sessionId, { decisionId: "d-1", kind: "action", choice: "pass", reason: "human_choice" });

    for (let i = 0; i < 200 && manager.getState(started.sessionId).status !== "completed"; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const final = manager.getState(started.sessionId);
    assert.equal(final.status, "completed");
    assert.equal(final.result?.winnerId, "player-1");
    assert.equal(final.asphodelDecisionCount, 1);
    assert.equal(final.endedByHuman, false);
    assert.equal(final.observation, null, "no decision is pending once the game is over");

    const report = manager.getReport(started.sessionId);
    assert.ok(report.summaryPath.startsWith(reportsRoot));
    assert.ok(report.decisionsPath.startsWith(reportsRoot));
  });
});

it("ends a playtest voluntarily: cancels once, preserves recorded decisions, writes a report, never an error", async () => {
  await withTempReports(async reportsRoot => {
    const { client, cancelCount } = scriptedTransport([
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: agentObservation(1), pendingDecision: priorityDecision("player-2", "d-1") }),
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: humanObservation(2), pendingDecision: priorityDecision("player-1", "d-2") }),
    ]);
    const manager = new PlaytestSessionManager({ createBridge: fakeBridge, createClient: () => client, createAgent: () => new FakeAgent(), reportsRoot });
    const started = await manager.start({ humanDeck: { type: "fixture" }, asphodelDeck: { type: "fixture" } });

    let state = manager.getState(started.sessionId);
    for (let i = 0; i < 50 && state.asphodelDecisionCount === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      state = manager.getState(started.sessionId);
    }
    assert.equal(state.asphodelDecisionCount, 1, "the Asphodel decision before the end request must be recorded");

    const ended = await manager.end(started.sessionId);
    assert.equal(ended.status, "ended_by_human");
    assert.equal(ended.endedByHuman, true);
    assert.equal(ended.asphodelDecisionCount, 1, "already-recorded Asphodel decisions survive a voluntary end");
    assert.equal(cancelCount(), 1);

    const report = manager.getReport(started.sessionId);
    assert.ok(report.summaryPath.startsWith(reportsRoot));
  });
});

it("refuses a second playtest while one is already running", async () => {
  await withTempReports(async reportsRoot => {
    const { client } = scriptedTransport([
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: humanObservation(1), pendingDecision: priorityDecision("player-1", "d-1") }),
    ]);
    const manager = new PlaytestSessionManager({ createBridge: fakeBridge, createClient: () => client, createAgent: () => new FakeAgent(), reportsRoot });
    await manager.start({ humanDeck: { type: "fixture" }, asphodelDeck: { type: "fixture" } });
    await assert.rejects(
      manager.start({ humanDeck: { type: "fixture" }, asphodelDeck: { type: "fixture" } }),
      (error: unknown) => error instanceof PlaytestSessionError && error.code === "PLAYTEST_ALREADY_RUNNING",
    );
  });
});

it("security: the web playtest state never exposes Asphodel's hand, including in its serialized JSON", async () => {
  await withTempReports(async reportsRoot => {
    const { client } = scriptedTransport([
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: humanObservation(1), pendingDecision: priorityDecision("player-1", "d-1") }),
    ]);
    const manager = new PlaytestSessionManager({ createBridge: fakeBridge, createClient: () => client, createAgent: () => new FakeAgent(), reportsRoot });
    const started = await manager.start({ humanDeck: { type: "fixture" }, asphodelDeck: { type: "fixture" } });

    let state = manager.getState(started.sessionId);
    for (let i = 0; i < 50 && state.pendingDecision === null; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      state = manager.getState(started.sessionId);
    }
    assert.ok(state.observation, "expected the human observation to be present");
    const opponent = state.observation!.players.find(p => p.playerId === "player-2")!;
    assert.equal(opponent.role, "opponent");
    assert.equal((opponent as unknown as { hand?: unknown }).hand, undefined, "Asphodel's hand field must be structurally absent");

    const serialized = JSON.stringify(state);
    assert.ok(!serialized.includes(AGENT_HAND_CARD), "the serialized web state must never contain an Asphodel hand card name");
    assert.ok(serialized.includes(HUMAN_HAND_CARD), "the human's own hand should still be visible to the human");
  });
});

it("getActiveState() is null before any playtest starts", async () => {
  const manager = new PlaytestSessionManager({ createBridge: fakeBridge, createClient: () => scriptedTransport([]).client, createAgent: () => new FakeAgent() });
  assert.equal(manager.getActiveState(), null);
});

it("getActiveState() lets a browser reconnect (e.g. after F5) to the one running playtest by its existing sessionId, without starting a second game", async () => {
  await withTempReports(async reportsRoot => {
    const { client } = scriptedTransport([
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: humanObservation(1), pendingDecision: priorityDecision("player-1", "d-1") }),
    ]);
    let startCalls = 0;
    const countingClient: AgentMatchTransport = { ...client, startSpecs: (...args) => { startCalls++; return client.startSpecs(...args); } };
    const manager = new PlaytestSessionManager({ createBridge: fakeBridge, createClient: () => countingClient, createAgent: () => new FakeAgent(), reportsRoot });
    const started = await manager.start({ humanDeck: { type: "fixture" }, asphodelDeck: { type: "fixture" } });

    let active = manager.getActiveState();
    for (let i = 0; i < 50 && active?.pendingDecision === null; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      active = manager.getActiveState();
    }
    assert.ok(active, "an active session must be reported while the playtest is running");
    assert.equal(active!.sessionId, started.sessionId, "resuming must return the SAME sessionId, not a new one");
    assert.equal(active!.status, "waiting_for_human");
    assert.ok(active!.observation, "the resumed state must still expose the human's own observation");
    assert.equal(startCalls, 1, "reconnecting must never start a second Forge game");

    // A second real GET (simulating the browser polling again right after reconnecting) must
    // still refer to the same session, not create another one.
    const secondLook = manager.getActiveState();
    assert.equal(secondLook?.sessionId, started.sessionId);
    assert.equal(startCalls, 1);
  });
});

// A second fake agent that actually casts (instead of always passing) so `describeAgentAction`
// produces real narration text for the frame/event tests below.
class CastingFakeAgent implements AsphodelAgent {
  choose(_o: AgentObservation, d: Decision): AgentChoice {
    const actions = (d as Extract<Decision, { type: "priority_action" }>).actions;
    const cast = actions.find(a => a.type === "cast_spell") ?? actions[0]!;
    return { decisionId: d.decisionId, kind: "action", choice: cast.actionId, reason: "fake_agent" };
  }
}

it("captures a public frame after an accepted Asphodel action, in order, human-safe, without consuming them on poll", async () => {
  await withTempReports(async reportsRoot => {
    const { client } = scriptedTransport([
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: humanObservation(1), pendingDecision: priorityDecision("player-1", "d-1") }),
      // Three consecutive Asphodel decisions (e.g. play a land, pay a cost, cast a spell) — each
      // later one's INCOMING observation becomes the frame for the one before it, sanitized from
      // Asphodel's own self-perspective (proving the redaction path is actually exercised). The
      // very first agent decision after the human's turn produces no frame of its own (that board
      // was already visible to the human live) — only the two transitions BETWEEN agent decisions do.
      // (priorityDecision's context is hardcoded to turn 1, so every observation here stays on
      // turn 1 too — the runner's own coherence check requires decision.context.turn to match
      // observation.game.turn exactly.)
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: agentObservation(1), pendingDecision: priorityDecision("player-2", "d-2") }),
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: agentObservation(1), pendingDecision: priorityDecision("player-2", "d-3") }),
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: agentObservation(1), pendingDecision: priorityDecision("player-2", "d-4") }),
      // Back to the human — already exposed directly via the existing live observation/pendingDecision
      // fields, so no additional frame is expected for this last transition.
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: humanObservation(1), pendingDecision: priorityDecision("player-1", "d-5") }),
    ]);
    const manager = new PlaytestSessionManager({ createBridge: fakeBridge, createClient: () => client, createAgent: () => new CastingFakeAgent(), reportsRoot });
    const started = await manager.start({ humanDeck: { type: "fixture" }, asphodelDeck: { type: "fixture" } });

    // d-1 is the human's own decision — must be answered before Asphodel's chain can even start.
    let state = manager.getState(started.sessionId);
    for (let i = 0; i < 50 && state.pendingDecision === null; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      state = manager.getState(started.sessionId);
    }
    manager.submitChoice(started.sessionId, { decisionId: "d-1", kind: "action", choice: "pass", reason: "human_choice" });

    for (let i = 0; i < 100 && state.frames.length < 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      state = manager.getState(started.sessionId);
    }
    assert.equal(state.frames.length, 2, "expected exactly two public frames from this scripted sequence");

    // Ordered ids.
    assert.equal(state.frames[0]!.id, 1);
    assert.equal(state.frames[1]!.id, 2);

    // Human-safe: both frames were sanitized from Asphodel's own self-perspective observations,
    // and must never carry Asphodel's real hand card, anywhere in their serialized JSON.
    for (const frame of state.frames) {
      assert.equal(frame.observation.selfPlayerId, "player-1");
      const agentSide = frame.observation.players.find(p => p.playerId === "player-2")!;
      assert.equal((agentSide as unknown as { hand?: unknown }).hand, undefined);
      assert.ok(!JSON.stringify(frame).includes(AGENT_HAND_CARD), "a public frame must never contain Asphodel's real hand card name");
    }
    // The narrated action text ("Asphodel casts...") travels with the frame it belongs to.
    assert.ok(state.frames[0]!.event?.text.includes("Asphodel casts"));

    // Polling again must not consume/delete/reorder frames — a plain, repeatable read.
    const polledAgain = manager.getState(started.sessionId);
    assert.equal(polledAgain.frames.length, 2);
    assert.deepEqual(polledAgain.frames.map(f => f.id), [1, 2]);
  });
});

it("getActiveState() is null again once the playtest reaches a terminal status", async () => {
  await withTempReports(async reportsRoot => {
    const { client } = scriptedTransport([
      () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: humanObservation(1), pendingDecision: priorityDecision("player-1", "d-1") }),
    ]);
    const manager = new PlaytestSessionManager({ createBridge: fakeBridge, createClient: () => client, createAgent: () => new FakeAgent(), reportsRoot });
    const started = await manager.start({ humanDeck: { type: "fixture" }, asphodelDeck: { type: "fixture" } });
    for (let i = 0; i < 50 && manager.getActiveState()?.pendingDecision === null; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await manager.end(started.sessionId);
    assert.equal(manager.getActiveState(), null, "a terminal (ended-by-human) playtest is no longer \"active\"");
  });
});
