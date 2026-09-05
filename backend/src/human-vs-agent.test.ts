import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentMatchTransport } from "./agent/agent-runner.js";
import { AgentRunError } from "./agent/agent-runner.js";
import { validateChoice, type AgentChoice, type AsphodelAgent } from "./agent/baseline-agent.js";
import { runHumanVsAgentMatch } from "./human/human-vs-agent-runner.js";
import { HumanEndMatchError, type HumanDecisionProvider } from "./human/human-decision-provider.js";
import { TerminalHumanDecisionProvider } from "./human/terminal-human-decision-provider.js";
import { Readable, Writable } from "node:stream";
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

function observation(selfId: string, opponentId: string, turn: number, hand: AgentSelfPlayerObservation["hand"] = []): AgentObservation {
  const context = { turn, phase: "main1", activePlayerId: selfId, priorityPlayerId: selfId };
  const self: AgentSelfPlayerObservation = { role: "self", playerId: selfId, name: selfId, life: 40, startingLife: 40, handSize: hand.length, librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: 1, battlefieldSize: 0, externalController: true, hand, battlefield: [], graveyard: [], exile: [], command: [], commanders: [] };
  const { hand: _hand, ...publicSelf } = self;
  return { selfPlayerId: selfId, gameRef: "game", game: context, stack: [], players: [self, { ...publicSelf, role: "opponent", playerId: opponentId, name: opponentId, externalController: false, battlefield: [] }] };
}

function priorityDecision(playerId: string, turn: number): Extract<Decision, { type: "priority_action" }> {
  return { decisionId: `d-${playerId}-${turn}`, type: "priority_action", playerId,
    context: { turn, phase: "main1", activePlayerId: playerId, priorityPlayerId: playerId, stackSize: 0 },
    actions: [{ actionId: "pass", type: "pass", label: "Pass priority", cardRef: null, cardName: null, sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false }] };
}

function completedSnapshot(winnerId: string): ForgeExternalMatchSnapshot {
  return { sessionId: "s", status: "completed", progress, forgeAiStrategicFallbacks: [],
    result: { gameId: "g", format: "commander", seed: 1, players: [], winnerId, turns: 3, gameOver: true, draw: false, terminalReason: "AllOpponentsLost", commanderRulesActive: true } };
}

class FakeAgent implements AsphodelAgent {
  calls = 0;
  choose(_o: AgentObservation, d: Decision): AgentChoice {
    this.calls++;
    return { decisionId: d.decisionId, kind: "action", choice: (d as Extract<Decision, { type: "priority_action" }>).actions[0]!.actionId, reason: "fake_agent" };
  }
}
class FakeHuman implements HumanDecisionProvider {
  calls = 0;
  async choose(_o: AgentObservation, d: Decision): Promise<AgentChoice> {
    this.calls++;
    return { decisionId: d.decisionId, kind: "action", choice: (d as Extract<Decision, { type: "priority_action" }>).actions[0]!.actionId, reason: "fake_human" };
  }
}

it("routes a decision for the human to the human provider exactly once, and for Asphodel to the agent exactly once", async () => {
  const human = new FakeHuman(), agent = new FakeAgent();
  let cancelled = 0;
  const client: AgentMatchTransport = {
    startSpecs: async () => ({ sessionId: "s", status: "running" }),
    get: (() => {
      let call = 0;
      return async () => {
        call++;
        if (call === 1) return { sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: observation("player-1", "player-2", 1), pendingDecision: priorityDecision("player-1", 1) };
        if (call === 2) return { sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: observation("player-2", "player-1", 1), pendingDecision: priorityDecision("player-2", 1) };
        return completedSnapshot("player-1");
      };
    })(),
    cancel: async () => { cancelled++; return { sessionId: "s", status: "cancelled", cancelled: true }; },
    submitDecision: async () => ({ accepted: true }), submitTarget: async () => ({ accepted: true }), submitMode: async () => ({ accepted: true }),
    submitValue: async () => ({ accepted: true }), submitOptionalCost: async () => ({ accepted: true }), submitManaOption: async () => ({ accepted: true }),
    submitCostObject: async () => ({ accepted: true }), submitSelection: async () => ({ accepted: true }),
  };
  const owners: string[] = [];
  const run = await runHumanVsAgentMatch(client, human, agent, [{ name: "h", cards: [] }, { name: "a", cards: [] }], "player-1", "player-2",
    { pollIntervalMs: 0, onDecision: (owner) => owners.push(owner) });
  assert.equal(human.calls, 1);
  assert.equal(agent.calls, 1);
  assert.deepEqual(owners, ["human", "agent"]);
  assert.equal(cancelled, 0);
  assert.equal(run.snapshot.result?.winnerId, "player-1");
});

