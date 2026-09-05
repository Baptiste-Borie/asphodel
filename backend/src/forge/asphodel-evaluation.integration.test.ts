import assert from "node:assert/strict";
import { it } from "node:test";
import { ForgeBridgeClient } from "./forge-bridge-client.js";
import { ForgeExternalMatchClient } from "./forge-external-match-client.js";
import { commanderFixtures } from "./testing/commander-fixtures.js";
import { BaselineAsphodelAgentV2b } from "../agent/improved-agent.js";
import { evaluateAgent, reproducibleGameResult } from "../agent/evaluate-agent.js";

it("V2b evaluates sequential games and reproduces a seed after an intervening game in the same JVM", {
  skip: !process.env.FORGE_BRIDGE_JAR, timeout: 150_000,
}, async () => {
  const bridge = new ForgeBridgeClient({ jarPath: process.env.FORGE_BRIDGE_JAR! });
  try {
    await bridge.start(); const pid = bridge.pid;
    const report = await evaluateAgent({ client: new ForgeExternalMatchClient(bridge), agent: new BaselineAsphodelAgentV2b(),
      decks: commanderFixtures(), seeds: [1, 2, 1], opponent: "forge", keepCombatSamples: true });
    assert.equal(report.aggregate.completed, 3);
    assert.equal(report.aggregate.timeoutErrorRate, 0);
    assert.equal(report.aggregate.unexpectedFallbacks, 0);
    assert.equal(report.aggregate.manaFallbacks, 0);
    assert.equal(bridge.pid, pid);
    assert.deepEqual(reproducibleGameResult(report.games[0]!), reproducibleGameResult(report.games[2]!));
    assert.ok(report.games[0]!.metrics!.attacks! > 0);
    assert.ok(report.games[0]!.diagnostics.combatSamples.some(s => s.observation.players.some(p => p.battlefield.some(c => (c.selfAttackTriggers?.length ?? 0) > 0))));
    assert.ok(report.games[0]!.diagnostics.combatSamples.some(s => s.observation.players.some(p => p.battlefield.some(c => (c.combatKeywords?.length ?? 0) > 0))));
    assert.deepEqual(await bridge.request({ type: "ping" }), { message: "pong" });
  } finally { await bridge.stop(); }
});
