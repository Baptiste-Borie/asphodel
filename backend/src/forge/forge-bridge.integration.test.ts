import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driveBaseline } from "./testing/external-controller-driver.js";
import { commanderFixtures } from "./testing/commander-fixtures.js";
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
  AgentObservation,
  AgentOpponentPlayerObservation,
  AgentSelfPlayerObservation,
  ForgeDeckSpec,
  ForgeExternalAction,
  ForgeExternalMatchSnapshot,
  ForgeGameResult,
  ForgePendingDecision,
  ForgePendingCostObjectDecision,
  ForgePendingModeDecision,
  ForgePendingManaPaymentDecision,
  ForgePendingOptionalCostDecision,
  ForgePendingTargetDecision,
  ForgePendingValueDecision,
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

function pyxisDeck(name = "Face-down exile observation"): ForgeDeckSpec {
  return {
    name,
    cards: [
      { name: "Ashling the Pilgrim", quantity: 1, section: "commander" },
      { name: "Mountain", quantity: 20, section: "mainboard" },
      { name: "Pyxis of Pandemonium", quantity: 40, section: "mainboard" },
    ],
  };
}

function manifestDeck(name = "Opponent face-down battlefield"): ForgeDeckSpec {
  return {
    name,
    cards: [
      {
        name: "Isamaru, Hound of Konda",
        quantity: 1,
        section: "commander",
      },
      { name: "Plains", quantity: 20, section: "mainboard" },
      { name: "Soul Summons", quantity: 40, section: "mainboard" },
    ],
  };
}

function blueFixtureDeck(
  name: string,
  spellName: "Counterintelligence" | "Predict" | "Counterspell",
): ForgeDeckSpec {
  return {
    name,
    cards: [
      { name: "Talrand, Sky Summoner", quantity: 1, section: "commander" },
      { name: "Island", quantity: 30, section: "mainboard" },
      { name: spellName, quantity: 30, section: "mainboard" },
    ],
  };
}

function creatureFixtureDeck(name = "Target fixture creatures"): ForgeDeckSpec {
  return {
    name,
    cards: [
      {
        name: "Ayula, Queen Among Bears",
        quantity: 1,
        section: "commander",
      },
      { name: "Forest", quantity: 30, section: "mainboard" },
      { name: "Grizzly Bears", quantity: 30, section: "mainboard" },
    ],
  };
}

function singleModeDeck(name = "Single mode fixture"): ForgeDeckSpec {
  return {
    name,
    cards: [
      {
        name: "Ayara, First of Locthwain",
        quantity: 1,
        section: "commander",
      },
      { name: "Swamp", quantity: 30, section: "mainboard" },
      { name: "Gruesome Realization", quantity: 30, section: "mainboard" },
    ],
  };
}

function targetedModeDeck(name = "Mode then target fixture"): ForgeDeckSpec {
  return {
    name,
    cards: [
      {
        name: "Isamaru, Hound of Konda",
        quantity: 1,
        section: "commander",
      },
      { name: "Plains", quantity: 30, section: "mainboard" },
      { name: "Light of Hope", quantity: 30, section: "mainboard" },
    ],
  };
}

function xValueDeck(name = "X value fixture"): ForgeDeckSpec {
  return {
    name,
    cards: [
      { name: "Karn, Silver Golem", quantity: 1, section: "commander" },
      { name: "Wastes", quantity: 30, section: "mainboard" },
      { name: "Walking Ballista", quantity: 30, section: "mainboard" },
    ],
  };
}

function kickerDeck(name = "Optional kicker fixture"): ForgeDeckSpec {
  return {
    name,
    cards: [
      {
        name: "Krenko, Tin Street Kingpin",
        quantity: 1,
        section: "commander",
      },
      { name: "Mountain", quantity: 30, section: "mainboard" },
      { name: "Burst Lightning", quantity: 30, section: "mainboard" },
    ],
  };
}

function manaRockDeck(name = "External mana rock fixture"): ForgeDeckSpec {
  return {
    name,
    cards: [
      { name: "Ashling the Pilgrim", quantity: 1, section: "commander" },
      { name: "Mountain", quantity: 30, section: "mainboard" },
      { name: "Sol Ring", quantity: 30, section: "mainboard" },
    ],
  };
}

function sacrificeCostDeck(name = "Sacrifice cost fixture"): ForgeDeckSpec {
  return {
    name,
    cards: [
      {
        name: "Ayara, First of Locthwain",
        quantity: 1,
        section: "commander",
      },
      { name: "Swamp", quantity: 30, section: "mainboard" },
      { name: "Sanitarium Skeleton", quantity: 20, section: "mainboard" },
      { name: "Village Rites", quantity: 20, section: "mainboard" },
    ],
  };
}

function discardCostDeck(name = "Discard cost fixture"): ForgeDeckSpec {
  return {
    name,
    cards: [
      {
        name: "Krenko, Tin Street Kingpin",
        quantity: 1,
        section: "commander",
      },
      { name: "Mountain", quantity: 30, section: "mainboard" },
      { name: "Goblin Piker", quantity: 15, section: "mainboard" },
      { name: "Thrill of Possibility", quantity: 15, section: "mainboard" },
    ],
  };
}

// V2e.6.1: a WB commander (Elenda, Saint of Dusk, {2}{W}{B}) fixture reproducing the real playtest
// regression as closely as practical — the deck's ONLY lands are Swamp, Rogue's Passage, and
// Command Tower (no Plains at all), so Command Tower is the ONLY source of white mana. Before this
// milestone, Command Tower's combo mana was entirely invisible to the external protocol, so a
// {1}{W} spell (Lifecreed Duo/Suture Priest, both real cards from the reported deck) could never
// actually be paid for despite being offered as legal — the exact root cause of the >4,000-decision
// loop (see docs/commander-color-mana-and-loop-guard-v2e6-1.md).
function commandTowerDeck(name = "Command Tower fixture (Elenda, WB)"): ForgeDeckSpec {
  return {
    name,
    cards: [
      { name: "Elenda, Saint of Dusk", quantity: 1, section: "commander" },
      { name: "Swamp", quantity: 15, section: "mainboard" },
      { name: "Rogue's Passage", quantity: 5, section: "mainboard" },
      { name: "Command Tower", quantity: 10, section: "mainboard" },
      { name: "Lifecreed Duo", quantity: 10, section: "mainboard" },
      { name: "Suture Priest", quantity: 10, section: "mainboard" },
      { name: "Vito, Thorn of the Dusk Rose", quantity: 10, section: "mainboard" },
    ],
  };
}