it("fails hard on a decision for an unrecognized playerId instead of guessing an owner", async () => {
  const human = new FakeHuman(), agent = new FakeAgent();
  let cancelled = 0;
  const client: AgentMatchTransport = {
    startSpecs: async () => ({ sessionId: "s", status: "running" }),
    get: async () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: observation("player-3", "player-2", 1), pendingDecision: priorityDecision("player-3", 1) }),
    cancel: async () => { cancelled++; return { sessionId: "s", status: "cancelled", cancelled: true }; },
    submitDecision: async () => ({ accepted: true }), submitTarget: async () => ({ accepted: true }), submitMode: async () => ({ accepted: true }),
    submitValue: async () => ({ accepted: true }), submitOptionalCost: async () => ({ accepted: true }), submitManaOption: async () => ({ accepted: true }),
    submitCostObject: async () => ({ accepted: true }), submitSelection: async () => ({ accepted: true }),
  };
  await assert.rejects(
    runHumanVsAgentMatch(client, human, agent, [{ name: "h", cards: [] }, { name: "a", cards: [] }], "player-1", "player-2", { pollIntervalMs: 0 }),
    (error: unknown) => error instanceof AgentRunError && /unknown_decision_owner/.test(error.message),
  );
  assert.equal(human.calls, 0);
  assert.equal(agent.calls, 0);
  assert.equal(cancelled, 1, "cancellation clears the pending state on the broker side");
});

it("a stale re-poll of the same decisionId is not re-submitted to the chooser", async () => {
  const human = new FakeHuman(), agent = new FakeAgent();
  let call = 0;
  const client: AgentMatchTransport = {
    startSpecs: async () => ({ sessionId: "s", status: "running" }),
    get: async () => {
      call++;
      // The same pending decision is returned twice in a row before Forge advances.
      if (call <= 2) return { sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: observation("player-1", "player-2", 1), pendingDecision: priorityDecision("player-1", 1) };
      return completedSnapshot("player-1");
    },
    cancel: async () => ({ sessionId: "s", status: "cancelled", cancelled: true }),
    submitDecision: async () => ({ accepted: true }), submitTarget: async () => ({ accepted: true }), submitMode: async () => ({ accepted: true }),
    submitValue: async () => ({ accepted: true }), submitOptionalCost: async () => ({ accepted: true }), submitManaOption: async () => ({ accepted: true }),
    submitCostObject: async () => ({ accepted: true }), submitSelection: async () => ({ accepted: true }),
  };
  await runHumanVsAgentMatch(client, human, agent, [{ name: "h", cards: [] }, { name: "a", cards: [] }], "player-1", "player-2", { pollIntervalMs: 0 });
  assert.equal(human.calls, 1, "the second identical poll must not call the human provider again");
  assert.equal(agent.calls, 0);
});

