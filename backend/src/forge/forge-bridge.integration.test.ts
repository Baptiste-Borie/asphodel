import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  ForgeBridgeClient,
  ForgeBridgeError,
  ForgeBridgeProcessError,
} from "./forge-bridge-client.js";

const jarPath = process.env.FORGE_BRIDGE_JAR;
const clients: ForgeBridgeClient[] = [];

function createClient(): ForgeBridgeClient {
  assert.ok(jarPath, "FORGE_BRIDGE_JAR must point to the built bridge jar");
  const client = new ForgeBridgeClient({ jarPath });
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop()));
});

describe("ForgeBridgeClient integration", () => {
  it("boots the real JVM and reports the pinned engine", async () => {
    const client = createClient();
    await client.start();

    assert.deepEqual(await client.request({ type: "ping" }), {
      message: "pong",
    });
    const info = await client.request({ type: "engine_info" });
    assert.equal(info.protocolVersion, 1);
    assert.equal(info.forgeVersion, "2.0.15-SNAPSHOT");
    assert.equal(
      info.forgeRevision,
      "6356c1ad565029c82513c96e42ad5492c1b09c4e",
    );
    assert.deepEqual(info.forgeModules, [
      "forge-core",
      "forge-game",
      "forge-ai",
    ]);
  });

  it("correlates several in-flight requests", async () => {
    const client = createClient();
    await client.start();

    const inputs = ["W", "U", "B", "R", "G", "WU", "all"];
    const results = await Promise.all(
      inputs.map((color) =>
        client.request({ type: "forge_color_identity", color }),
      ),
    );

    assert.deepEqual(
      results.map((result) => result.input),
      inputs,
    );
    assert.deepEqual(results.at(-1)?.symbols, ["W", "U", "B", "R", "G"]);
  });

  it("returns a structured error for an unknown command and stays alive", async () => {
    const client = createClient();
    await client.start();

    await assert.rejects(
      client.request({ type: "unknown_command" } as never),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "UNKNOWN_COMMAND",
    );
    assert.deepEqual(await client.request({ type: "ping" }), {
      message: "pong",
    });
  });

  it("executes a real Forge core API", async () => {
    const client = createClient();
    await client.start();

    const result = await client.request({
      type: "forge_color_identity",
      color: "red",
    });

    assert.equal(result.mask, 8);
    assert.deepEqual(result.symbols, ["R"]);
    assert.equal(result.forgeClass, "forge.card.MagicColor");
    assert.equal(result.sourceModule, "forge-core");
  });

  it("runs a real Commander game between two Forge AI players", async () => {
    const forgeLogs: string[] = [];
    assert.ok(jarPath, "FORGE_BRIDGE_JAR must point to the built bridge jar");
    const client = new ForgeBridgeClient({
      jarPath,
      requestTimeoutMs: 40_000,
      onStderr: (line) => forgeLogs.push(line),
    });
    clients.push(client);
    await client.start();

    const result = await client.request({
      type: "run_test_game",
      format: "commander",
      seed: 12_345,
      timeoutSeconds: 30,
    });

    assert.match(result.gameId, /^forge-game-\d+$/);
    assert.equal(result.format, "commander");
    assert.equal(result.seed, 12_345);
    assert.equal(result.players.length, 2);
    assert.equal(result.gameOver, true);
    assert.ok(result.turns > 0);
    assert.ok(result.draw || result.winnerId !== null);
    assert.notEqual(result.terminalReason, "");
    assert.equal(result.commanderRulesActive, true);

    for (const player of result.players) {
      assert.equal(player.startingLife, 40);
      assert.equal(player.ai, true);
      assert.equal(player.controllerClass, "forge.ai.PlayerControllerAi");
      assert.equal(player.zones.hand, 7);
      assert.ok(player.zones.library > 0);
      assert.equal(player.zones.battlefield, 0);
      assert.equal(player.zones.graveyard, 0);
      assert.ok(player.zones.command > 0);
      assert.equal(player.commanders.length, 1);
      assert.equal(player.commandersInCommandZone, true);
    }

    assert.equal(result.cardEvidence.name, "Lightning Bolt");
    assert.equal(result.cardEvidence.manaCost, "{R}");
    assert.match(result.cardEvidence.oracleText, /deals 3 damage/i);
    assert.ok(result.cardEvidence.scriptAbilityCount > 0);
    assert.ok(
      result.cardEvidence.scriptAbilities.some((ability) =>
        ability.includes("SP$ DealDamage"),
      ),
    );
    assert.equal(result.cardEvidence.rulesClass, "forge.card.CardRules");
    assert.equal(result.forgeClasses.game, "forge.game.Game");
    assert.equal(result.forgeClasses.match, "forge.game.Match");
    assert.equal(result.forgeClasses.aiPlayer, "forge.ai.LobbyPlayerAi");

    const repeated = await client.request({
      type: "run_test_game",
      format: "commander",
      seed: 12_345,
      timeoutSeconds: 30,
    });
    assert.equal(repeated.winnerId, result.winnerId);
    assert.equal(repeated.turns, result.turns);
    assert.deepEqual(repeated.players, result.players);

    // Forge emits diagnostics during card loading and play. Completing the
    // request proves those lines stayed on stderr instead of corrupting NDJSON.
    assert.ok(forgeLogs.length > 0);
  });

  it("returns a structured game timeout without killing the JVM", async () => {
    const client = createClient();
    await client.start();

    await assert.rejects(
      client.request({
        type: "run_test_game",
        format: "commander",
        seed: 12_345,
        timeoutSeconds: 1,
      }),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "GAME_TIMEOUT",
    );
    assert.deepEqual(await client.request({ type: "ping" }), {
      message: "pong",
    });
  });

  it("stops cleanly and rejects requests after shutdown", async () => {
    const client = createClient();
    await client.start();
    await client.stop();

    assert.equal(client.isRunning, false);
    await assert.rejects(
      client.request({ type: "ping" }),
      ForgeBridgeProcessError,
    );
  });

  it("rejects pending work when the JVM dies unexpectedly", async () => {
    const client = createClient();
    await client.start();
    assert.ok(client.pid);

    process.kill(client.pid, "SIGKILL");

    await assert.rejects(
      client.request({ type: "ping" }),
      ForgeBridgeProcessError,
    );
    assert.equal(client.isRunning, false);
  });
});