// A deliberately harmless opponent (no spells to draw at all) — this test's default driver never
// declares blocks (see `submitDeterministicSecondary`'s combat branch, which only ever "finishes"),
// so a real aggressive opponent would simply race the external player down before Command Tower is
// even drawn. Nothing here is the thing under test; it exists purely so the external side survives
// long enough to naturally draw its own deck.
function harmlessOpponentDeck(name = "Harmless filler opponent"): ForgeDeckSpec {
  return {
    name,
    cards: [
      { name: "Krenko, Tin Street Kingpin", quantity: 1, section: "commander" },
      { name: "Mountain", quantity: 60, section: "mainboard" },
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
  for (;;) {
    const snapshot = await waitForExternalSnapshot(
      external,
      sessionId,
      (candidate) => candidate.status === "waiting_for_decision",
    );
    assert.ok(snapshot.pendingDecision);
    if (snapshot.pendingDecision.type === "priority_action") {
      return snapshot as ForgeExternalMatchSnapshot & {
        pendingDecision: ForgePendingDecision;
      };
    }
    await submitDeterministicSecondary(
      external,
      sessionId,
      snapshot.pendingDecision,
    );
  }
}

async function submitDeterministicSecondary(
  external: ForgeExternalMatchClient,
  sessionId: string,
  decision: Exclude<
    NonNullable<ForgeExternalMatchSnapshot["pendingDecision"]>,
    ForgePendingDecision
  >,
): Promise<void> {
  if (decision.type === "target_selection") {
    const target = decision.targets[0]?.targetId ?? decision.finishTargetId;
    assert.ok(target);
    await external.submitTarget(sessionId, decision.decisionId, target);
    return;
  }
  if (decision.type === "mode_selection") {
    const mode = decision.modes[0]?.modeId ?? decision.finishModeId;
    assert.ok(mode);
    await external.submitMode(sessionId, decision.decisionId, mode);
    return;
  }
  if (decision.type === "value_selection") {
    const value =
      decision.minValue <= 1 && decision.maxValue >= 1
        ? 1
        : decision.minValue;
    await external.submitValue(sessionId, decision.decisionId, value);
    return;
  }
  if (decision.type === "optional_cost_selection") {
    const costId = decision.costs[0]?.costId ?? decision.declineCostId;
    await external.submitOptionalCost(sessionId, decision.decisionId, costId);
    return;
  }
  if (decision.type === "mana_payment") {
    const option =
      decision.options.find(
        (candidate) => candidate.type === "spend_floating_mana",
      ) ?? decision.options[0];
    assert.ok(option);
    await external.submitManaOption(
      sessionId,
      decision.decisionId,
      option.manaOptionId,
    );
    return;
  }
  if (decision.type === "attackers_selection" || decision.type === "blockers_selection" || decision.type === "combat_order_selection") {
    const option = decision.options.find((option) => option.operation === "finish")
      ?? decision.options.find((option) => option.operation === "add" || option.operation === "order");
    assert.ok(option);
    await external.submitCombatChoice(sessionId, decision.decisionId, option.objectId);
    return;
  }
  if (decision.type === "yes_no" || decision.type === "object_selection" || decision.type === "ordering_selection") {
    const option = decision.options[0];
    assert.ok(option);
    await external.submitSelection(sessionId, decision.decisionId, option.objectId);
    return;
  }
  if (decision.type !== "cost_object_selection") throw new Error("Unhandled decision family");
  const objectId = decision.options[0]?.objectId ?? decision.finishChoiceId;
  assert.ok(objectId);
  await external.submitCostObject(sessionId, decision.decisionId, objectId);
}

async function waitForTargetDecision(
  external: ForgeExternalMatchClient,
  sessionId: string,
): Promise<ForgeExternalMatchSnapshot & {
  pendingDecision: ForgePendingTargetDecision;
}> {
  const snapshot = await waitForExternalSnapshot(
    external,
    sessionId,
    (candidate) => candidate.pendingDecision?.type === "target_selection",
  );
  return snapshot as ForgeExternalMatchSnapshot & {
    pendingDecision: ForgePendingTargetDecision;
  };
}

async function waitForModeDecision(
  external: ForgeExternalMatchClient,
  sessionId: string,
): Promise<ForgeExternalMatchSnapshot & {
  pendingDecision: ForgePendingModeDecision;
}> {
  const snapshot = await waitForExternalSnapshot(
    external,
    sessionId,
    (candidate) => candidate.pendingDecision?.type === "mode_selection",
  );
  return snapshot as ForgeExternalMatchSnapshot & {
    pendingDecision: ForgePendingModeDecision;
  };
}

async function waitForValueDecision(
  external: ForgeExternalMatchClient,
  sessionId: string,
): Promise<ForgeExternalMatchSnapshot & {
  pendingDecision: ForgePendingValueDecision;
}> {
  return (await waitForExternalSnapshot(
    external,
    sessionId,
    (candidate) => candidate.pendingDecision?.type === "value_selection",
  )) as ForgeExternalMatchSnapshot & {
    pendingDecision: ForgePendingValueDecision;
  };
}

async function waitForOptionalCostDecision(
  external: ForgeExternalMatchClient,
  sessionId: string,
): Promise<ForgeExternalMatchSnapshot & {
  pendingDecision: ForgePendingOptionalCostDecision;
}> {
  return (await waitForExternalSnapshot(
    external,
    sessionId,
    (candidate) =>
      candidate.pendingDecision?.type === "optional_cost_selection",
  )) as ForgeExternalMatchSnapshot & {
    pendingDecision: ForgePendingOptionalCostDecision;
  };
}

async function waitForCostObjectDecision(
  external: ForgeExternalMatchClient,
  sessionId: string,
): Promise<ForgeExternalMatchSnapshot & {
  pendingDecision: ForgePendingCostObjectDecision;
}> {
  for (;;) {
    const snapshot = await waitForExternalSnapshot(
      external,
      sessionId,
      (candidate) => candidate.pendingDecision !== undefined,
    );
    assert.ok(snapshot.pendingDecision);
    if (snapshot.pendingDecision.type === "cost_object_selection") {
      return snapshot as ForgeExternalMatchSnapshot & {
        pendingDecision: ForgePendingCostObjectDecision;
      };
    }
    if (snapshot.pendingDecision.type !== "mana_payment") {
      throw new Error(
        `Unexpected decision before cost object: ${snapshot.pendingDecision.type}`,
      );
    }
    await submitDeterministicSecondary(
      external,
      sessionId,
      snapshot.pendingDecision,
    );
  }
}

async function waitForManaPaymentDecision(
  external: ForgeExternalMatchClient,
  sessionId: string,
): Promise<ForgeExternalMatchSnapshot & {
  observation: AgentObservation;
  pendingDecision: ForgePendingManaPaymentDecision;
}> {
  const snapshot = await waitForExternalSnapshot(
    external,
    sessionId,
    (candidate) => candidate.pendingDecision?.type === "mana_payment",
  );
  assert.ok(snapshot.observation);
  return snapshot as ForgeExternalMatchSnapshot & {
    observation: AgentObservation;
    pendingDecision: ForgePendingManaPaymentDecision;
  };
}

async function driveSecondaryUntil(
  external: ForgeExternalMatchClient,
  sessionId: string,
  predicate: (snapshot: ForgeExternalMatchSnapshot) => boolean,
): Promise<ForgeExternalMatchSnapshot> {
  for (let index = 0; index < 100; index += 1) {
    const snapshot = await waitForExternalSnapshot(
      external,
      sessionId,
      (candidate) => predicate(candidate) || candidate.pendingDecision !== undefined,
    );
    if (predicate(snapshot)) return snapshot;
    assert.ok(snapshot.pendingDecision);
    if (snapshot.pendingDecision.type === "priority_action") {
      throw new Error("Reached priority before the requested secondary result.");
    }
    await submitDeterministicSecondary(
      external,
      sessionId,
      snapshot.pendingDecision,
    );
  }
  throw new Error("Secondary decision driver did not reach the requested state.");
}

async function waitForObservedDecision(
  external: ForgeExternalMatchClient,
  sessionId: string,
): Promise<ForgeExternalMatchSnapshot & {
  observation: AgentObservation;
  pendingDecision: ForgePendingDecision;
}> {
  const snapshot = await waitForDecision(external, sessionId);
  assert.ok(snapshot.observation);
  return snapshot as ForgeExternalMatchSnapshot & {
    observation: AgentObservation;
    pendingDecision: ForgePendingDecision;
  };
}

function observedPlayers(observation: AgentObservation): {
  self: AgentSelfPlayerObservation;
  opponent: AgentOpponentPlayerObservation;
} {
  const self = observation.players.find((player) => player.role === "self");
  const opponent = observation.players.find(
    (player) => player.role === "opponent",
  );
  assert.ok(self);
  assert.ok(opponent);
  return { self, opponent };
}

async function driveUntilObservation(
  external: ForgeExternalMatchClient,
  sessionId: string,
  predicate: (observation: AgentObservation) => boolean,
  timeoutDecisions = 500,
): Promise<ForgeExternalMatchSnapshot & {
  observation: AgentObservation;
  pendingDecision: ForgePendingDecision;
}> {
  for (let index = 0; index < timeoutDecisions; index += 1) {
    const snapshot = await waitForObservedDecision(external, sessionId);
    if (predicate(snapshot.observation)) return snapshot;
    const pass = snapshot.pendingDecision.actions.find(
      (action) => action.type === "pass",
    );
    assert.ok(pass);
    await external.submitDecision(
      sessionId,
      snapshot.pendingDecision.decisionId,
      pass.actionId,
    );
  }
  throw new Error("Forge did not reach the requested observed state.");
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

async function driveUntilObservedAction(
  external: ForgeExternalMatchClient,
  sessionId: string,
  predicate: (
    observation: AgentObservation,
    action: Exclude<ForgeExternalAction, { type: "pass" }>,
  ) => boolean,
  fallback: (
    observation: AgentObservation,
    decision: ForgePendingDecision,
  ) => ForgeExternalAction = (_observation, decision) =>
    decision.actions.find((candidate) => candidate.type === "play_land") ??
    decision.actions.find((candidate) => candidate.type === "pass")!,
): Promise<{
  snapshot: ForgeExternalMatchSnapshot & { observation: AgentObservation };
  decision: ForgePendingDecision;
  action: Exclude<ForgeExternalAction, { type: "pass" }>;
}> {
  for (let index = 0; index < 1_000; index += 1) {
    const snapshot = await waitForObservedDecision(external, sessionId);
    const action = snapshot.pendingDecision.actions.find(
      (
        candidate,
      ): candidate is Exclude<ForgeExternalAction, { type: "pass" }> =>
        candidate.type !== "pass" && predicate(snapshot.observation, candidate),
    );
    if (action) {
      return {
        snapshot,
        decision: snapshot.pendingDecision,
        action,
      };
    }
    const fallbackAction = fallback(snapshot.observation, snapshot.pendingDecision);
    assert.ok(fallbackAction);
    await external.submitDecision(
      sessionId,
      snapshot.pendingDecision.decisionId,
      fallbackAction.actionId,
    );
  }
  throw new Error("Forge did not reach the requested observed action state.");
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
      if (snapshot.pendingDecision.type !== "priority_action") {
        await submitDeterministicSecondary(
          external,
          sessionId,
          snapshot.pendingDecision,
        );
        continue;
      }
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
  it("V1l drives a 100-card Commander game with an external baseline and audited fallbacks", { timeout: 120_000 }, async () => {
    const client = createClient(); await client.start();
    const external = new ForgeExternalMatchClient(client);
    const decks = commanderFixtures();
    for (const deck of decks) assert.equal(deck.cards.reduce((sum, c) => sum + c.quantity, 0), 100);
    const { sessionId } = await external.startSpecs(...decks, { seed: 42 });
    const run = await driveBaseline(external, sessionId);
    await writeFile(join(tmpdir(), "asphodel-v1l-debug.json"), JSON.stringify(run, null, 2));
    const result = run.latest.result;
    assert.ok(result?.gameOver);
    assert.equal(result.commanderRulesActive, true);
    assert.equal(run.latest.pendingDecision, undefined);
    assert.ok(result.turns >= 10, `Only ${result.turns} turns`);
    assert.ok(run.latest.progress.spellsCast >= 3);
    assert.ok(run.trace.some((t) => t.type === "attackers_selection"));
    assert.ok(run.trace.some((t) => t.type === "blockers_selection"));
    assert.ok(run.observations.some((o) => o.life.some((life) => life < 40)));
    assert.ok(run.observations.some((o) => o.battlefield >= 6));
    assert.ok(run.observations.some((o) => o.graveyard > 0));
    assert.ok(run.observations.some((o) => o.commanderCasts > 0));
    assert.ok(run.observations.some((o) => o.goblinTokens > 0));
    assert.ok(run.observations.every((o) => o.commanders.length === 2 && new Set(o.commanders).size === 2));
    assert.equal(new Set(run.trace.map((t) => t.decisionId)).size, run.trace.length);
    const fallbacks = run.latest.forgeAiStrategicFallbacks;
    const unsupported = fallbacks.filter((f) => f.family !== "combat_damage");
    assert.deepEqual(unsupported, [], JSON.stringify(fallbacks));
    assert.ok(fallbacks.every((f) => f.method === "assignCombatDamage" && f.sourceCardRef && f.reason));
    const report = { seed: 42, turns: result.turns, decisions: run.trace.length,
      completed: true, supportedStrategicFallbacks: unsupported.length,
      unsupportedCombatDamageFallbacks: fallbacks.length, progress: run.latest.progress,
      decisionTypes: [...new Set(run.trace.map((t) => t.type))], result };
    const artifact = join(tmpdir(), "asphodel-v1l-trace.json");
    await writeFile(artifact, JSON.stringify({ report, trace: run.trace, fallbacks }, null, 2));
    console.log(`V1l validation: ${JSON.stringify(report)}; trace=${artifact}`);
    assert.deepEqual(await client.request({ type: "ping" }), { message: "pong" });
  });

  it("V1l watchdog reports the paused state and cancellation clears the session", { timeout: 30_000 }, async () => {
    const client = createClient(); await client.start();
    const external = new ForgeExternalMatchClient(client);
    const { sessionId } = await external.startSpecs(...commanderFixtures(), { seed: 12345 });
    try {
      await assert.rejects(driveBaseline(external, sessionId,
        { maxDecisions: 1, maxSteps: 5000, timeoutMs: 15_000 }),
        /decision watchdog exceeded: .*latestObservation.*latestPendingDecision.*recentTrace/);
    } finally { await external.cancel(sessionId); }
    const ended = await external.get(sessionId);
    assert.equal(ended.status, "cancelled");
    assert.equal(ended.pendingDecision, undefined);
    assert.equal(ended.observation, undefined);
    assert.deepEqual(await client.request({ type: "ping" }), { message: "pong" });
  });

  for (const spell of ["Opt", "Consider"]) {
    it(`external ${spell === "Opt" ? "scry" : "surveil"} chooses the exact revealed card`, { timeout: 60_000 }, async () => {
      const client = createClient(); await client.start();
      const external = new ForgeExternalMatchClient(client);
      const deck: ForgeDeckSpec = { name: "Library choice", cards: [
        { name: "Talrand, Sky Summoner", quantity: 1, section: "commander" },
        { name: "Island", quantity: 30, section: "mainboard" },
        { name: spell, quantity: 30, section: "mainboard" },
      ] };
      const { sessionId } = await external.startSpecs(deck, ashlingDeck(), { seed: 12345 });
      let chosen: string | undefined;
      for (let step = 0; step < 400; step++) {
        const s = await waitForExternalSnapshot(external, sessionId, (s) => s.status === "waiting_for_decision" || s.status === "failed");
        assert.equal(s.status, "waiting_for_decision", JSON.stringify(s));
        const d = s.pendingDecision!;
        const self = s.observation!.players.find((p) => p.role === "self")!;
        assert.equal(self.role, "self");
        if (chosen && d.type === "priority_action" && self.role === "self") {
          assert.ok((spell === "Opt" ? self.hand : self.graveyard).some((c) => c.cardRef === chosen));
          await external.cancel(sessionId); return;
        }
        if (d.type === "object_selection" && (d.selectionKind === "scry_top" || d.selectionKind === "surveil_top")) {
          const card = d.options.find((o) => !o.finish)!;
          assert.ok(card.label && !card.label.startsWith("Hidden"));
          chosen = card.cardRef!;
          const selection = spell === "Opt" ? card : d.options.find((o) => o.finish)!;
          await external.submitSelection(sessionId, d.decisionId, selection.objectId);
        } else if (d.type === "priority_action") {
          const action = d.actions.find((a) => a.type === "play_land")
            ?? d.actions.find((a) => a.type === "cast_spell" && a.cardName === spell)
            ?? d.actions.find((a) => a.type === "pass");
          assert.ok(action); await external.submitDecision(sessionId, d.decisionId, action.actionId);
        } else await submitDeterministicSecondary(external, sessionId, d);
      }
      assert.fail("Library selection proof not reached");
    });
  }

  it("external trigger targets use Node outside accepted primary actions", { timeout: 60_000 }, async () => {
    const client = createClient(); await client.start();
    const external = new ForgeExternalMatchClient(client);
    const deck: ForgeDeckSpec = { name: "Trigger targets", cards: [
      { name: "Zurgo Bellstriker", quantity: 1, section: "commander" },
      { name: "Mountain", quantity: 30, section: "mainboard" },
      { name: "Viashino Pyromancer", quantity: 30, section: "mainboard" },
    ] };
    const { sessionId } = await external.startSpecs(deck, ashlingDeck(), { seed: 12345 });
    let targetChosen = false;
    for (let step = 0; step < 400; step++) {
      const s = await waitForExternalSnapshot(external, sessionId, (s) => s.status === "waiting_for_decision" || s.status === "failed");
      assert.equal(s.status, "waiting_for_decision", JSON.stringify(s));
      const d = s.pendingDecision!;
      const self = s.observation!.players.find((p) => p.role === "self")!;
      if (targetChosen && self.life === 38) { await external.cancel(sessionId); return; }
      if (d.type === "target_selection" && d.source.cardName === "Viashino Pyromancer") {
        assert.equal(d.source.actionId, null);
        const target = d.targets.find((t) => t.type === "player" && t.playerId === self.playerId);
        assert.ok(target);
        await external.submitTarget(sessionId, d.decisionId, target.targetId);
        targetChosen = true;
      } else if (d.type === "priority_action") {
        const action: ForgeExternalAction | undefined = (!targetChosen ? d.actions.find((a) => a.type === "play_land")
          ?? d.actions.find((a) => a.type === "cast_spell" && a.cardName === "Viashino Pyromancer") : undefined)
          ?? d.actions.find((a) => a.type === "pass");
        assert.ok(action); await external.submitDecision(sessionId, d.decisionId, action.actionId);
      } else await submitDeterministicSecondary(external, sessionId, d);
    }
    assert.fail("Node trigger target did not resolve as 2 damage to self");
  });

  it("external optional triggers and ordering retain exact abilities", { timeout: 60_000 }, async () => {
    const client = createClient(); await client.start();
    const external = new ForgeExternalMatchClient(client);
    const deck: ForgeDeckSpec = { name: "Optional triggers", cards: [
      { name: "Isamaru, Hound of Konda", quantity: 1, section: "commander" },
      { name: "Plains", quantity: 30, section: "mainboard" },
      { name: "Soul's Attendant", quantity: 30, section: "mainboard" },
      { name: "Memnite", quantity: 30, section: "mainboard" },
    ] };
    const { sessionId } = await external.startSpecs(deck, ashlingDeck(), { seed: 12345 });
    const answers: string[] = [];
    let orderedRef: string | undefined;
    let orderedResolvedFirst = false;
    for (let step = 0; step < 600; step++) {
      const s = await waitForExternalSnapshot(external, sessionId, (s) => s.status === "waiting_for_decision" || s.status === "failed");
      assert.equal(s.status, "waiting_for_decision", JSON.stringify(s));
      const d = s.pendingDecision!;
      const self = s.observation!.players.find((p) => p.role === "self")!;
      if (answers.includes("Yes") && answers.includes("No") && orderedResolvedFirst && self.life > 40) {
        await external.cancel(sessionId); return;
      }
      if (d.type === "ordering_selection" && d.selectionKind === "trigger_order") {
        const option = d.options.filter((o) => !o.finish).at(-1)!;
        orderedRef = option.cardRef ?? undefined;
        await external.submitSelection(sessionId, d.decisionId, option.objectId);
      } else if (d.type === "yes_no" && d.selectionKind === "optional_trigger") {
        if (orderedRef) { assert.equal(d.source?.cardRef, orderedRef); orderedResolvedFirst = true; orderedRef = undefined; }
        const label = answers.length === 0 ? "No" : "Yes";
        const option = d.options.find((o) => o.label === label)!;
        answers.push(label);
        await external.submitSelection(sessionId, d.decisionId, option.objectId);
      } else if (d.type === "priority_action") {
        const attendants = self.battlefield.filter((c) => c.name === "Soul's Attendant").length;
        const action = d.actions.find((a) => a.type === "play_land")
          ?? d.actions.find((a) => a.type === "cast_spell" && (attendants < 2 ? a.cardName === "Soul's Attendant" : a.cardName === "Memnite"))
          ?? d.actions.find((a) => a.type === "pass");
        assert.ok(action); await external.submitDecision(sessionId, d.decisionId, action.actionId);
      } else await submitDeterministicSecondary(external, sessionId, d);
    }
    assert.fail("Optional trigger/order proof not reached");
  });

  it("external legend rule keeps the exact Node-selected permanent", { timeout: 60_000 }, async () => {
    const client = createClient(); await client.start();
    const external = new ForgeExternalMatchClient(client);
    const deck: ForgeDeckSpec = { name: "Legend rule", cards: [
      { name: "Isamaru, Hound of Konda", quantity: 1, section: "commander" },
      { name: "Plains", quantity: 30, section: "mainboard" },
      { name: "Isamaru, Hound of Konda", quantity: 30, section: "mainboard" },
    ] };
    const { sessionId } = await external.startSpecs(deck, ashlingDeck(), { seed: 12345 });
    let kept: string | undefined;
    let removed: string | undefined;
    for (let step = 0; step < 400; step++) {
      const s = await waitForExternalSnapshot(external, sessionId, (s) => s.status === "waiting_for_decision" || s.status === "failed");
      assert.equal(s.status, "waiting_for_decision", JSON.stringify(s));
      const d = s.pendingDecision!;
      const self = s.observation!.players.find((p) => p.role === "self")!;
      if (kept && d.type === "priority_action") {
        assert.ok(self.battlefield.some((c) => c.cardRef === kept));
        assert.ok(!self.battlefield.some((c) => c.cardRef === removed));
        assert.ok([...self.graveyard, ...self.command].some((c) => c.cardRef === removed));
        await external.cancel(sessionId); return;
      }
      if (d.type === "object_selection" && d.selectionKind === "entity" && d.prompt.includes("legendary")) {
        const option = d.options.filter((o) => !o.finish).at(-1)!;
        kept = option.cardRef!;
        removed = d.options.find((o) => !o.finish && o.objectId !== option.objectId)?.cardRef ?? undefined;
        assert.ok(self.battlefield.some((c) => c.cardRef === kept));
        await external.submitSelection(sessionId, d.decisionId, option.objectId);
      } else if (d.type === "priority_action") {
        const action = d.actions.find((a) => a.type === "play_land")
          ?? d.actions.find((a) => a.type === "cast_spell") ?? d.actions.find((a) => a.type === "pass");
        assert.ok(action); await external.submitDecision(sessionId, d.decisionId, action.actionId);
      } else await submitDeterministicSecondary(external, sessionId, d);
    }
    assert.fail("Legend choice not reached");
  });

  for (const flying of [false, true]) {
    it(`external combat blockers: ${flying ? "flying restriction and double strike" : "no blocks, exact block and multiple blockers"}`, { timeout: 90_000 }, async () => {
      const client = createClient();
      await client.start();
      const external = new ForgeExternalMatchClient(client);
      const own: ForgeDeckSpec = { name: "Block choices", cards: [
        { name: "Ghalta, Primal Hunger", quantity: 1, section: "commander" },
        { name: "Forest", quantity: 30, section: "mainboard" },
        { name: "Memnite", quantity: 30, section: "mainboard" },
        ...(flying ? [{ name: "Ornithopter", quantity: 30, section: "mainboard" as const }] : []),
      ] };
      const opponent: ForgeDeckSpec = { name: "Native combat opponent", cards: [
        { name: flying ? "Avacyn, Angel of Hope" : "Ghalta, Primal Hunger", quantity: 1, section: "commander" },
        { name: flying ? "Plains" : "Forest", quantity: 30, section: "mainboard" },
        { name: flying ? "Skyhunter Skirmisher" : "Grizzly Bears", quantity: 30, section: "mainboard" },
      ] };
      const { sessionId } = await external.startSpecs(own, opponent, { seed: 12345 });
      let declarations = 0;
      let proof: { turn: number; refs: string[]; life: number } | undefined;
      const completed: number[] = [];
      for (let step = 0; step < 1200 && completed.length < (flying ? 1 : 3); step++) {
        const s = await waitForExternalSnapshot(external, sessionId,
          (s) => s.status === "waiting_for_decision" || s.status === "failed" || s.status === "completed");
        assert.equal(s.status, "waiting_for_decision", JSON.stringify(s));
        const d = s.pendingDecision!;
        const self = s.observation!.players.find((p) => p.role === "self")!;
        if (proof && (d.context.turn > proof.turn || d.context.phase === "main2")) {
          if (proof.refs.length === 0) assert.ok(self.life < proof.life);
          else {
            for (const ref of proof.refs) assert.ok(self.graveyard.some((c) => c.cardRef === ref), JSON.stringify({proof, self}));
          }
          completed.push(proof.refs.length);
          proof = undefined;
          if (completed.length === (flying ? 1 : 3)) break;
        }
        if (d.type === "priority_action") {
          const action = d.actions.find((a) => a.type === "play_land")
            ?? d.actions.find((a) => a.type === "cast_spell" && ["Memnite", "Ornithopter"].includes(a.cardName ?? "")
              && self.battlefield.filter((c) => c.name === a.cardName).length < (flying ? 1 : 2))
            ?? d.actions.find((a) => a.type === "pass");
          assert.ok(action);
          await external.submitDecision(sessionId, d.decisionId, action.actionId);
        } else if (d.type === "blockers_selection") {
          const amount = flying ? 1 : declarations;
          const adds = d.options.filter((o) => o.operation === "add");
          if (flying) {
            assert.ok(self.battlefield.some((c) => c.name === "Memnite"));
            assert.ok(adds.every((o) => self.battlefield.find((c) => c.cardRef === o.cardRef)?.name === "Ornithopter"));
          }
          const selected = adds.find((o) => d.selected.length === 0 || o.relatedRef === d.selected[0]?.relatedRef);
          if (d.selected.length < amount && selected) {
            await external.submitCombatChoice(sessionId, d.decisionId, selected.objectId);
          } else {
            const finish = d.options.find((o) => o.operation === "finish");
            assert.ok(finish);
            if (d.selected.length === amount) {
              proof = { turn: d.context.turn, refs: d.selected.map((a) => a.cardRef), life: self.life };
              declarations++;
            }
            await external.submitCombatChoice(sessionId, d.decisionId, finish.objectId);
          }
        } else await submitDeterministicSecondary(external, sessionId, d);
      }
      assert.deepEqual(completed, flying ? [1] : [0, 1, 2]);
      const last = await external.get(sessionId);
      assert.ok(last.forgeAiStrategicFallbacks.every((f) => f.family === "combat_damage"));
      if (flying) {
        // The external blocker survives the first strike step and assigns in the normal step only.
        assert.equal(last.forgeAiStrategicFallbacks.filter((f) => f.method === "assignCombatDamage").length, 1);
      }
      await external.cancel(sessionId);
    });
  }

  it("external combat chooses none, exact and multiple attackers with native life proof", { timeout: 90_000 }, async () => {
    const client = createClient();
    const external = new ForgeExternalMatchClient(client);
    await client.start();
    const deck: ForgeDeckSpec = { name: "Combat attackers", cards: [
      { name: "Isamaru, Hound of Konda", quantity: 1, section: "commander" },
      { name: "Plains", quantity: 30, section: "mainboard" },
      { name: "Savannah Lions", quantity: 30, section: "mainboard" },
    ] };
    const opponent: ForgeDeckSpec = { name: "Combat observer", cards: [
      { name: "Ghalta, Primal Hunger", quantity: 1, section: "commander" },
      { name: "Forest", quantity: 99, section: "mainboard" },
    ] };
    const { sessionId } = await external.startSpecs(deck, opponent, { seed: 12345 });
    let declarations = 0;
    let pendingProof: { turn: number; life: number; refs: string[]; power: number } | undefined;
    const proofs: number[] = [];
    for (let step = 0; step < 800 && proofs.length < 3; step++) {
      const snapshot = await waitForExternalSnapshot(external, sessionId,
        (s) => s.status === "waiting_for_decision" || s.status === "failed" || s.status === "completed");
      assert.equal(snapshot.status, "waiting_for_decision", JSON.stringify(snapshot));
      const d = snapshot.pendingDecision!;
      const observation = snapshot.observation!;
      const self = observation.players.find((p) => p.role === "self")!;
      const enemy = observation.players.find((p) => p.role === "opponent")!;
      assert.equal(d.context.turn, observation.game.turn);
      assert.equal(d.context.phase, observation.game.phase);
      if (pendingProof && (d.context.turn > pendingProof.turn || d.context.phase === "main2")) {
        assert.equal(enemy.life, pendingProof.life - pendingProof.power);
        for (const ref of pendingProof.refs) assert.equal(self.battlefield.find((c) => c.cardRef === ref)?.tapped, true);
        proofs.push(pendingProof.refs.length);
        pendingProof = undefined;
        if (proofs.length === 3) break;
      }
      if (d.type === "priority_action") {
        const choice = d.actions.find((a) => a.type === "play_land")
          ?? d.actions.find((a) => a.type === "cast_spell")
          ?? d.actions.find((a) => a.type === "pass");
        assert.ok(choice);
        await external.submitDecision(sessionId, d.decisionId, choice.actionId);
      } else if (d.type === "attackers_selection") {
        const count = Math.min(declarations, 2);
        const adds = d.options.filter((o) => o.operation === "add");
        const finish = d.options.find((o) => o.operation === "finish");
        if (d.selected.length < count && adds.length > 0) {
          const selected = adds.at(-1)!;
          assert.ok(self.battlefield.some((c) => c.cardRef === selected.cardRef));
          assert.equal(selected.relatedRef, enemy.playerId);
          await assert.rejects(external.submitCombatChoice(sessionId, d.decisionId, "combat-not-in-this-decision"),
            (e: unknown) => e instanceof ForgeBridgeError && e.code === "OBJECT_NOT_FOUND");
          assert.deepEqual((await external.get(sessionId)).pendingDecision, d);
          await external.submitCombatChoice(sessionId, d.decisionId, selected.objectId);
          await assert.rejects(external.submitCombatChoice(sessionId, d.decisionId, selected.objectId),
            (e: unknown) => e instanceof ForgeBridgeError && e.code === "STALE_DECISION");
          const next = await waitForExternalSnapshot(external, sessionId,
            (s) => s.pendingDecision?.decisionId !== d.decisionId && s.pendingDecision?.type === "attackers_selection");
          assert.equal(next.pendingDecision?.type, "attackers_selection");
          if (next.pendingDecision?.type === "attackers_selection") {
            assert.ok(next.pendingDecision.selected.some((a) => a.cardRef === selected.cardRef && a.relatedRef === selected.relatedRef));
          }
        } else {
          assert.ok(finish);
          if (d.selected.length === count) {
            pendingProof = { turn: d.context.turn, life: enemy.life,
              refs: d.selected.map((a) => a.cardRef),
              power: d.selected.reduce((total, a) => total + (self.battlefield.find((c) => c.cardRef === a.cardRef)?.power ?? 0), 0) };
            declarations++;
          }
          await external.submitCombatChoice(sessionId, d.decisionId, finish.objectId);
        }
      } else {
        await submitDeterministicSecondary(external, sessionId, d);
      }
    }
    assert.deepEqual(proofs, [0, 1, 2]);
    assert.deepEqual((await external.get(sessionId)).forgeAiStrategicFallbacks, []);
    await external.cancel(sessionId);
  });

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

  it("captures a player-specific observation with self hand, hidden opponent hand/library, and public commanders", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(ashlingDeck(), manifestDeck(), {
      seed: 12_345,
    });
    const waiting = await waitForObservedDecision(external, started.sessionId);
    const { observation, pendingDecision } = waiting;
    const { self, opponent } = observedPlayers(observation);

    assert.match(observation.gameRef, /^forge-game-\d+$/);
    assert.equal(observation.selfPlayerId, "player-1");
    assert.equal(self.playerId, "player-1");
    assert.equal(opponent.playerId, "player-2");
    assert.equal(self.externalController, true);
    assert.equal(opponent.externalController, false);
    assert.equal(self.hand.length, self.handSize);
    assert.ok(self.hand.length > 0);
    assert.ok(self.hand.every((card) => card.zone === "hand" && card.name));
    assert.equal("hand" in opponent, false);
    assert.ok(opponent.handSize > 0);
    assert.ok(self.librarySize > 0);
    assert.ok(opponent.librarySize > 0);
    assert.equal(
      JSON.stringify(observation).includes('"library":'),
      false,
    );
    assert.equal(
      JSON.stringify(observation).includes("Soul Summons"),
      false,
      "the opponent's distinctive hidden main-deck card must not leak",
    );
    assert.deepEqual(
      self.commanders.map((commander) => ({
        name: commander.name,
        inCommandZone: commander.inCommandZone,
        castsFromCommand: commander.castsFromCommand,
      })),
      [
        {
          name: "Ashling the Pilgrim",
          inCommandZone: true,
          castsFromCommand: 0,
        },
      ],
    );
    assert.deepEqual(
      opponent.commanders.map((commander) => commander.name),
      ["Isamaru, Hound of Konda"],
    );
    assert.equal(observation.game.turn, pendingDecision.context.turn);
    assert.equal(observation.game.phase, pendingDecision.context.phase);
    assert.equal(
      observation.game.activePlayerId,
      pendingDecision.context.activePlayerId,
    );
    assert.equal(
      observation.game.priorityPlayerId,
      pendingDecision.context.priorityPlayerId,
    );
    await external.cancel(started.sessionId);
  });

  it("cross-links cardRef and observes the exact land transition from hand to battlefield", async () => {
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
    assert.ok(found.snapshot.observation);
    assert.notEqual(found.action.type, "pass");
    const before = observedPlayers(found.snapshot.observation).self;
    const observedCard = before.hand.find(
      (card) => card.cardRef === found.action.cardRef,
    );
    assert.ok(observedCard);
    assert.equal(observedCard.name, found.action.cardName);
    assert.equal(observedCard.zone, "hand");

    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const afterSnapshot = await waitForExternalSnapshot(
      external,
      started.sessionId,
      (snapshot) =>
        snapshot.progress.landsPlayed === 1 &&
        snapshot.pendingDecision?.decisionId !== found.decision.decisionId &&
        snapshot.observation !== undefined,
    );
    assert.ok(afterSnapshot.observation);
    const after = observedPlayers(afterSnapshot.observation).self;
    assert.ok(!after.hand.some((card) => card.cardRef === found.action.cardRef));
    const battlefieldCard = after.battlefield.find(
      (card) => card.cardRef === found.action.cardRef,
    );
    assert.ok(battlefieldCard);
    assert.equal(battlefieldCard.name, "Mountain");
    assert.equal(battlefieldCard.zone, "battlefield");
    assert.equal(battlefieldCard.tapped, false);
    assert.equal(battlefieldCard.hidden, false);
    if (afterSnapshot.status !== "completed") {
      await external.cancel(started.sessionId);
    }
  });

  it("summarizes the real stack and sanitizes face-down cards exiled by Pyxis", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(pyxisDeck(), greenDeck(), {
      seed: 12_345,
    });
    const pyxis = await driveUntilAction(
      external,
      started.sessionId,
      (action) =>
        action.type === "cast_spell" &&
        action.cardName === "Pyxis of Pandemonium",
    );
    assert.notEqual(pyxis.action.type, "pass");
    await external.submitDecision(
      started.sessionId,
      pyxis.decision.decisionId,
      pyxis.action.actionId,
    );
    const onStack = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) =>
        observation.stack.some(
          (item) => item.sourceCardRef === pyxis.action.cardRef,
        ),
    );
    const stackItem = onStack.observation.stack.find(
      (item) => item.sourceCardRef === pyxis.action.cardRef,
    );
    assert.ok(stackItem);
    assert.match(stackItem.stackRef, /^stack-\d+$/);
    assert.equal(stackItem.position, 0);
    assert.equal(stackItem.sourceCardName, "Pyxis of Pandemonium");
    assert.equal(stackItem.controllerId, "player-1");
    assert.equal(stackItem.hidden, false);
    assert.match(stackItem.description ?? "", /Pyxis of Pandemonium/i);

    const activation = await driveUntilAction(
      external,
      started.sessionId,
      (action) =>
        action.type === "activate_ability" &&
        action.cardName === "Pyxis of Pandemonium",
      (decision) =>
        decision.actions.find((action) => action.type === "pass")!,
    );
    await external.submitDecision(
      started.sessionId,
      activation.decision.decisionId,
      activation.action.actionId,
    );
    const exiled = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) =>
        observation.players.every((player) => player.exile.length > 0),
    );
    for (const player of exiled.observation.players) {
      const hiddenExile = player.exile.find((card) => card.faceDown);
      assert.ok(hiddenExile);
      assert.equal(hiddenExile.name, null);
      assert.equal(hiddenExile.hidden, true);
      assert.equal(hiddenExile.typeLine, null);
      assert.equal(hiddenExile.combatKeywords, null);
      assert.equal(hiddenExile.selfAttackTriggers, null);
      assert.match(hiddenExile.cardRef, /^card-\d+$/);
    }
    if (exiled.status !== "completed") await external.cancel(started.sessionId);
  });

  it("shows opponent public battlefield/graveyard state while hiding a manifested permanent's identity", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(ashlingDeck(), manifestDeck(), {
      seed: 12_345,
    });
    const manifested = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const opponent = observation.players.find(
          (player) => player.role === "opponent",
        );
        return opponent?.battlefield.some((card) => card.faceDown) ?? false;
      },
    );
    const opponent = observedPlayers(manifested.observation).opponent;
    assert.ok(
      opponent.battlefield.some(
        (card) => card.name === "Plains" && !card.hidden,
      ),
    );
    const faceDown = opponent.battlefield.find((card) => card.faceDown);
    assert.ok(faceDown);
    assert.equal(faceDown.name, null);
    assert.equal(faceDown.hidden, true);
    assert.equal(faceDown.power, 2);
    assert.equal(faceDown.toughness, 2);
    assert.deepEqual(faceDown.combatKeywords, []);
    assert.deepEqual(faceDown.selfAttackTriggers, []);
    assert.ok(
      opponent.graveyard.some(
        (card) => card.name === "Soul Summons" && !card.hidden,
      ),
    );
    assert.equal(opponent.graveyard.length, opponent.graveyardSize);
    if (manifested.status !== "completed") {
      await external.cancel(started.sessionId);
    }
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
      external.submitTarget(
        started.sessionId,
        pendingDecision.decisionId,
        pass.actionId,
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "ACTION_ID_REQUIRED",
    );
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
      if (pendingDecision.type !== "priority_action") {
        await submitDeterministicSecondary(
          external,
          started.sessionId,
          pendingDecision,
        );
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
      next.pendingDecision?.type !== "priority_action" ||
      !next.pendingDecision.actions.some(
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
    await driveSecondaryUntil(
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
    const played = await driveSecondaryUntil(
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
    const targetSelection = await waitForTargetDecision(
      external,
      started.sessionId,
    );
    assert.equal(targetSelection.pendingDecision.source.actionId, opponentInstant.action.actionId);
    assert.equal(targetSelection.pendingDecision.source.cardRef, opponentInstant.action.cardRef);
    assert.equal(targetSelection.pendingDecision.source.cardName, "Lightning Bolt");
    assert.equal(targetSelection.pendingDecision.minTargets, 1);
    assert.equal(targetSelection.pendingDecision.maxTargets, 1);
    assert.equal(targetSelection.pendingDecision.canFinish, false);
    assert.deepEqual(
      targetSelection.pendingDecision.targets
        .filter((target) => target.type === "player")
        .map((target) => target.playerId)
        .sort(),
      ["player-1", "player-2"],
    );
    const opponent = targetSelection.pendingDecision.targets.find(
      (target) => target.type === "player" && target.playerId === "player-2",
    );
    assert.ok(opponent);
    assert.match(opponent.targetId, /^target-\d+$/);
    await external.submitTarget(
      started.sessionId,
      targetSelection.pendingDecision.decisionId,
      opponent.targetId,
    );
    const cast = await driveSecondaryUntil(
      external,
      started.sessionId,
      (snapshot) => snapshot.progress.spellsCast === 1,
    );
    assert.equal(cast.progress.primaryActionsPlayed, 2);
    assert.equal(cast.progress.targetDecisionsRequested, 1);
    assert.equal(cast.progress.targetDecisionsSubmitted, 1);
    assert.equal(cast.progress.targetsSelected, 1);
    if (cast.status !== "completed") await external.cancel(started.sessionId);
  });

  it("applies Node's card target to the retained Lightning Bolt ability", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(redDeck(), greenDeck(), {
      seed: 12_345,
    });

    let bolt:
      | {
          decision: ForgePendingDecision;
          action: Exclude<ForgeExternalAction, { type: "pass" }>;
          bearRef: string;
        }
      | undefined;
    for (let index = 0; index < 500 && !bolt; index += 1) {
      const snapshot = await waitForObservedDecision(
        external,
        started.sessionId,
      );
      const { opponent } = observedPlayers(snapshot.observation);
      const bear = opponent.battlefield.find(
        (card) => card.name === "Grizzly Bears",
      );
      const castBolt = snapshot.pendingDecision.actions.find(
        (action) =>
          action.type === "cast_spell" && action.cardName === "Lightning Bolt",
      );
      if (bear && castBolt && castBolt.type !== "pass") {
        bolt = {
          decision: snapshot.pendingDecision,
          action: castBolt,
          bearRef: bear.cardRef,
        };
        break;
      }
      const fallback =
        snapshot.pendingDecision.actions.find(
          (action) => action.type === "play_land",
        ) ??
        snapshot.pendingDecision.actions.find((action) => action.type === "pass");
      assert.ok(fallback);
      await external.submitDecision(
        started.sessionId,
        snapshot.pendingDecision.decisionId,
        fallback.actionId,
      );
    }
    assert.ok(bolt, "Forge did not reach a Bolt + Grizzly Bears target window");

    await external.submitDecision(
      started.sessionId,
      bolt.decision.decisionId,
      bolt.action.actionId,
    );
    const targeting = await waitForTargetDecision(external, started.sessionId);
    const bearTarget = targeting.pendingDecision.targets.find(
      (target) => target.type === "card" && target.cardRef === bolt.bearRef,
    );
    assert.ok(bearTarget);
    assert.equal(bearTarget.name, "Grizzly Bears");
    assert.equal(bearTarget.zone, "battlefield");
    assert.equal(bearTarget.controllerId, "player-2");
    await assert.rejects(
      external.submitDecision(
        started.sessionId,
        targeting.pendingDecision.decisionId,
        bearTarget.targetId,
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "TARGET_ID_REQUIRED",
    );
    await assert.rejects(
      external.submitTarget(
        started.sessionId,
        targeting.pendingDecision.decisionId,
        "target-does-not-exist",
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "TARGET_NOT_FOUND",
    );
    const stillTargeting = await external.get(started.sessionId);
    assert.equal(
      stillTargeting.pendingDecision?.decisionId,
      targeting.pendingDecision.decisionId,
    );
    await external.submitTarget(
      started.sessionId,
      targeting.pendingDecision.decisionId,
      bearTarget.targetId,
    );
    await assert.rejects(
      external.submitTarget(
        started.sessionId,
        targeting.pendingDecision.decisionId,
        bearTarget.targetId,
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "STALE_DECISION",
    );

    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const { opponent } = observedPlayers(observation);
        return opponent.graveyard.some((card) => card.cardRef === bolt.bearRef);
      },
    );
    const { opponent } = observedPlayers(resolved.observation);
    assert.ok(
      opponent.graveyard.some(
        (card) => card.cardRef === bolt.bearRef && card.name === "Grizzly Bears",
      ),
    );
    if (resolved.status !== "completed") {
      await external.cancel(started.sessionId);
    }
  });

  it("applies two sequential Node targets to Counterintelligence and resolves both", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(
      blueFixtureDeck("Counterintelligence multi-target", "Counterintelligence"),
      creatureFixtureDeck(),
      { seed: 12_345 },
    );
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Counterintelligence" &&
        observedPlayers(observation).opponent.battlefield.filter(
          (card) => card.name === "Grizzly Bears",
        ).length >= 2,
    );
    const before = observedPlayers(found.snapshot.observation).opponent;
    const bearRefs = before.battlefield
      .filter((card) => card.name === "Grizzly Bears")
      .slice(0, 2)
      .map((card) => card.cardRef);
    assert.equal(bearRefs.length, 2);
    assert.equal(found.action.requiresTargets, true);

    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const first = await waitForTargetDecision(external, started.sessionId);
    assert.equal(first.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(first.pendingDecision.source.cardRef, found.action.cardRef);
    assert.equal(first.pendingDecision.source.cardName, "Counterintelligence");
    assert.equal(first.pendingDecision.minTargets, 1);
    assert.equal(first.pendingDecision.maxTargets, 2);
    assert.deepEqual(first.pendingDecision.selectedTargetIds, []);
    assert.equal(first.pendingDecision.canFinish, false);
    assert.equal(first.pendingDecision.finishTargetId, null);
    for (const target of first.pendingDecision.targets.filter(
      (candidate) => candidate.type === "card",
    )) {
      assert.ok(
        before.battlefield.some((card) => card.cardRef === target.cardRef),
        `target ${target.cardRef} must use its AgentObservation cardRef`,
      );
    }
    const firstBear = first.pendingDecision.targets.find(
      (target) => target.type === "card" && target.cardRef === bearRefs[0],
    );
    assert.ok(firstBear);
    await external.submitTarget(
      started.sessionId,
      first.pendingDecision.decisionId,
      firstBear.targetId,
    );

    const second = (await waitForExternalSnapshot(
      external,
      started.sessionId,
      (snapshot) =>
        snapshot.pendingDecision?.type === "target_selection" &&
        snapshot.pendingDecision.decisionId !== first.pendingDecision.decisionId,
    )) as ForgeExternalMatchSnapshot & {
      pendingDecision: ForgePendingTargetDecision;
    };
    assert.deepEqual(second.pendingDecision.selectedTargetIds, [firstBear.targetId]);
    assert.equal(second.pendingDecision.canFinish, true);
    assert.match(second.pendingDecision.finishTargetId ?? "", /^target-\d+$/);
    assert.ok(
      !second.pendingDecision.targets.some(
        (target) => target.type === "card" && target.cardRef === bearRefs[0],
      ),
      "Forge must not re-offer the already selected creature",
    );
    const secondBear = second.pendingDecision.targets.find(
      (target) => target.type === "card" && target.cardRef === bearRefs[1],
    );
    assert.ok(secondBear);
    await external.submitTarget(
      started.sessionId,
      second.pendingDecision.decisionId,
      secondBear.targetId,
    );

    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const { self, opponent } = observedPlayers(observation);
        return (
          self.graveyard.some((card) => card.cardRef === found.action.cardRef) &&
          bearRefs.every(
            (cardRef) =>
              !opponent.battlefield.some((card) => card.cardRef === cardRef),
          )
        );
      },
    );
    const resolvedOpponent = observedPlayers(resolved.observation).opponent;
    assert.equal(resolvedOpponent.handSize, before.handSize + 2);
    assert.equal(resolved.progress.targetDecisionsRequested, 2);
    assert.equal(resolved.progress.targetDecisionsSubmitted, 2);
    assert.equal(resolved.progress.targetsSelected, 2);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("finishes Counterintelligence after its minimum and resolves only that target", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(
      blueFixtureDeck("Counterintelligence early finish", "Counterintelligence"),
      creatureFixtureDeck(),
      { seed: 12_345 },
    );
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Counterintelligence" &&
        observedPlayers(observation).opponent.battlefield.filter(
          (card) => card.name === "Grizzly Bears",
        ).length >= 2,
    );
    const before = observedPlayers(found.snapshot.observation).opponent;
    const bearRefs = before.battlefield
      .filter((card) => card.name === "Grizzly Bears")
      .slice(0, 2)
      .map((card) => card.cardRef);
    assert.equal(bearRefs.length, 2);

    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const first = await waitForTargetDecision(external, started.sessionId);
    assert.equal(first.pendingDecision.canFinish, false);
    assert.equal(first.pendingDecision.finishTargetId, null);
    const selectedBear = first.pendingDecision.targets.find(
      (target) => target.type === "card" && target.cardRef === bearRefs[0],
    );
    assert.ok(selectedBear);
    await external.submitTarget(
      started.sessionId,
      first.pendingDecision.decisionId,
      selectedBear.targetId,
    );
    const finish = (await waitForExternalSnapshot(
      external,
      started.sessionId,
      (snapshot) =>
        snapshot.pendingDecision?.type === "target_selection" &&
        snapshot.pendingDecision.decisionId !== first.pendingDecision.decisionId,
    )) as ForgeExternalMatchSnapshot & {
      pendingDecision: ForgePendingTargetDecision;
    };
    assert.deepEqual(finish.pendingDecision.selectedTargetIds, [
      selectedBear.targetId,
    ]);
    assert.equal(finish.pendingDecision.canFinish, true);
    assert.ok(finish.pendingDecision.finishTargetId);
    await external.submitTarget(
      started.sessionId,
      finish.pendingDecision.decisionId,
      finish.pendingDecision.finishTargetId,
    );

    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const { self, opponent } = observedPlayers(observation);
        return (
          self.graveyard.some((card) => card.cardRef === found.action.cardRef) &&
          !opponent.battlefield.some((card) => card.cardRef === bearRefs[0])
        );
      },
    );
    const resolvedOpponent = observedPlayers(resolved.observation).opponent;
    assert.equal(resolvedOpponent.handSize, before.handSize + 1);
    assert.ok(
      resolvedOpponent.battlefield.some((card) => card.cardRef === bearRefs[1]),
      "the unselected legal target must remain on the battlefield",
    );
    assert.equal(resolved.progress.targetDecisionsRequested, 2);
    assert.equal(resolved.progress.targetDecisionsSubmitted, 2);
    assert.equal(resolved.progress.targetsSelected, 1);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("applies Node's target to Predict's genuine DBMill sub-ability", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(
      blueFixtureDeck("Predict sub-ability target", "Predict"),
      creatureFixtureDeck(),
      { seed: 12_345 },
    );
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (_observation, action) =>
        action.type === "cast_spell" && action.cardName === "Predict",
    );
    const before = observedPlayers(found.snapshot.observation);
    assert.equal(found.action.requiresTargets, true);
    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const targeting = await waitForTargetDecision(external, started.sessionId);
    assert.equal(targeting.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(targeting.pendingDecision.source.cardRef, found.action.cardRef);
    assert.equal(targeting.pendingDecision.source.cardName, "Predict");
    assert.match(targeting.pendingDecision.prompt, /player/i);
    assert.equal(targeting.pendingDecision.minTargets, 1);
    assert.equal(targeting.pendingDecision.maxTargets, 1);
    assert.deepEqual(
      targeting.pendingDecision.targets
        .filter((target) => target.type === "player")
        .map((target) => target.playerId)
        .sort(),
      ["player-1", "player-2"],
    );
    const opponentTarget = targeting.pendingDecision.targets.find(
      (target) => target.type === "player" && target.playerId === "player-2",
    );
    assert.ok(opponentTarget);
    await external.submitTarget(
      started.sessionId,
      targeting.pendingDecision.decisionId,
      opponentTarget.targetId,
    );

    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const { self, opponent } = observedPlayers(observation);
        return (
          self.graveyard.some((card) => card.cardRef === found.action.cardRef) &&
          opponent.librarySize === before.opponent.librarySize - 1 &&
          opponent.graveyardSize === before.opponent.graveyardSize + 1
        );
      },
    );
    const after = observedPlayers(resolved.observation);
    assert.equal(after.opponent.librarySize, before.opponent.librarySize - 1);
    assert.equal(after.opponent.graveyardSize, before.opponent.graveyardSize + 1);
    assert.equal(resolved.progress.targetDecisionsRequested, 1);
    assert.equal(resolved.progress.targetDecisionsSubmitted, 1);
    assert.equal(resolved.progress.targetsSelected, 1);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("targets and counters the exact opposing stack spell selected by Node", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(
      blueFixtureDeck("Counterspell stack target", "Counterspell"),
      creatureFixtureDeck(),
      { seed: 12_345 },
    );
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Counterspell" &&
        observation.stack.some(
          (item) =>
            item.controllerId === "player-2" &&
            item.sourceCardName === "Grizzly Bears",
        ),
    );
    const opposingSpell = found.snapshot.observation.stack.find(
      (item) =>
        item.controllerId === "player-2" &&
        item.sourceCardName === "Grizzly Bears",
    );
    assert.ok(opposingSpell);
    assert.match(opposingSpell.stackRef, /^stack-\d+$/);
    assert.equal(opposingSpell.hidden, false);

    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const targeting = await waitForTargetDecision(external, started.sessionId);
    assert.ok(targeting.observation);
    assert.equal(targeting.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(targeting.pendingDecision.source.cardRef, found.action.cardRef);
    assert.equal(targeting.pendingDecision.source.cardName, "Counterspell");
    const observedStackSpell = targeting.observation.stack.find(
      (item) => item.stackRef === opposingSpell.stackRef,
    );
    assert.ok(observedStackSpell);
    const spellTarget = targeting.pendingDecision.targets.find(
      (target) =>
        target.type === "spell" && target.stackRef === opposingSpell.stackRef,
    );
    assert.ok(spellTarget);
    assert.equal(spellTarget.type, "spell");
    assert.equal(spellTarget.stackRef, observedStackSpell.stackRef);
    assert.equal(spellTarget.cardRef, observedStackSpell.sourceCardRef);
    assert.equal(spellTarget.name, observedStackSpell.sourceCardName);
    assert.equal(spellTarget.name, "Grizzly Bears");
    assert.equal(spellTarget.controllerId, "player-2");
    assert.equal(spellTarget.zone, "stack");
    assert.equal(spellTarget.hidden, false);
    await external.submitTarget(
      started.sessionId,
      targeting.pendingDecision.decisionId,
      spellTarget.targetId,
    );

    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const { self, opponent } = observedPlayers(observation);
        return (
          self.graveyard.some((card) => card.cardRef === found.action.cardRef) &&
          opponent.graveyard.some(
            (card) => card.cardRef === opposingSpell.sourceCardRef,
          )
        );
      },
    );
    const { self, opponent } = observedPlayers(resolved.observation);
    assert.ok(
      self.graveyard.some(
        (card) =>
          card.cardRef === found.action.cardRef && card.name === "Counterspell",
      ),
    );
    assert.ok(
      opponent.graveyard.some(
        (card) =>
          card.cardRef === opposingSpell.sourceCardRef &&
          card.name === "Grizzly Bears",
      ),
    );
    assert.ok(
      !opponent.battlefield.some(
        (card) => card.cardRef === opposingSpell.sourceCardRef,
      ),
      "the countered spell must not resolve to the battlefield",
    );
    assert.ok(
      !resolved.observation.stack.some(
        (item) =>
          item.stackRef === opposingSpell.stackRef ||
          item.sourceCardRef === found.action.cardRef,
      ),
    );
    assert.equal(resolved.progress.targetDecisionsRequested, 1);
    assert.equal(resolved.progress.targetDecisionsSubmitted, 1);
    assert.equal(resolved.progress.targetsSelected, 1);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("applies Node's fixed single mode to a retained Gruesome Realization", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(
      singleModeDeck(),
      creatureFixtureDeck(),
      { seed: 12_345 },
    );
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Gruesome Realization" &&
        observedPlayers(observation).opponent.battlefield.some(
          (card) => card.name === "Grizzly Bears",
        ),
    );
    const before = observedPlayers(found.snapshot.observation);
    const bearRef = before.opponent.battlefield.find(
      (card) => card.name === "Grizzly Bears",
    )?.cardRef;
    assert.ok(bearRef);

    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const choosingMode = await waitForModeDecision(
      external,
      started.sessionId,
    );
    assert.ok(choosingMode.observation);
    assert.equal(choosingMode.pendingDecision.playerId, "player-1");
    assert.equal(
      choosingMode.pendingDecision.source.actionId,
      found.action.actionId,
    );
    assert.equal(
      choosingMode.pendingDecision.source.cardRef,
      found.action.cardRef,
    );
    assert.equal(
      choosingMode.pendingDecision.source.cardName,
      "Gruesome Realization",
    );
    assert.equal(
      choosingMode.observation.game.turn,
      choosingMode.pendingDecision.context.turn,
    );
    assert.equal(
      choosingMode.observation.game.phase,
      choosingMode.pendingDecision.context.phase,
    );
    assert.equal(choosingMode.pendingDecision.minModes, 1);
    assert.equal(choosingMode.pendingDecision.maxModes, 1);
    assert.deepEqual(choosingMode.pendingDecision.selectedModeIds, []);
    assert.equal(choosingMode.pendingDecision.canFinish, false);
    assert.equal(choosingMode.pendingDecision.finishModeId, null);
    assert.deepEqual(
      choosingMode.pendingDecision.modes.map((mode) => mode.description),
      [
        "You draw two cards and you lose 2 life.",
        "Creatures your opponents control get -1/-1 until end of turn.",
      ],
    );
    assert.ok(
      choosingMode.pendingDecision.modes.every(
        (mode) => /^mode-\d+$/.test(mode.modeId) && mode.label === mode.description,
      ),
    );
    const drawMode = choosingMode.pendingDecision.modes.find((mode) =>
      mode.description?.includes("draw two cards"),
    );
    assert.ok(drawMode);
    await external.submitMode(
      started.sessionId,
      choosingMode.pendingDecision.decisionId,
      drawMode.modeId,
    );

    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const { self } = observedPlayers(observation);
        return (
          self.graveyard.some((card) => card.cardRef === found.action.cardRef) &&
          self.life === before.self.life - 2
        );
      },
    );
    const after = observedPlayers(resolved.observation);
    const unchangedBear = after.opponent.battlefield.find(
      (card) => card.cardRef === bearRef,
    );
    assert.ok(unchangedBear);
    assert.equal(after.self.handSize, before.self.handSize + 1);
    assert.equal(after.self.life, before.self.life - 2);
    assert.equal(unchangedBear.power, 2);
    assert.equal(unchangedBear.toughness, 2);
    assert.equal(resolved.progress.modeDecisionsRequested, 1);
    assert.equal(resolved.progress.modeDecisionsSubmitted, 1);
    assert.equal(resolved.progress.modesSelected, 1);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("composes Light of Hope mode selection with Node target selection", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(
      targetedModeDeck(),
      creatureFixtureDeck(),
      { seed: 12_345 },
    );
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Light of Hope" &&
        observedPlayers(observation).opponent.battlefield.some(
          (card) => card.name === "Grizzly Bears",
        ),
    );
    const before = observedPlayers(found.snapshot.observation);
    const bear = before.opponent.battlefield.find(
      (card) => card.name === "Grizzly Bears",
    );
    assert.ok(bear);
    assert.equal(found.action.requiresTargets, false);
    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );

    const choosingMode = await waitForModeDecision(
      external,
      started.sessionId,
    );
    assert.equal(
      choosingMode.pendingDecision.source.actionId,
      found.action.actionId,
    );
    assert.deepEqual(
      choosingMode.pendingDecision.modes.map((mode) => mode.description),
      [
        "You gain 4 life.",
        "Put a +1/+1 counter on target creature.",
      ],
      "Forge must filter the destroy-enchantment mode when it has no legal target",
    );
    await assert.rejects(
      external.submitTarget(
        started.sessionId,
        choosingMode.pendingDecision.decisionId,
        "target-does-not-belong-here",
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "MODE_ID_REQUIRED",
    );
    await assert.rejects(
      external.submitMode(
        started.sessionId,
        choosingMode.pendingDecision.decisionId,
        "mode-does-not-exist",
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "MODE_NOT_FOUND",
    );
    const stillChoosingMode = await external.get(started.sessionId);
    assert.equal(
      stillChoosingMode.pendingDecision?.decisionId,
      choosingMode.pendingDecision.decisionId,
    );
    const counterMode = choosingMode.pendingDecision.modes.find((mode) =>
      mode.description?.includes("+1/+1 counter"),
    );
    assert.ok(counterMode);
    await external.submitMode(
      started.sessionId,
      choosingMode.pendingDecision.decisionId,
      counterMode.modeId,
    );
    await assert.rejects(
      external.submitMode(
        started.sessionId,
        choosingMode.pendingDecision.decisionId,
        counterMode.modeId,
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "STALE_DECISION",
    );

    const choosingTarget = (await waitForExternalSnapshot(
      external,
      started.sessionId,
      (snapshot) => snapshot.pendingDecision?.type === "target_selection",
    )) as ForgeExternalMatchSnapshot & {
      pendingDecision: ForgePendingTargetDecision;
    };
    assert.equal(
      choosingTarget.pendingDecision.source.actionId,
      found.action.actionId,
    );
    assert.equal(
      choosingTarget.pendingDecision.source.cardRef,
      found.action.cardRef,
    );
    assert.equal(choosingTarget.pendingDecision.source.cardName, "Light of Hope");
    const bearTarget = choosingTarget.pendingDecision.targets.find(
      (target) => target.type === "card" && target.cardRef === bear.cardRef,
    );
    assert.ok(bearTarget);
    await external.submitTarget(
      started.sessionId,
      choosingTarget.pendingDecision.decisionId,
      bearTarget.targetId,
    );

    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const { self, opponent } = observedPlayers(observation);
        const targetedBear = opponent.battlefield.find(
          (card) => card.cardRef === bear.cardRef,
        );
        return (
          self.graveyard.some((card) => card.cardRef === found.action.cardRef) &&
          targetedBear?.power === 3 &&
          targetedBear.toughness === 3
        );
      },
    );
    const after = observedPlayers(resolved.observation);
    const targetedBear = after.opponent.battlefield.find(
      (card) => card.cardRef === bear.cardRef,
    );
    assert.ok(targetedBear);
    assert.equal(after.self.life, before.self.life, "the gain-life mode was not chosen");
    assert.ok(
      Object.values(targetedBear.counters ?? {}).some((count) => count === 1),
    );
    assert.equal(resolved.progress.modeDecisionsRequested, 1);
    assert.equal(resolved.progress.modeDecisionsSubmitted, 1);
    assert.equal(resolved.progress.modesSelected, 1);
    assert.equal(resolved.progress.targetDecisionsRequested, 1);
    assert.equal(resolved.progress.targetDecisionsSubmitted, 1);
    assert.equal(resolved.progress.targetsSelected, 1);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("pays Lightning Bolt with the exact Node-selected Mountain", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(redDeck(), greenDeck(), {
      seed: 12_345,
    });
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Lightning Bolt" &&
        observedPlayers(observation).self.battlefield.filter(
          (card) => card.name === "Mountain" && card.tapped === false,
        ).length >= 2,
    );
    const beforeLife = observedPlayers(found.snapshot.observation).opponent.life;
    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const targeting = await waitForTargetDecision(external, started.sessionId);
    const opponent = targeting.pendingDecision.targets.find(
      (target) => target.type === "player" && target.playerId === "player-2",
    );
    assert.ok(opponent);
    await external.submitTarget(
      started.sessionId,
      targeting.pendingDecision.decisionId,
      opponent.targetId,
    );

    const payment = await waitForManaPaymentDecision(
      external,
      started.sessionId,
    );
    assert.equal(payment.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(payment.pendingDecision.source.cardRef, found.action.cardRef);
    assert.equal(payment.pendingDecision.remainingCost.text, "{R}");
    assert.deepEqual(payment.pendingDecision.remainingCost.shards, ["R"]);
    assert.equal(payment.pendingDecision.manaPool.total, 0);
    assert.equal(payment.pendingDecision.canFinish, false);
    const mountains = payment.pendingDecision.options.filter(
      (option) => option.type === "activate_mana_ability",
    );
    assert.ok(mountains.length >= 2);
    assert.ok(
      mountains.every(
        (option) =>
          option.sourceCardName === "Mountain" &&
          option.produces.join(" ") === "R" &&
          option.tapped === false &&
          /^card-\d+$/.test(option.sourceCardRef),
      ),
    );
    const unselected = mountains[0]!;
    const selected = mountains[1]!;

    await assert.rejects(
      external.submitTarget(
        started.sessionId,
        payment.pendingDecision.decisionId,
        "target-does-not-belong",
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError &&
        error.code === "MANA_OPTION_ID_REQUIRED",
    );
    await assert.rejects(
      external.submitManaOption(
        started.sessionId,
        payment.pendingDecision.decisionId,
        "mana-option-does-not-exist",
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError &&
        error.code === "MANA_OPTION_NOT_FOUND",
    );
    assert.equal(
      (await external.get(started.sessionId)).pendingDecision?.decisionId,
      payment.pendingDecision.decisionId,
    );
    await external.submitManaOption(
      started.sessionId,
      payment.pendingDecision.decisionId,
      selected.manaOptionId,
    );
    await assert.rejects(
      external.submitManaOption(
        started.sessionId,
        payment.pendingDecision.decisionId,
        selected.manaOptionId,
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "STALE_DECISION",
    );

    const paid = await waitForObservedDecision(external, started.sessionId);
    const paidBattlefield = observedPlayers(paid.observation).self.battlefield;
    assert.equal(
      paidBattlefield.find((card) => card.cardRef === selected.sourceCardRef)
        ?.tapped,
      true,
    );
    assert.equal(
      paidBattlefield.find((card) => card.cardRef === unselected.sourceCardRef)
        ?.tapped,
      false,
    );
    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) =>
        observedPlayers(observation).opponent.life === beforeLife - 3,
    );
    assert.equal(resolved.progress.manaPaymentDecisionsRequested, 1);
    assert.equal(resolved.progress.manaPaymentDecisionsSubmitted, 1);
    assert.equal(resolved.progress.manaOptionsSelected, 1);
    assert.equal(resolved.progress.manaPaymentsFallbackToAi, 0);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("iterates a mixed generic and colored payment over distinct Mountains", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(redDeck(), greenDeck(), {
      seed: 54_321,
    });
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Goblin Piker" &&
        observedPlayers(observation).self.battlefield.filter(
          (card) => card.name === "Mountain" && card.tapped === false,
        ).length >= 2,
    );
    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const first = await waitForManaPaymentDecision(external, started.sessionId);
    assert.equal(first.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(first.pendingDecision.remainingCost.text, "{1}{R}");
    const firstSource = first.pendingDecision.options.find(
      (option) => option.type === "activate_mana_ability",
    );
    assert.ok(firstSource?.sourceCardRef);
    await external.submitManaOption(
      started.sessionId,
      first.pendingDecision.decisionId,
      firstSource.manaOptionId,
    );

    const second = await waitForManaPaymentDecision(external, started.sessionId);
    assert.notEqual(second.pendingDecision.decisionId, first.pendingDecision.decisionId);
    assert.equal(second.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(second.pendingDecision.remainingCost.text, "{1}");
    assert.equal(
      observedPlayers(second.observation).self.battlefield.find(
        (card) => card.cardRef === firstSource.sourceCardRef,
      )?.tapped,
      true,
    );
    assert.ok(
      !second.pendingDecision.options.some(
        (option) =>
          option.type === "activate_mana_ability" &&
          option.sourceCardRef === firstSource.sourceCardRef,
      ),
    );
    const secondSource = second.pendingDecision.options.find(
      (option) => option.type === "activate_mana_ability",
    );
    assert.ok(secondSource?.sourceCardRef);
    assert.notEqual(secondSource.sourceCardRef, firstSource.sourceCardRef);
    await external.submitManaOption(
      started.sessionId,
      second.pendingDecision.decisionId,
      secondSource.manaOptionId,
    );
    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) =>
        observedPlayers(observation).self.battlefield.some(
          (card) => card.cardRef === found.action.cardRef,
        ),
    );
    assert.equal(resolved.progress.manaPaymentDecisionsRequested, 2);
    assert.equal(resolved.progress.manaOptionsSelected, 2);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("uses Sol Ring's real two-mana ability and exposes its leftover as floating mana", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(manaRockDeck(), greenDeck(), {
      seed: 12_345,
    });

    const ringCast = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Sol Ring" &&
        observedPlayers(observation).self.battlefield.some(
          (card) => card.name === "Mountain" && card.tapped === false,
        ),
    );
    await external.submitDecision(
      started.sessionId,
      ringCast.decision.decisionId,
      ringCast.action.actionId,
    );
    const ringPayment = await waitForManaPaymentDecision(
      external,
      started.sessionId,
    );
    const mountainForRing = ringPayment.pendingDecision.options.find(
      (option) => option.type === "activate_mana_ability",
    );
    assert.ok(mountainForRing);
    await external.submitManaOption(
      started.sessionId,
      ringPayment.pendingDecision.decisionId,
      mountainForRing.manaOptionId,
    );
    await driveUntilObservation(
      external,
      started.sessionId,
      (observation) =>
        observedPlayers(observation).self.battlefield.some(
          (card) => card.cardRef === ringCast.action.cardRef,
        ),
    );

    const commander = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) => {
        const battlefield = observedPlayers(observation).self.battlefield;
        return (
          action.type === "cast_spell" &&
          action.cardName === "Ashling the Pilgrim" &&
          battlefield.some(
            (card) =>
              card.cardRef === ringCast.action.cardRef && card.tapped === false,
          ) &&
          battlefield.filter(
            (card) => card.name === "Mountain" && card.tapped === false,
          ).length >= 2
        );
      },
    );
    await external.submitDecision(
      started.sessionId,
      commander.decision.decisionId,
      commander.action.actionId,
    );
    const firstCommanderPayment = await waitForManaPaymentDecision(
      external,
      started.sessionId,
    );
    const ring = firstCommanderPayment.pendingDecision.options.find(
      (option) =>
        option.type === "activate_mana_ability" &&
        option.sourceCardRef === ringCast.action.cardRef,
    );
    assert.ok(ring);
    assert.deepEqual(ring.produces, ["C", "C"]);
    await external.submitManaOption(
      started.sessionId,
      firstCommanderPayment.pendingDecision.decisionId,
      ring.manaOptionId,
    );
    const redCommanderPayment = await waitForManaPaymentDecision(
      external,
      started.sessionId,
    );
    assert.equal(redCommanderPayment.pendingDecision.remainingCost.text, "{R}");
    assert.equal(redCommanderPayment.pendingDecision.manaPool.byColor.C, 1);
    const redSource = redCommanderPayment.pendingDecision.options.find(
      (option) => option.type === "activate_mana_ability",
    );
    assert.ok(redSource);
    await external.submitManaOption(
      started.sessionId,
      redCommanderPayment.pendingDecision.decisionId,
      redSource.manaOptionId,
    );

    const activation = await driveUntilObservedAction(
      external,
      started.sessionId,
      (_observation, action) =>
        action.type === "activate_ability" &&
        action.cardName === "Ashling the Pilgrim",
      (_observation, decision) =>
        decision.actions.find((action) => action.type === "pass")!,
    );
    await external.submitDecision(
      started.sessionId,
      activation.decision.decisionId,
      activation.action.actionId,
    );
    const floatingPayment = await waitForManaPaymentDecision(
      external,
      started.sessionId,
    );
    assert.equal(floatingPayment.pendingDecision.source.actionId, activation.action.actionId);
    assert.equal(floatingPayment.pendingDecision.manaPool.byColor.C, 1);
    const floating = floatingPayment.pendingDecision.options.find(
      (option) => option.type === "spend_floating_mana",
    );
    assert.ok(floating);
    assert.equal(floating.color, "C");
    assert.match(floating.manaRef, /^mana-\d+$/);
    await external.submitManaOption(
      started.sessionId,
      floatingPayment.pendingDecision.decisionId,
      floating.manaOptionId,
    );
    const finalRed = await waitForManaPaymentDecision(external, started.sessionId);
    assert.equal(finalRed.pendingDecision.remainingCost.text, "{R}");
    const finalMountain = finalRed.pendingDecision.options.find(
      (option) => option.type === "activate_mana_ability",
    );
    assert.ok(finalMountain);
    await external.submitManaOption(
      started.sessionId,
      finalRed.pendingDecision.decisionId,
      finalMountain.manaOptionId,
    );
    const played = await driveSecondaryUntil(
      external,
      started.sessionId,
      (snapshot) => snapshot.progress.abilitiesActivated === 1,
    );
    assert.ok(played.progress.manaPaymentDecisionsRequested >= 5);
    assert.equal(played.progress.manaPaymentsFallbackToAi, 0);
    if (played.status !== "completed") await external.cancel(started.sessionId);
  });

  it("V2e.6.1 §15: Command Tower externalizes as one exact option per legal commander-identity color, and choosing the required color actually taps it and produces that mana through Forge", { timeout: 120_000 }, async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(commandTowerDeck(), harmlessOpponentDeck(), {
      seed: 8_675_309,
    });
    const relevantLands = new Set(["Swamp", "Rogue's Passage", "Command Tower"]);
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.manaCost === "{1}{W}" &&
        observedPlayers(observation).self.battlefield.filter(
          (card) => relevantLands.has(card.name ?? "") && card.tapped === false,
        ).length >= 2 &&
        observedPlayers(observation).self.battlefield.some(
          (card) => card.name === "Command Tower" && card.tapped === false,
        ),
    );
    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );

    const payment = await waitForManaPaymentDecision(external, started.sessionId);
    assert.equal(payment.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(payment.pendingDecision.remainingCost.text, "{1}{W}");

    // Never the vague Forge-internal "Combo ColorIdentity" shape, and never a color outside the
    // real WB commander identity (V2e.6.1 §§3-4).
    const commandTowerOptions = payment.pendingDecision.options.filter(
      (option) => option.type === "activate_mana_ability" && option.sourceCardName === "Command Tower",
    );
    assert.ok(commandTowerOptions.length >= 1, "Command Tower must appear in mana_payment at all");
    assert.ok(
      commandTowerOptions.every((option) => option.produces.length === 1 && ["W", "B"].includes(option.produces[0]!)),
      "every Command Tower option must be exactly one commander-identity color, never Combo/ColorIdentity",
    );
    assert.ok(
      !commandTowerOptions.some((option) => option.produces.some((color) => !["W", "B"].includes(color))),
      "never a color outside the WB commander identity (e.g. U/R/G)",
    );
    const commandTowerW = commandTowerOptions.find((option) => option.produces.join("") === "W");
    assert.ok(commandTowerW, "Command Tower must expose an exact W option while {1}{W} still needs W");
    assert.equal(commandTowerW.color, "W");
    const sameSourceRef = commandTowerOptions.every((option) => option.sourceCardRef === commandTowerW.sourceCardRef);
    assert.ok(sameSourceRef, "every option for the one physical Command Tower shares its exact sourceCardRef");

    // §7 regression: the existing simple fixed-mana sources sharing this exact battlefield must be
    // entirely unaffected by Command Tower's new combo-color support.
    const rogue = payment.pendingDecision.options.find(
      (option) => option.type === "activate_mana_ability" && option.sourceCardName === "Rogue's Passage",
    );
    if (rogue) {
      assert.deepEqual(rogue.produces, ["C"]);
      assert.equal(rogue.color, null);
    }
    const swamp = payment.pendingDecision.options.find(
      (option) => option.type === "activate_mana_ability" && option.sourceCardName === "Swamp",
    );
    if (swamp) {
      assert.deepEqual(swamp.produces, ["B"]);
      assert.equal(swamp.color, null);
    }

    await external.submitManaOption(
      started.sessionId,
      payment.pendingDecision.decisionId,
      commandTowerW.manaOptionId,
    );

    // The ACTUAL Forge mutation, not a Node-side simulation: Command Tower really taps, and the
    // remaining cost genuinely drops the W pip (V2e.6.1 §5).
    const afterCommandTower = await waitForManaPaymentDecision(external, started.sessionId);
    assert.notEqual(afterCommandTower.pendingDecision.decisionId, payment.pendingDecision.decisionId);
    assert.equal(afterCommandTower.pendingDecision.remainingCost.text, "{1}");
    const towerCard = observedPlayers(afterCommandTower.observation).self.battlefield.find(
      (card) => card.cardRef === commandTowerW.sourceCardRef,
    );
    assert.equal(towerCard?.tapped, true, "Command Tower must actually tap through Forge");
    assert.ok(
      !afterCommandTower.pendingDecision.options.some(
        (option) => option.type === "activate_mana_ability" && option.sourceCardRef === commandTowerW.sourceCardRef,
      ),
      "the now-tapped Command Tower must not be offered a second time",
    );

    const genericSource = afterCommandTower.pendingDecision.options.find(
      (option) => option.type === "activate_mana_ability",
    );
    assert.ok(genericSource, "a real source must remain to pay the last generic {1}");
    await external.submitManaOption(
      started.sessionId,
      afterCommandTower.pendingDecision.decisionId,
      genericSource.manaOptionId,
    );

    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) =>
        observedPlayers(observation).self.battlefield.some(
          (card) => card.cardRef === found.action.cardRef,
        ),
    );
    assert.equal(resolved.progress.manaPaymentsFallbackToAi, 0, "no fallback to Forge's own AI was ever needed");
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("casts a real X spell with Node-selected X=2 and rejects invalid values", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(xValueDeck(), greenDeck(), {
      seed: 12_345,
    });
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Walking Ballista" &&
        observedPlayers(observation).self.battlefield.filter(
          (card) => card.name === "Wastes",
        ).length >= 4,
    );
    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );

    const choosingValue = await waitForValueDecision(
      external,
      started.sessionId,
    );
    assert.ok(choosingValue.observation);
    assert.equal(choosingValue.pendingDecision.valueKind, "x");
    assert.equal(choosingValue.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(choosingValue.pendingDecision.source.cardRef, found.action.cardRef);
    assert.equal(choosingValue.pendingDecision.minValue, 0);
    assert.ok(choosingValue.pendingDecision.maxValue >= 2);
    assert.equal(
      choosingValue.observation.game.turn,
      choosingValue.pendingDecision.context.turn,
    );
    assert.ok(
      !observedPlayers(choosingValue.observation).self.hand.some(
        (card) => card.cardRef === found.action.cardRef,
      ),
      "the fresh paused state reflects that Forge moved the spell out of hand",
    );

    await assert.rejects(
      external.submitDecision(
        started.sessionId,
        choosingValue.pendingDecision.decisionId,
        found.action.actionId,
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "VALUE_REQUIRED",
    );
    await assert.rejects(
      external.submitValue(
        started.sessionId,
        choosingValue.pendingDecision.decisionId,
        -1,
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "VALUE_OUT_OF_RANGE",
    );
    await assert.rejects(
      external.submitValue(
        started.sessionId,
        choosingValue.pendingDecision.decisionId,
        choosingValue.pendingDecision.maxValue + 1,
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "VALUE_OUT_OF_RANGE",
    );
    await assert.rejects(
      client.request({
        type: "submit_external_decision",
        sessionId: started.sessionId,
        decisionId: choosingValue.pendingDecision.decisionId,
        value: 1.5,
      }),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "VALUE_NOT_INTEGER",
    );
    const stillPending = await external.get(started.sessionId);
    assert.equal(
      stillPending.pendingDecision?.decisionId,
      choosingValue.pendingDecision.decisionId,
    );

    await external.submitValue(
      started.sessionId,
      choosingValue.pendingDecision.decisionId,
      2,
    );
    await assert.rejects(
      external.submitValue(
        started.sessionId,
        choosingValue.pendingDecision.decisionId,
        2,
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "STALE_DECISION",
    );
    const xPayment = await waitForManaPaymentDecision(
      external,
      started.sessionId,
    );
    assert.equal(xPayment.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(xPayment.pendingDecision.remainingCost.text, "{4}");
    assert.equal(xPayment.pendingDecision.remainingCost.generic, 4);
    const firstWastes = xPayment.pendingDecision.options.find(
      (option) => option.type === "activate_mana_ability",
    );
    assert.ok(firstWastes);
    await external.submitManaOption(
      started.sessionId,
      xPayment.pendingDecision.decisionId,
      firstWastes.manaOptionId,
    );
    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const ballista = observedPlayers(observation).self.battlefield.find(
          (card) => card.cardRef === found.action.cardRef,
        );
        return (
          ballista !== undefined &&
          Object.values(ballista.counters ?? {}).reduce(
            (total, count) => total + count,
            0,
          ) === 2
        );
      },
    );
    assert.equal(resolved.progress.valueDecisionsRequested, 1);
    assert.equal(resolved.progress.valueDecisionsSubmitted, 1);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("accepts a real kicker cost before Node target selection", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(kickerDeck(), greenDeck(), {
      seed: 12_345,
    });
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Burst Lightning" &&
        observedPlayers(observation).self.battlefield.filter(
          (card) => card.name === "Mountain",
        ).length >= 5,
    );
    const before = observedPlayers(found.snapshot.observation);
    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const optional = await waitForOptionalCostDecision(
      external,
      started.sessionId,
    );
    assert.equal(optional.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(optional.pendingDecision.minSelections, 0);
    assert.equal(optional.pendingDecision.maxSelections, 1);
    assert.equal(optional.pendingDecision.costs.length, 1);
    assert.equal(optional.pendingDecision.costs[0]?.type, "kicker1");
    assert.match(optional.pendingDecision.costs[0]?.costText ?? "", /4/);
    await assert.rejects(
      external.submitOptionalCost(
        started.sessionId,
        optional.pendingDecision.decisionId,
        "cost-does-not-exist",
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "COST_NOT_FOUND",
    );
    await external.submitOptionalCost(
      started.sessionId,
      optional.pendingDecision.decisionId,
      optional.pendingDecision.costs[0]!.costId,
    );

    const targeting = await waitForTargetDecision(external, started.sessionId);
    assert.equal(targeting.pendingDecision.source.actionId, found.action.actionId);
    const opponent = targeting.pendingDecision.targets.find(
      (target) => target.type === "player" && target.playerId === "player-2",
    );
    assert.ok(opponent);
    await external.submitTarget(
      started.sessionId,
      targeting.pendingDecision.decisionId,
      opponent.targetId,
    );
    const kickedPayment = await waitForManaPaymentDecision(
      external,
      started.sessionId,
    );
    assert.equal(kickedPayment.pendingDecision.source.actionId, found.action.actionId);
    assert.equal(kickedPayment.pendingDecision.remainingCost.text, "{4}{R}");
    assert.equal(kickedPayment.pendingDecision.remainingCost.generic, 4);
    const firstMountain = kickedPayment.pendingDecision.options.find(
      (option) => option.type === "activate_mana_ability",
    );
    assert.ok(firstMountain);
    await external.submitManaOption(
      started.sessionId,
      kickedPayment.pendingDecision.decisionId,
      firstMountain.manaOptionId,
    );
    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const players = observedPlayers(observation);
        return (
          players.self.graveyard.some(
            (card) => card.cardRef === found.action.cardRef,
          ) && players.opponent.life === before.opponent.life - 4
        );
      },
    );
    assert.equal(resolved.progress.optionalCostDecisionsRequested, 1);
    assert.equal(resolved.progress.optionalCostsSelected, 1);
    assert.equal(resolved.progress.targetDecisionsRequested, 1);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("declines a real kicker cost and resolves the un-kicked effect", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(kickerDeck(), greenDeck(), {
      seed: 54_321,
    });
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Burst Lightning" &&
        observedPlayers(observation).self.battlefield.some(
          (card) => card.name === "Mountain",
        ),
    );
    const beforeLife = observedPlayers(found.snapshot.observation).opponent.life;
    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const optional = await waitForOptionalCostDecision(
      external,
      started.sessionId,
    );
    await external.submitOptionalCost(
      started.sessionId,
      optional.pendingDecision.decisionId,
      optional.pendingDecision.declineCostId,
    );
    const targeting = await waitForTargetDecision(external, started.sessionId);
    const opponent = targeting.pendingDecision.targets.find(
      (target) => target.type === "player" && target.playerId === "player-2",
    );
    assert.ok(opponent);
    await external.submitTarget(
      started.sessionId,
      targeting.pendingDecision.decisionId,
      opponent.targetId,
    );
    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) =>
        observedPlayers(observation).opponent.life === beforeLife - 2,
    );
    assert.equal(resolved.progress.optionalCostDecisionsRequested, 1);
    assert.equal(resolved.progress.optionalCostsSelected, 0);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("sacrifices the exact Forge permanent selected by opaque objectId", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(
      sacrificeCostDeck(),
      greenDeck(),
      { seed: 12_345 },
    );
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Village Rites" &&
        observedPlayers(observation).self.battlefield.filter(
          (card) => card.name === "Sanitarium Skeleton",
        ).length >= 2,
      (observation, decision) => {
        const skeletons = observedPlayers(observation).self.battlefield.filter(
          (card) => card.name === "Sanitarium Skeleton",
        ).length;
        return (
          decision.actions.find((action) => action.type === "play_land") ??
          (skeletons < 2
            ? decision.actions.find(
                (action) =>
                  action.type === "cast_spell" &&
                  action.cardName === "Sanitarium Skeleton",
              )
            : undefined) ??
          decision.actions.find((action) => action.type === "pass")!
        );
      },
    );
    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const choosingObject = await waitForCostObjectDecision(
      external,
      started.sessionId,
    );
    assert.ok(choosingObject.observation);
    assert.equal(choosingObject.pendingDecision.selectionKind, "sacrifice");
    assert.equal(choosingObject.pendingDecision.source.actionId, found.action.actionId);
    assert.ok(choosingObject.pendingDecision.options.length >= 2);
    assert.ok(
      choosingObject.pendingDecision.options.every(
        (option) =>
          /^object-\d+$/.test(option.objectId) &&
          option.zone === "battlefield" &&
          option.name === "Sanitarium Skeleton" &&
          option.hidden === false,
      ),
    );
    const selected = choosingObject.pendingDecision.options[1]!;
    const unselected = choosingObject.pendingDecision.options[0]!;
    await assert.rejects(
      external.submitCostObject(
        started.sessionId,
        choosingObject.pendingDecision.decisionId,
        "object-does-not-exist",
      ),
      (error: unknown) =>
        error instanceof ForgeBridgeError && error.code === "OBJECT_NOT_FOUND",
    );
    await external.submitCostObject(
      started.sessionId,
      choosingObject.pendingDecision.decisionId,
      selected.objectId,
    );
    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const self = observedPlayers(observation).self;
        return (
          self.graveyard.some((card) => card.cardRef === selected.cardRef) &&
          self.graveyard.some((card) => card.cardRef === found.action.cardRef)
        );
      },
    );
    const after = observedPlayers(resolved.observation).self;
    assert.ok(after.battlefield.some((card) => card.cardRef === unselected.cardRef));
    assert.ok(!after.battlefield.some((card) => card.cardRef === selected.cardRef));
    assert.equal(resolved.progress.costObjectDecisionsRequested, 1);
    assert.equal(resolved.progress.costObjectsSelected, 1);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
  });

  it("discards the exact visible self-hand card selected by opaque objectId", async () => {
    const client = createClient();
    await client.start();
    const external = new ForgeExternalMatchClient(client);
    const started = await external.startSpecs(discardCostDeck(), greenDeck(), {
      seed: 12_345,
    });
    const found = await driveUntilObservedAction(
      external,
      started.sessionId,
      (observation, action) =>
        action.type === "cast_spell" &&
        action.cardName === "Thrill of Possibility" &&
        observedPlayers(observation).self.battlefield.filter(
          (card) => card.name === "Mountain",
        ).length >= 2,
    );
    await external.submitDecision(
      started.sessionId,
      found.decision.decisionId,
      found.action.actionId,
    );
    const choosingObject = await waitForCostObjectDecision(
      external,
      started.sessionId,
    );
    assert.equal(choosingObject.pendingDecision.selectionKind, "discard");
    assert.equal(choosingObject.pendingDecision.source.actionId, found.action.actionId);
    assert.ok(choosingObject.pendingDecision.options.length >= 1);
    assert.ok(
      choosingObject.pendingDecision.options.every(
        (option) =>
          option.zone === "hand" && option.name !== null && !option.hidden,
      ),
    );
    const selected = choosingObject.pendingDecision.options.at(-1)!;
    assert.notEqual(selected.cardRef, found.action.cardRef);
    await external.submitCostObject(
      started.sessionId,
      choosingObject.pendingDecision.decisionId,
      selected.objectId,
    );
    const resolved = await driveUntilObservation(
      external,
      started.sessionId,
      (observation) => {
        const self = observedPlayers(observation).self;
        return (
          self.graveyard.some((card) => card.cardRef === selected.cardRef) &&
          self.graveyard.some((card) => card.cardRef === found.action.cardRef)
        );
      },
    );
    const after = observedPlayers(resolved.observation).self;
    assert.ok(after.graveyard.some((card) => card.cardRef === selected.cardRef));
    assert.equal(resolved.progress.costObjectDecisionsRequested, 1);
    assert.equal(resolved.progress.costObjectsSelected, 1);
    if (resolved.status !== "completed") await external.cancel(started.sessionId);
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