it("cancellation on a mid-flight abort clears the broker's pending state via client.cancel", async () => {
  const human = new FakeHuman(), agent = new FakeAgent();
  let cancelled = 0;
  const abort = new AbortController();
  const client: AgentMatchTransport = {
    startSpecs: async () => ({ sessionId: "s", status: "running" }),
    get: async () => {
      // Aborts once a session already exists, mirroring a real Ctrl+C mid-match.
      abort.abort(new Error("stop"));
      return { sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: observation("player-1", "player-2", 1), pendingDecision: priorityDecision("player-1", 1) };
    },
    cancel: async () => { cancelled++; return { sessionId: "s", status: "cancelled", cancelled: true }; },
    submitDecision: async () => ({ accepted: true }), submitTarget: async () => ({ accepted: true }), submitMode: async () => ({ accepted: true }),
    submitValue: async () => ({ accepted: true }), submitOptionalCost: async () => ({ accepted: true }), submitManaOption: async () => ({ accepted: true }),
    submitCostObject: async () => ({ accepted: true }), submitSelection: async () => ({ accepted: true }),
  };
  await assert.rejects(runHumanVsAgentMatch(client, human, agent, [{ name: "h", cards: [] }, { name: "a", cards: [] }], "player-1", "player-2", { pollIntervalMs: 0, signal: abort.signal }));
  assert.equal(cancelled, 1, "the session must be cancelled once it exists, even when the abort lands mid-decision");
});

