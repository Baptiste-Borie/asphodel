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
import { ForgeExternalMatchClient } from "./forge-external-match-client.js";
import type {
  ForgeDeckSpec,
  ForgeExternalAction,
  ForgeExternalMatchSnapshot,
  ForgeGameResult,
  ForgePendingDecision,
} from "./forge-protocol.js";

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

function ashlingDeck(name = "Ashling legal actions"): ForgeDeckSpec {
  return {
    name,
    cards: [
      { name: "Ashling the Pilgrim", quantity: 1, section: "commander" },
      { name: "Mountain", quantity: 30, section: "mainboard" },
    ],
  };
}

function timingDeck(name = "Timing restrictions"): ForgeDeckSpec {
  return {
    name,
    cards: [
      {
        name: "Krenko, Tin Street Kingpin",
        quantity: 1,
        section: "commander",
      },
      { name: "Mountain", quantity: 20, section: "mainboard" },
      { name: "Lightning Bolt", quantity: 20, section: "mainboard" },
      { name: "Goblin Piker", quantity: 20, section: "mainboard" },
    ],
  };
}

function unaffordableDeck(name = "Insufficient mana"): ForgeDeckSpec {
  return {
    name,
    cards: [
      { name: "Ashling the Pilgrim", quantity: 1, section: "commander" },
      { name: "Goblin Piker", quantity: 20, section: "mainboard" },
    ],
  };
}

function assertTerminalDeckMatch(
  result: ForgeGameResult,
  controllerClasses = [
    "forge.ai.PlayerControllerAi",
    "forge.ai.PlayerControllerAi",
  ],
): void {
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
  for (const [index, player] of result.players.entries()) {
    assert.equal(player.ai, true);
    assert.equal(player.controllerClass, controllerClasses[index]);
    assert.equal(player.startingLife, 40);
    assert.equal(player.commanders.length, 1);
    assert.equal(player.commandersInCommandZone, true);
  }
}

async function waitForExternalSnapshot(
  external: ForgeExternalMatchClient,
  sessionId: string,
  predicate: (snapshot: ForgeExternalMatchSnapshot) => boolean,
  timeoutMs = 10_000,
): Promise<ForgeExternalMatchSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let latest: ForgeExternalMatchSnapshot | undefined;
  while (Date.now() < deadline) {
    latest = await external.get(sessionId);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`External match polling timed out: ${JSON.stringify(latest)}`);
}

async function waitForDecision(
  external: ForgeExternalMatchClient,
  sessionId: string,
): Promise<ForgeExternalMatchSnapshot & {
  pendingDecision: ForgePendingDecision;
}> {
  const snapshot = await waitForExternalSnapshot(
    external,
    sessionId,
    (candidate) => candidate.status === "waiting_for_decision",
  );
  assert.ok(snapshot.pendingDecision);
  return snapshot as ForgeExternalMatchSnapshot & {
    pendingDecision: ForgePendingDecision;
  };
}

async function driveUntilAction(
  external: ForgeExternalMatchClient,
  sessionId: string,
  predicate: (action: ForgeExternalAction) => boolean,
  fallback: (decision: ForgePendingDecision) => ForgeExternalAction =
    (decision) =>
      decision.actions.find((action) => action.type === "play_land") ??
      decision.actions.find((action) => action.type === "pass")!,
): Promise<{
  snapshot: ForgeExternalMatchSnapshot;
  decision: ForgePendingDecision;
  action: ForgeExternalAction;
}> {
  let latest: ForgePendingDecision | undefined;
  for (let index = 0; index < 1_000; index += 1) {
    const snapshot = await waitForDecision(external, sessionId);
    latest = snapshot.pendingDecision;
    const action = snapshot.pendingDecision.actions.find(predicate);
    if (action) {
      return {
        snapshot,
        decision: snapshot.pendingDecision,
        action,
      };
    }
    const chosen = fallback(snapshot.pendingDecision);
    assert.ok(chosen);
    await external.submitDecision(
      sessionId,
      snapshot.pendingDecision.decisionId,
      chosen.actionId,
    );
  }
  throw new Error(
    `Forge did not expose the requested primary action: ${JSON.stringify(latest)}`,
  );
}

