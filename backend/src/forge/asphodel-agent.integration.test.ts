import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it } from "node:test";
import { BaselineAsphodelAgent } from "../agent/baseline-agent.js";
import { runAgentMatch } from "../agent/agent-runner.js";
import { ForgeBridgeClient } from "./forge-bridge-client.js";
import { ForgeExternalMatchClient } from "./forge-external-match-client.js";
import { commanderFixtures } from "./testing/commander-fixtures.js";

it("V2a baseline completes a real 100-card Commander game without stale choices or unexpected fallback", {
  skip: !process.env.FORGE_BRIDGE_JAR, timeout: 150_000,
}, async () => {
  const bridge = new ForgeBridgeClient({ jarPath: process.env.FORGE_BRIDGE_JAR! });
  try {
  await bridge.start();
    const decks = commanderFixtures();
    for (const deck of decks) assert.equal(deck.cards.reduce((sum, c) => sum + c.quantity, 0), 100);
    const result = await runAgentMatch(new ForgeExternalMatchClient(bridge), new BaselineAsphodelAgent(), decks, { seed: 42 });
    const { metrics, snapshot, trace } = result;
    await writeFile(join(tmpdir(), "asphodel-v2a-debug.json"), JSON.stringify(result, null, 2));
    assert.equal(snapshot.status, "completed");
    assert.equal(metrics.result?.gameOver, true);
    assert.ok(metrics.turns >= 10 || metrics.result?.gameOver);
    assert.ok(metrics.externalDecisions > 0);
    assert.equal(new Set(trace.map(t => t.choice.decisionId)).size, trace.length);
    assert.ok(trace.every(t => /^[a-z0-9_]+$/.test(t.choice.reason)));
    assert.equal(snapshot.progress.decisionsSubmitted, metrics.decisionTypeCounts.priority_action);
    assert.equal(metrics.manaFallbacks, 0);
    assert.deepEqual(snapshot.forgeAiStrategicFallbacks.filter(f => f.family !== "combat_damage" || f.method !== "assignCombatDamage"), []);
    assert.ok(metrics.landsPlayed > 0);
    assert.ok(metrics.spellsCast > 0);
    assert.ok(metrics.commanderCasts !== null && metrics.commanderCasts > 0);
    assert.ok(metrics.attacks !== null && metrics.attacks >= 0);
    assert.equal(metrics.blocks, trace.filter(t => t.type === "blockers_selection" && t.choice.reason === "block_trade_or_life_pressure").length);
    assert.ok(metrics.damageDealt !== null && metrics.damageDealt > 0);
    assert.equal(snapshot.publicTelemetry?.[metrics.selfPlayerId]?.spellsCast, metrics.spellsCast);
    await writeFile(join(tmpdir(), "asphodel-v2a-game.json"), JSON.stringify({ metrics, trace, telemetry: snapshot.publicTelemetry }, null, 2));
    console.log("V2a metrics", JSON.stringify(metrics));
  } finally { await bridge.stop(); }
});