it("human observation at a human decision includes the human hand and no Asphodel hand identity", () => {
  const humanObservation = observation("player-1", "player-2", 1, [{ cardRef: "card-1", name: "Swords to Plowshares", zone: "hand", ownerId: "player-1", controllerId: "player-1", faceDown: false, hidden: false, tapped: null, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Instant" }]);
  assert.equal(humanObservation.selfPlayerId, "player-1");
  const self = humanObservation.players.find(p => p.playerId === "player-1")!;
  assert.equal(self.role, "self");
  assert.equal((self as AgentSelfPlayerObservation).hand.length, 1);
  assert.equal((self as AgentSelfPlayerObservation).hand[0]!.name, "Swords to Plowshares");
  const serialized = JSON.stringify(humanObservation);
  assert.ok(!serialized.includes('"role":"self"') || !("hand" in humanObservation.players[1]!), "opponent (Asphodel) observation must carry no hand field at all");
  assert.equal((humanObservation.players[1] as unknown as { hand?: unknown }).hand, undefined);
});

it("Asphodel observation at Asphodel's decision includes its own hand and no human hand identity", () => {
  const agentObservation = observation("player-2", "player-1", 1, [{ cardRef: "card-2", name: "Krenko, Tin Street Kingpin", zone: "hand", ownerId: "player-2", controllerId: "player-2", faceDown: false, hidden: false, tapped: null, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Legendary Creature" }]);
  assert.equal(agentObservation.selfPlayerId, "player-2");
  const self = agentObservation.players.find(p => p.playerId === "player-2")!;
  assert.equal((self as AgentSelfPlayerObservation).hand[0]!.name, "Krenko, Tin Street Kingpin");
  assert.equal((agentObservation.players[1] as unknown as { hand?: unknown }).hand, undefined, "human's observation-of-opponent must carry no hand field at all");
});

it("TerminalHumanDecisionProvider retries locally on invalid input and never returns an option outside the supplied menu", async () => {
  const input = new Readable({ read() {} });
  let out = "";
  const output = new Writable({ write(chunk, _enc, callback) { out += chunk.toString(); callback(); } });
  const provider = new TerminalHumanDecisionProvider(input, output);
  const promise = provider.choose(observation("player-1", "player-2", 1), priorityDecision("player-1", 1));
  for (const line of ["not-a-number\n", "\n", "99\n", "1\n"]) {
    await new Promise(resolve => setImmediate(resolve));
    input.push(line);
  }
  const choice = await promise;
  provider.close();
  validateChoice(priorityDecision("player-1", 1), choice);
  assert.equal(choice.choice, "pass");
  assert.match(out, /Invalid choice/);
});

class EndingHuman implements HumanDecisionProvider {
  calls = 0;
  async choose(): Promise<AgentChoice> {
    this.calls++;
    throw new HumanEndMatchError();
  }
}

it("a human-requested end is not an error: returns endedByHuman with the last snapshot, cancels once, keeps already-recorded Asphodel decisions", async () => {
  const agent = new FakeAgent();
  const human = new EndingHuman();
  let cancelled = 0, call = 0;
  const agentDecisions: string[] = [];
  const client: AgentMatchTransport = {
    startSpecs: async () => ({ sessionId: "s", status: "running" }),
    get: async () => {
      call++;
      if (call === 1) return { sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: observation("player-2", "player-1", 1), pendingDecision: priorityDecision("player-2", 1) };
      // The second decision belongs to the human, who immediately ends the playtest.
      return { sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: observation("player-1", "player-2", 2), pendingDecision: priorityDecision("player-1", 2) };
    },
    cancel: async () => { cancelled++; return { sessionId: "s", status: "cancelled", cancelled: true }; },
    submitDecision: async () => ({ accepted: true }), submitTarget: async () => ({ accepted: true }), submitMode: async () => ({ accepted: true }),
    submitValue: async () => ({ accepted: true }), submitOptionalCost: async () => ({ accepted: true }), submitManaOption: async () => ({ accepted: true }),
    submitCostObject: async () => ({ accepted: true }), submitSelection: async () => ({ accepted: true }),
  };
  const run = await runHumanVsAgentMatch(client, human, agent, [{ name: "h", cards: [] }, { name: "a", cards: [] }], "player-1", "player-2",
    { pollIntervalMs: 0, onDecision: (owner) => { if (owner === "agent") agentDecisions.push("recorded"); } });
  assert.equal(run.endedByHuman, true);
  assert.equal(cancelled, 1);
  assert.equal(agentDecisions.length, 1, "the Asphodel decision observed before the human ended must still have fired onDecision");
  assert.equal(run.snapshot.pendingDecision?.playerId, "player-1", "the last polled (human) snapshot must be preserved");
  assert.equal(agent.calls, 1);
  assert.equal(human.calls, 1);
  assert.equal(run.snapshot.status, "waiting_for_decision", "the game was never told it completed naturally");
});

it("a human-requested end never submits the ending prompt's decision to Forge and does not throw AgentRunError", async () => {
  const agent = new FakeAgent();
  const human = new EndingHuman();
  let submitted = 0;
  const client: AgentMatchTransport = {
    startSpecs: async () => ({ sessionId: "s", status: "running" }),
    get: async () => ({ sessionId: "s", status: "waiting_for_decision", progress, forgeAiStrategicFallbacks: [], observation: observation("player-1", "player-2", 1), pendingDecision: priorityDecision("player-1", 1) }),
    cancel: async () => ({ sessionId: "s", status: "cancelled", cancelled: true }),
    submitDecision: async () => { submitted++; return { accepted: true }; }, submitTarget: async () => ({ accepted: true }), submitMode: async () => ({ accepted: true }),
    submitValue: async () => ({ accepted: true }), submitOptionalCost: async () => ({ accepted: true }), submitManaOption: async () => ({ accepted: true }),
    submitCostObject: async () => ({ accepted: true }), submitSelection: async () => ({ accepted: true }),
  };
  const run = await runHumanVsAgentMatch(client, human, agent, [{ name: "h", cards: [] }, { name: "a", cards: [] }], "player-1", "player-2", { pollIntervalMs: 0 });
  assert.equal(run.endedByHuman, true);
  assert.equal(submitted, 0, "an ended decision must never reach Forge");
});

it("TerminalHumanDecisionProvider treats \"end\" the same as \"quit\" and throws HumanEndMatchError before any choice is returned", async () => {
  const input = new Readable({ read() {} });
  const output = new Writable({ write(_chunk, _enc, callback) { callback(); } });
  const provider = new TerminalHumanDecisionProvider(input, output);
  const promise = provider.choose(observation("player-1", "player-2", 1), priorityDecision("player-1", 1));
  await new Promise(resolve => setImmediate(resolve));
  input.push("end\n");
  await assert.rejects(promise, (error: unknown) => error instanceof HumanEndMatchError);
  provider.close();
});
