import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it } from "node:test";
import { BaselineAsphodelAgent } from "../agent/baseline-agent.js";
import { runAgentMatch } from "../agent/agent-runner.js";
import { ForgeBridgeClient } from "./forge-bridge-client.js";
import { ForgeExternalMatchClient } from "./forge-external-match-client.js";
import { commanderFixtures, thirdCommanderFixture } from "./testing/commander-fixtures.js";

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

it("baseline completes a real 3-player 100-card Commander game (first N-player acceptance run)", {
  skip: !process.env.FORGE_BRIDGE_JAR, timeout: 150_000,
}, async () => {
  const bridge = new ForgeBridgeClient({ jarPath: process.env.FORGE_BRIDGE_JAR! });
  try {
    await bridge.start();
    const decks = [...commanderFixtures(), thirdCommanderFixture()];
    for (const deck of decks) assert.equal(deck.cards.reduce((sum, c) => sum + c.quantity, 0), 100);
    // All three seats "external": the same baseline agent answers whichever seat's decision comes
    // up next, purely from that decision's own observation.selfPlayerId — see runAgentMatch.
    const result = await runAgentMatch(new ForgeExternalMatchClient(bridge), new BaselineAsphodelAgent(), decks,
      { seed: 42, seats: ["external", "external", "external"] });
    const { metrics, snapshot, trace } = result;
    await writeFile(join(tmpdir(), "asphodel-3p-debug.json"), JSON.stringify(result, null, 2));
    assert.equal(snapshot.status, "completed");
    assert.equal(metrics.result?.gameOver, true);
    assert.ok(metrics.externalDecisions > 0);
    assert.equal(new Set(trace.map(t => t.choice.decisionId)).size, trace.length);
    assert.equal(snapshot.progress.decisionsSubmitted, metrics.decisionTypeCounts.priority_action);
    assert.equal(metrics.manaFallbacks, 0);
    // Unlike the 2-player baseline, manual attacker/blocker declaration is intentionally out of
    // scope for 3+ players (see ForgeCombatDecisions#unsupported), so every fallback observed here
    // must be one of these known shapes, never a new, unexplained one:
    //  - combat_damage/assignCombatDamage: pre-existing, unrelated to player count (also present
    //    in the 2-player baseline above).
    //  - attackers_selection/declareAttackers, blockers_selection/declareBlockers: the intentional
    //    3+ player combat gate.
    //  - chooseSingleCardFace/chooseSingleCardFace: a pre-existing, player-count-unrelated decision
    //    type PlayerControllerAsphodel has never externalized (same as combat_damage) — it simply
    //    wasn't exercised by either 2-player fixture deck's cards; this 3-player run's larger card
    //    pool (Talrand, Sky Summoner's blue creatures) happened to trigger it 3 times.
    const knownFallback = (f: { family: string; method: string }) =>
      (f.family === "combat_damage" && f.method === "assignCombatDamage")
      || (f.family === "attackers_selection" && f.method === "declareAttackers")
      || (f.family === "blockers_selection" && f.method === "declareBlockers")
      || (f.family === "chooseSingleCardFace" && f.method === "chooseSingleCardFace");
    assert.deepEqual(snapshot.forgeAiStrategicFallbacks.filter(f => !knownFallback(f)), []);
    console.log("3p metrics", JSON.stringify(metrics));
    console.log("3p fallback counts", JSON.stringify(
      Object.fromEntries(
        Object.entries(
          snapshot.forgeAiStrategicFallbacks.reduce<Record<string, number>>((acc, f) => {
            const key = `${f.family}:${f.method}`;
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {}),
        ),
      ),
    ));
  } finally { await bridge.stop(); }
});
