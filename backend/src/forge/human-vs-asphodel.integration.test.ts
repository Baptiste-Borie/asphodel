import assert from "node:assert/strict";
import { it } from "node:test";
import { ForgeBridgeClient } from "./forge-bridge-client.js";
import { ForgeExternalMatchClient } from "./forge-external-match-client.js";
import { commanderFixtures } from "./testing/commander-fixtures.js";
import type { AgentObservation } from "./forge-protocol.js";
import { BaselineAsphodelAgentV2b } from "../agent/improved-agent.js";
import { ScriptedHumanDecisionProvider } from "../human/scripted-human-decision-provider.js";
import { runHumanVsAgentMatch } from "../human/human-vs-agent-runner.js";

const HUMAN = "player-1";
const ASPHODEL = "player-2";

it("a scripted human and BaselineAsphodelAgentV2b play a real 100-card Commander game with correctly isolated, per-player observations", {
  skip: !process.env.FORGE_BRIDGE_JAR, timeout: 150_000,
}, async () => {
  const bridge = new ForgeBridgeClient({ jarPath: process.env.FORGE_BRIDGE_JAR! });
  try {
    await bridge.start();
    const human = new ScriptedHumanDecisionProvider();
    const agent = new BaselineAsphodelAgentV2b();
    const humanObservations: AgentObservation[] = [];
    const agentObservations: AgentObservation[] = [];
    let humanDecisions = 0, agentDecisions = 0;

    const run = await runHumanVsAgentMatch(
      new ForgeExternalMatchClient(bridge), human, agent, commanderFixtures(), HUMAN, ASPHODEL,
      {
        seed: 7, maxDecisions: 20_000, timeoutMs: 120_000,
        onDecision: (owner, observation) => {
          if (owner === "human") { humanDecisions++; humanObservations.push(observation); }
          else { agentDecisions++; agentObservations.push(observation); }
        },
      },
    );

    // The game advances and reaches a natural terminal result for both external seats.
    assert.ok(run.snapshot.result?.gameOver);
    assert.ok((run.snapshot.result?.turns ?? 0) >= 1);
    assert.ok(humanDecisions > 0, "the human seat must receive decisions");
    assert.ok(agentDecisions > 0, "the Asphodel seat must receive decisions");

    // Both sides had the opportunity to develop their board naturally.
    const humanTelemetry = run.snapshot.publicTelemetry?.[HUMAN];
    const agentTelemetry = run.snapshot.publicTelemetry?.[ASPHODEL];
    assert.ok(humanTelemetry, "human public telemetry must be present");
    assert.ok(agentTelemetry, "Asphodel public telemetry must be present");
    assert.ok((humanTelemetry!.spellsCast ?? 0) + (agentTelemetry!.spellsCast ?? 0) > 0, "at least one side cast a spell");

    // Combat happened at least once (either seat may have declared attackers).
    const attackerDecisions = run.trace.filter(t => t.type === "attackers_selection");
    assert.ok(attackerDecisions.length > 0, "at least one attackers_selection decision occurred");

    // Only the pre-existing, documented combat-damage fallback is acceptable; nothing else.
    const unexpectedFallbacks = run.snapshot.forgeAiStrategicFallbacks.filter(
      f => !(f.family === "combat_damage" && f.method === "assignCombatDamage"),
    );
    assert.deepEqual(unexpectedFallbacks, [], "no unexpected strategic fallback may occur");

    // Observation isolation, both directions: each side's own observation carries its own hand
    // and never the other seat's hand field at all (not merely a masked/empty value).
    for (const observation of humanObservations) {
      assert.equal(observation.selfPlayerId, HUMAN);
      const self = observation.players.find(p => p.playerId === HUMAN)!;
      assert.equal(self.role, "self");
      const opponent = observation.players.find(p => p.playerId === ASPHODEL)!;
      assert.equal(opponent.role, "opponent");
      assert.equal((opponent as unknown as { hand?: unknown }).hand, undefined, "the human's observation of Asphodel must carry no hand field");
      assert.ok(!JSON.stringify(opponent).includes('"hand"'), "Asphodel's serialized player entry must carry no hand key");
    }
    for (const observation of agentObservations) {
      assert.equal(observation.selfPlayerId, ASPHODEL);
      const self = observation.players.find(p => p.playerId === ASPHODEL)!;
      assert.equal(self.role, "self");
      const opponent = observation.players.find(p => p.playerId === HUMAN)!;
      assert.equal(opponent.role, "opponent");
      assert.equal((opponent as unknown as { hand?: unknown }).hand, undefined, "Asphodel's observation of the human must carry no hand field");
      assert.ok(!JSON.stringify(opponent).includes('"hand"'), "the human's serialized player entry must carry no hand key");
    }
  } finally {
    await bridge.stop();
  }
});
