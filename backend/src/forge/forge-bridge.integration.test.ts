import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DeckService } from "../decks/deck-service.js";
import type { DatabaseConnection } from "../db/client.js";
import { createTestDatabase, FakeCardProvider } from "../test-helpers.js";
import {
  ForgeBridgeClient,
  ForgeBridgeError,
  ForgeBridgeProcessError,
} from "./forge-bridge-client.js";
import { ForgeDeckMatchRunner } from "./forge-deck-match-runner.js";
import type { ForgeDeckSpec, ForgeGameResult } from "./forge-protocol.js";

const jarPath = process.env.FORGE_BRIDGE_JAR;
const clients: ForgeBridgeClient[] = [];
const databases: DatabaseConnection[] = [];

function redDeck(name = "Krenko from Asphodel"): ForgeDeckSpec {
  return {
    name,
    cards: [
      {
        name: "Krenko, Tin Street Kingpin",
        quantity: 1,
        section: "commander",
      },
      { name: "Mountain", quantity: 10, section: "mainboard" },
      { name: "Lightning Bolt", quantity: 5, section: "mainboard" },
      { name: "Goblin Piker", quantity: 5, section: "mainboard" },
    ],
  };
}

function greenDeck(name = "Ayula from Asphodel"): ForgeDeckSpec {
  return {
    name,
    cards: [
      {
        name: "Ayula, Queen Among Bears",
        quantity: 1,
        section: "commander",
      },
      { name: "Forest", quantity: 10, section: "mainboard" },
      { name: "Grizzly Bears", quantity: 10, section: "mainboard" },
    ],
  };
}

function assertTerminalDeckMatch(result: ForgeGameResult): void {
  assert.match(result.gameId, /^forge-game-\d+$/);
  assert.equal(result.format, "commander");
  assert.equal(result.gameOver, true);
  assert.ok(result.turns > 0);
  assert.ok(result.draw || result.winnerId !== null);
  assert.equal(result.commanderRulesActive, true);
  assert.deepEqual(
    result.players.map((player) => player.deckName),
    ["Krenko from Asphodel", "Ayula from Asphodel"],
  );
  for (const player of result.players) {
    assert.equal(player.ai, true);
    assert.equal(player.controllerClass, "forge.ai.PlayerControllerAi");
    assert.equal(player.startingLife, 40);
    assert.equal(player.commanders.length, 1);
    assert.equal(player.commandersInCommandZone, true);
  }
}

function createClient(): ForgeBridgeClient {
  assert.ok(jarPath, "FORGE_BRIDGE_JAR must point to the built bridge jar");
  const client = new ForgeBridgeClient({ jarPath });
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop()));
  databases.splice(0).forEach((database) => database.close());
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

  it("builds and inspects a real Forge Deck with exact-name card resolution", async () => {
    const client = createClient();
    await client.start();

    const result = await client.request({
      type: "inspect_deck",
      deck: {
        sourceDeckId: 91,
        name: "Exact name resolution",
        cards: [
          {
            name: "Krenko, Tin Street Kingpin",
            quantity: 1,
            section: "commander",
          },
          { name: "Mountain", quantity: 1, section: "mainboard" },
          { name: "Forest", quantity: 1, section: "mainboard" },
          { name: "Lightning Bolt", quantity: 1, section: "mainboard" },
          { name: "Grizzly Bears", quantity: 1, section: "mainboard" },
          {
            name: "Ayula, Queen Among Bears",
            quantity: 1,
            section: "mainboard",
          },
          { name: "Ajani's Pridemate", quantity: 1, section: "mainboard" },
        ],
      },
    });

    assert.deepEqual(result, {
      name: "Exact name resolution",
      totalCards: 7,
      mainboardCards: 6,
      commanderCards: 1,
      commanders: ["Krenko, Tin Street Kingpin"],
      resolvedUniqueCards: 7,
    });
  });

  it("accumulates missing Forge cards and never returns a partial deck", async () => {
    const client = createClient();
    await client.start();

    await assert.rejects(
      client.request({
        type: "inspect_deck",
        deck: {
          name: "Missing cards",
          cards: [
            {
              name: "Krenko, Tin Street Kingpin",
              quantity: 1,
              section: "commander",
            },
            { name: "Mountain", quantity: 10, section: "mainboard" },
            {
              name: "Definitely Missing Alpha",
              quantity: 1,
              section: "mainboard",
            },
            {
              name: "Definitely Missing Beta",
              quantity: 1,
              section: "mainboard",
            },
            {
              name: "Delver of Secrets // Insectile Aberration",
              quantity: 1,
              section: "mainboard",
            },
          ],
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ForgeBridgeError);
        assert.equal(error.code, "FORGE_CARDS_NOT_FOUND");
        assert.deepEqual(error.details, {
          cards: [
            "Definitely Missing Alpha",
            "Definitely Missing Beta",
            "Delver of Secrets // Insectile Aberration",
          ],
        });
        return true;
      },
    );
  });

  it("runs a real Forge AI match from two deck specs", async () => {
    const client = createClient();
    await client.start();

    const result = await client.request({
      type: "run_deck_match",
      format: "commander",
      seed: 12_345,
      timeoutSeconds: 30,
      decks: [redDeck(), greenDeck()],
    });

    assertTerminalDeckMatch(result);
  });

  it("runs Deck Library imports from SQLite through Forge to a terminal game", async () => {
    const database = await createTestDatabase();
    databases.push(database);
    const deckService = new DeckService(database.db, new FakeCardProvider());
    const red = await deckService.createDeck(
      "Krenko from Asphodel",
      `Commander
1x Krenko, Tin Street Kingpin

Mainboard
10x Mountain
5x Lightning Bolt
5x Goblin Piker`,
    );
    const green = await deckService.createDeck(
      "Ayula from Asphodel",
      `Commander
1x Ayula, Queen Among Bears

Mainboard
10x Forest
10x Grizzly Bears`,
    );

    const client = createClient();
    await client.start();
    const runner = new ForgeDeckMatchRunner(deckService, client);
    const result = await runner.runDeckMatchByIds(red.id, green.id, {
      seed: 12_345,
      timeoutSeconds: 30,
    });

    assertTerminalDeckMatch(result);
    assert.deepEqual(
      result.players.map((player) => player.commanders),
      [["Krenko, Tin Street Kingpin"], ["Ayula, Queen Among Bears"]],
    );
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

  it("runs a new real deck match in the same JVM after a game timeout", async () => {
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
    const recovered = await client.request({
      type: "run_deck_match",
      format: "commander",
      seed: 12_345,
      timeoutSeconds: 30,
      decks: [redDeck(), greenDeck()],
    });
    assertTerminalDeckMatch(recovered);
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