async function autoDriveExternalMatch(
  external: ForgeExternalMatchClient,
  sessionId: string,
): Promise<ForgeExternalMatchSnapshot> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const snapshot = await external.get(sessionId);
    if (snapshot.status === "completed") return snapshot;
    if (snapshot.status === "failed") {
      throw new Error(`External match failed: ${JSON.stringify(snapshot.error)}`);
    }
    if (snapshot.pendingDecision) {
      const action =
        snapshot.pendingDecision.actions.find(
          (candidate) => candidate.type === "play_land",
        ) ??
        snapshot.pendingDecision.actions.find(
          (candidate) => candidate.type === "cast_spell",
        ) ??
        snapshot.pendingDecision.actions.find(
          (candidate) => candidate.type === "activate_ability",
        ) ??
        snapshot.pendingDecision.actions.find(
          (candidate) => candidate.type === "pass",
        );
      assert.ok(action);
      await external.submitDecision(
        sessionId,
        snapshot.pendingDecision.decisionId,
        action.actionId,
      );
    } else {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  throw new Error("Node auto-driver did not reach a terminal Forge outcome.");
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

  it("keeps NDJSON responsive while the external game thread waits", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(redDeck(), greenDeck(), {
      seed: 12_345,
    });

    const waiting = await waitForDecision(external, started.sessionId);
    assert.equal(waiting.pendingDecision.type, "priority_action");
    assert.equal(waiting.pendingDecision.playerId, "player-1");
    assert.equal(waiting.pendingDecision.context.priorityPlayerId, "player-1");
    assert.deepEqual(await client.request({ type: "ping" }), {
      message: "pong",
    });
    await assert.rejects(
      client.request({
        type: "run_deck_match",
        format: "commander",
        decks: [redDeck(), greenDeck()],
      }),
      (error: unknown) =>
        error instanceof ForgeBridgeError &&
        error.code === "MATCH_ALREADY_RUNNING",
    );
    await external.cancel(started.sessionId);
  });

  it("submits PASS and protects pending, unknown, and stale actions", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(redDeck(), greenDeck(), {
      seed: 12_345,
    });
    const first = await waitForDecision(external, started.sessionId);
    const { pendingDecision } = first;
    const pass = pendingDecision.actions.find(
      (action) => action.type === "pass",
    );
    assert.ok(pass);

    await assert.rejects(
      external.submitDecision(
        started.sessionId,
        pendingDecision.decisionId,
        "action-does-not-exist",
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "ACTION_NOT_FOUND",
    );
    const stillWaiting = await external.get(started.sessionId);
    assert.equal(
      stillWaiting.pendingDecision?.decisionId,
      pendingDecision.decisionId,
    );

    assert.deepEqual(
      await external.submitDecision(
        started.sessionId,
        pendingDecision.decisionId,
        pass.actionId,
      ),
      { accepted: true },
    );
    await assert.rejects(
      external.submitDecision(
        started.sessionId,
        pendingDecision.decisionId,
        pass.actionId,
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "STALE_DECISION",
    );

    const continued = await waitForExternalSnapshot(
      external,
      started.sessionId,
      (snapshot) =>
        snapshot.status === "completed" ||
        (snapshot.status === "waiting_for_decision" &&
          snapshot.pendingDecision?.decisionId !== pendingDecision.decisionId),
    );
    assert.ok(continued.progress.passesSubmitted >= 1);
    if (continued.status !== "completed") {
      await external.cancel(started.sessionId);
    }
  });

  it("enumerates multiple real actions with opaque duplicate identities and no opponent hidden cards", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(ashlingDeck(), greenDeck(), {
      seed: 12_345,
    });
    const found = await driveUntilAction(
      external,
      started.sessionId,
      (action) => action.type === "play_land",
      (decision) =>
        decision.actions.find((action) => action.type === "pass")!,
    );
    const lands = found.decision.actions.filter(
      (action) => action.type === "play_land",
    );

    assert.ok(lands.length > 1);
    assert.equal(found.decision.actions[0]?.type, "pass");
    assert.equal(
      new Set(lands.map((action) => action.actionId)).size,
      lands.length,
    );
    assert.equal(
      new Set(lands.map((action) => action.cardRef)).size,
      lands.length,
    );
    for (const land of lands) {
      assert.equal(land.cardName, "Mountain");
      assert.equal(land.sourceZone, "hand");
      assert.equal(land.manaCost, null);
      assert.equal(land.requiresTargets, false);
    }
    assert.ok(
      found.decision.actions.every(
        (action) =>
          action.type === "pass" ||
          !["Forest", "Grizzly Bears", "Ayula, Queen Among Bears"].includes(
            action.cardName,
          ),
      ),
    );
    assert.ok(
      found.decision.actions.every(
        (action) => (action.type as string) !== "forge_ai_suggestion",
      ),
    );
    await external.cancel(started.sessionId);
  });

  it("never leaks the external player's own hidden library top card or any opponent hidden card", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(redDeck(), greenDeck(), {
      seed: 12_345,
    });
    const opponentOnlyCardNames = [
      "Ayula, Queen Among Bears",
      "Forest",
      "Grizzly Bears",
    ];
    const seenDecisionIds = new Set<string>();
    let decisionsInspected = 0;

    // Walk enough real decisions (auto-passing) to have repeatedly rebuilt the
    // candidate list from Hand/Battlefield/Command/Graveyard/Exile only, and
    // assert the Library zone and the opponent's exclusive cards never surface.
    while (decisionsInspected < 40) {
      const snapshot = await waitForExternalSnapshot(
        external,
        started.sessionId,
        (candidate) =>
          candidate.status === "waiting_for_decision" ||
          candidate.status === "completed",
      );
      if (snapshot.status === "completed") break;
      const { pendingDecision } = snapshot;
      if (!pendingDecision || seenDecisionIds.has(pendingDecision.decisionId)) {
        continue;
      }
      seenDecisionIds.add(pendingDecision.decisionId);
      decisionsInspected += 1;

      for (const action of pendingDecision.actions) {
        assert.notEqual(
          action.sourceZone,
          "library",
          "the top card of a library is hidden information and must never " +
            "be exposed as an action's sourceZone",
        );
        if (action.cardName) {
          assert.ok(
            !opponentOnlyCardNames.includes(action.cardName),
            `opponent-only card "${action.cardName}" leaked into the ` +
              "external player's own pending decision",
          );
        }
      }

      const pass = pendingDecision.actions.find(
        (action) => action.type === "pass",
      );
      assert.ok(pass);
      await external.submitDecision(
        started.sessionId,
        pendingDecision.decisionId,
        pass.actionId,
      );
    }

    assert.ok(decisionsInspected > 0);
    const finalSnapshot = await external.get(started.sessionId);
    if (finalSnapshot.status !== "completed") {
      await external.cancel(started.sessionId);
    }
  });

  it("plays a land, invalidates its action, and filters a known unaffordable card", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(ashlingDeck(), greenDeck(), {
      seed: 12_345,
    });
    const found = await driveUntilAction(
      external,
      started.sessionId,
      (action) => action.type === "play_land",
      (decision) =>
        decision.actions.find((action) => action.type === "pass")!,
    );
    assert.ok(
      !found.decision.actions.some(
        (action) =>
          action.type === "cast_spell" &&
          action.cardName === "Ashling the Pilgrim",
      ),
      "the command-zone card costs {1}{R} while the player controls no mana",
    );
    assert.notEqual(found.action.type, "pass");
    const playedCardRef = found.action.cardRef;

    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const next = await waitForExternalSnapshot(
      external,
      started.sessionId,
      (snapshot) =>
        snapshot.progress.landsPlayed === 1 &&
        snapshot.pendingDecision?.decisionId !== found.decision.decisionId,
    );
    assert.equal(next.progress.primaryActionsSubmitted, 1);
    assert.equal(next.progress.primaryActionsPlayed, 1);
    assert.equal(next.progress.landsPlayed, 1);
    assert.ok(
      !next.pendingDecision?.actions.some(
        (action) => action.type === "play_land" && action.cardRef === playedCardRef,
      ),
    );
    if (next.status !== "completed") await external.cancel(started.sessionId);
  });

  it("omits spells that Forge cannot afford even when every opening-hand card is that spell", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(unaffordableDeck(), greenDeck(), {
      seed: 12_345,
    });
    const waiting = await waitForDecision(external, started.sessionId);
    assert.deepEqual(
      waiting.pendingDecision.actions.map((action) => action.type),
      ["pass"],
    );
    await external.cancel(started.sessionId);
  });

  it("casts a commander and executes Ashling's simple non-mana activated ability", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(ashlingDeck(), greenDeck(), {
      seed: 12_345,
    });
    const commander = await driveUntilAction(
      external,
      started.sessionId,
      (action) =>
        action.type === "cast_spell" &&
        action.cardName === "Ashling the Pilgrim" &&
        action.sourceZone === "command",
    );
    assert.equal(commander.action.type, "cast_spell");
    assert.equal(commander.action.manaCost, "{1}{R}");
    await external.submitDecision(
      started.sessionId,
      commander.decision.decisionId,
      commander.action.actionId,
    );
    await waitForExternalSnapshot(
      external,
      started.sessionId,
      (snapshot) => snapshot.progress.spellsCast === 1,
    );

    const activation = await driveUntilAction(
      external,
      started.sessionId,
      (action) =>
        action.type === "activate_ability" &&
        action.cardName === "Ashling the Pilgrim" &&
        action.sourceZone === "battlefield",
    );
    assert.equal(activation.action.type, "activate_ability");
    assert.equal(activation.action.requiresTargets, false);
    await external.submitDecision(
      started.sessionId,
      activation.decision.decisionId,
      activation.action.actionId,
    );
    const played = await waitForExternalSnapshot(
      external,
      started.sessionId,
      (snapshot) => snapshot.progress.abilitiesActivated === 1,
    );
    assert.equal(played.progress.spellsCast, 1);
    assert.equal(played.progress.abilitiesActivated, 1);
    // driveUntilAction's fallback plays ordinary lands while it searches for
    // the commander cast and, later, the activation, so the exact total is
    // timing-dependent. The architecturally meaningful invariant is that every
    // primary action actually submitted (lands included) was actually played,
    // and that the total decomposes into the three tracked action types.
    assert.equal(
      played.progress.primaryActionsPlayed,
      played.progress.primaryActionsSubmitted,
    );
    assert.equal(
      played.progress.primaryActionsPlayed,
      played.progress.landsPlayed +
        played.progress.spellsCast +
        played.progress.abilitiesActivated,
    );
    if (played.status !== "completed") await external.cancel(started.sessionId);
  });

  it("uses Forge timing rules: instant is exposed on the opponent turn while sorcery-speed creature is not", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(timingDeck(), greenDeck(), {
      seed: 12_345,
    });
    const instant = await driveUntilAction(
      external,
      started.sessionId,
      (action) =>
        action.type === "cast_spell" &&
        action.cardName === "Lightning Bolt",
      (decision) =>
        decision.actions.find((action) => action.type === "play_land") ??
        decision.actions.find((action) => action.type === "pass")!,
    );

    // If the first Bolt window is still our own turn, pass until the same legal
    // instant appears with player-2 active.
    let opponentInstant = instant;
    if (instant.decision.context.activePlayerId !== "player-2") {
      await external.submitDecision(
        started.sessionId,
        instant.decision.decisionId,
        instant.decision.actions.find((action) => action.type === "pass")!
          .actionId,
      );
      opponentInstant = await driveUntilAction(
        external,
        started.sessionId,
        (action) =>
          action.type === "cast_spell" &&
          action.cardName === "Lightning Bolt",
        (decision) =>
          decision.actions.find((action) => action.type === "pass")!,
      );
      while (opponentInstant.decision.context.activePlayerId !== "player-2") {
        await external.submitDecision(
          started.sessionId,
          opponentInstant.decision.decisionId,
          opponentInstant.decision.actions.find(
            (action) => action.type === "pass",
          )!.actionId,
        );
        opponentInstant = await driveUntilAction(
          external,
          started.sessionId,
          (action) =>
            action.type === "cast_spell" &&
            action.cardName === "Lightning Bolt",
          (decision) =>
            decision.actions.find((action) => action.type === "pass")!,
        );
      }
    }
    assert.equal(opponentInstant.action.type, "cast_spell");
    assert.equal(opponentInstant.action.requiresTargets, true);
    assert.ok(
      !opponentInstant.decision.actions.some(
        (action) =>
          action.type === "cast_spell" && action.cardName === "Goblin Piker",
      ),
    );
    await external.submitDecision(
      started.sessionId,
      opponentInstant.decision.decisionId,
      opponentInstant.action.actionId,
    );
    const cast = await waitForExternalSnapshot(
      external,
      started.sessionId,
      (snapshot) => snapshot.progress.spellsCast === 1,
    );
    assert.equal(cast.progress.primaryActionsPlayed, 2);
    if (cast.status !== "completed") await external.cancel(started.sessionId);
  });

  it("submits a retained Forge-derived primary action and plays the same ability object", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(redDeck(), greenDeck(), {
      seed: 12_345,
    });
    const selected = await driveUntilAction(
      external,
      started.sessionId,
      (action) => action.type === "play_land",
    );
    assert.equal(selected.action.type, "play_land");
    assert.ok(selected.action.cardName);

    assert.deepEqual(
      await external.submitDecision(
        started.sessionId,
        selected.decision.decisionId,
        selected.action.actionId,
      ),
      { accepted: true },
    );
    const played = await waitForExternalSnapshot(
      external,
      started.sessionId,
      (snapshot) => snapshot.progress.primaryActionsPlayed > 0,
    );
    assert.ok(played.progress.primaryActionsSubmitted > 0);
    assert.ok(played.progress.primaryActionsPlayed > 0);
    assert.ok(played.progress.landsPlayed > 0);
    if (played.status !== "completed") {
      await external.cancel(started.sessionId);
    }
  });

  it("auto-drives a full Deck Library match from Node to GameOutcome", async () => {
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
    const external = new ForgeExternalMatchClient(client);
    const started = await external.start(red, green, { seed: 12_345 });

    const completed = await autoDriveExternalMatch(external, started.sessionId);
    assert.equal(completed.status, "completed");
    assert.ok(completed.result);
    assertTerminalDeckMatch(completed.result, [
      "com.asphodel.forgebridge.PlayerControllerAsphodel",
      "forge.ai.PlayerControllerAi",
    ]);
    assert.equal(
      completed.result.players[0]?.controllerClass,
      "com.asphodel.forgebridge.PlayerControllerAsphodel",
    );
    assert.equal(
      completed.result.players[1]?.controllerClass,
      "forge.ai.PlayerControllerAi",
    );
    assert.ok(completed.progress.decisionsSubmitted > 0);
    assert.ok(completed.progress.primaryActionsSubmitted > 0);
    assert.equal(
      completed.progress.primaryActionsSubmitted,
      completed.progress.primaryActionsPlayed,
    );
  });

  it("cancels a pending match and starts a replacement in the same JVM", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const first = await external.startSpecs(redDeck(), greenDeck(), {
      seed: 12_345,
    });
    await waitForDecision(external, first.sessionId);

    await assert.rejects(
      external.startSpecs(redDeck(), greenDeck(), { seed: 12_345 }),
      (error: unknown) =>
        error instanceof ForgeBridgeError &&
        error.code === "MATCH_ALREADY_RUNNING",
    );
    assert.deepEqual(await external.cancel(first.sessionId), {
      sessionId: first.sessionId,
      status: "cancelled",
      cancelled: true,
    });
    assert.equal((await external.get(first.sessionId)).status, "cancelled");

    const second = await external.startSpecs(redDeck(), greenDeck(), {
      seed: 12_345,
    });
    assert.notEqual(second.sessionId, first.sessionId);
    const replacement = await waitForDecision(external, second.sessionId);
    assert.equal(replacement.status, "waiting_for_decision");
    await external.cancel(second.sessionId);
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
