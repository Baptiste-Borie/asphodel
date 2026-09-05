import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { DecisionRecorder } from "./human/decision-recorder.js";
import { reportDirectoryName, writePlaytestReport } from "./human/playtest-report.js";
import type { AgentObservation, AgentSelfPlayerObservation, ForgeExternalMatchProgress, ForgeExternalMatchSnapshot, ForgePendingExternalDecision as Decision } from "./forge/forge-protocol.js";

const progress: ForgeExternalMatchProgress = {
  decisionsRequested: 0, decisionsSubmitted: 0, passesSubmitted: 0, primaryActionsSubmitted: 0, primaryActionsPlayed: 0, landsPlayed: 0, spellsCast: 0, abilitiesActivated: 0,
  targetDecisionsRequested: 0, targetDecisionsSubmitted: 0, targetsSelected: 0, modeDecisionsRequested: 0, modeDecisionsSubmitted: 0, modesSelected: 0,
  valueDecisionsRequested: 0, valueDecisionsSubmitted: 0, optionalCostDecisionsRequested: 0, optionalCostsSelected: 0, costObjectDecisionsRequested: 0, costObjectsSelected: 0,
  manaPaymentDecisionsRequested: 0, manaPaymentDecisionsSubmitted: 0, manaOptionsSelected: 0, manaPaymentsFallbackToAi: 0,
};

function agentObservation(hand: AgentSelfPlayerObservation["hand"] = []): AgentObservation {
  const context = { turn: 4, phase: "main1", activePlayerId: "player-2", priorityPlayerId: "player-2" };
  const self: AgentSelfPlayerObservation = { role: "self", playerId: "player-2", name: "Asphodel", life: 38, startingLife: 40, handSize: hand.length, librarySize: 90, graveyardSize: 0, exileSize: 0, commandZoneSize: 1, battlefieldSize: 0, externalController: true, hand, battlefield: [], graveyard: [], exile: [], command: [], commanders: [] };
  const { hand: _hand, ...publicSelf } = self;
  return { selfPlayerId: "player-2", gameRef: "game", game: context, stack: [], players: [self, { ...publicSelf, role: "opponent", playerId: "player-1", name: "Human", externalController: false, battlefield: [] }] };
}

function priorityDecision(turn: number): Extract<Decision, { type: "priority_action" }> {
  const context = { turn, phase: "main1", activePlayerId: "player-2", priorityPlayerId: "player-2", stackSize: 0 };
  return { decisionId: `d-${turn}`, type: "priority_action", playerId: "player-2", context, actions: [
    { actionId: "pass", type: "pass", label: "Pass priority", cardRef: null, cardName: null, sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false },
    { actionId: "cast-1", type: "cast_spell", label: "Cast Goblin Warchief", cardRef: "card-1", cardName: "Goblin Warchief", sourceZone: "hand", abilityText: null, manaCost: "1 R R", requiresTargets: false },
  ] };
}

function snapshot(overrides: Partial<ForgeExternalMatchSnapshot> = {}): ForgeExternalMatchSnapshot {
  return {
    sessionId: "match-1", status: "waiting_for_decision", progress,
    publicTelemetry: { "player-1": { attacks: 2, damageToPlayers: 4, damageToCards: 0, spellsCast: 1 }, "player-2": { attacks: 5, damageToPlayers: 10, damageToCards: 2, spellsCast: 3 } },
    forgeAiStrategicFallbacks: [{ family: "combat_damage", method: "assignCombatDamage", sourceCardRef: null, reason: "x" }],
    pendingDecision: priorityDecision(7), observation: agentObservation(),
    ...overrides,
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "asphodel-playtest-report-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

it("generates summary.md and decisions.json with sequential reportIds, reasons, and raw DTOs, for a playtest ended by the human", async () => {
  await withTempDir(async reportsRoot => {
    const recorder = new DecisionRecorder();
    const sourceObservation = agentObservation();
    for (let i = 0; i < 3; i++) {
      const decision = priorityDecision(4);
      recorder.record(sourceObservation, decision, { decisionId: decision.decisionId, kind: "action", choice: "cast-1", reason: "cast_creature" });
    }
    const result = await writePlaytestReport({
      startedAt: new Date("2026-09-05T22:30:00.000Z"), sessionId: "match-1", seed: 42,
      humanDeckName: "Uurg, Spawn of Turg", agentDeckName: "Krenko, Tin Street Kingpin",
      humanPlayerId: "player-1", agentPlayerId: "player-2",
      endedByHuman: true, snapshot: snapshot(), decisions: recorder.all(), reportsRoot,
    });

    assert.equal(result.directory, join(reportsRoot, reportDirectoryName(new Date("2026-09-05T22:30:00.000Z"), "Uurg, Spawn of Turg", "Krenko, Tin Street Kingpin")));
    const summary = await readFile(result.summaryPath, "utf8");
    const decisionsJson = JSON.parse(await readFile(result.decisionsPath, "utf8"));

    assert.match(summary, /# Asphodel Playtest Report/);
    assert.match(summary, /Status: ended_by_human/);
    assert.match(summary, /Turn reached: 7/);
    assert.match(summary, /Asphodel decisions: 3/);
    assert.match(summary, /Result: playtest ended by human/);
    assert.ok(!/Winner:/.test(summary), "must never invent a winner for an ended-by-human playtest");
    assert.match(summary, /### A0001 — Turn 4 \/ Main1/);
    assert.match(summary, /### A0003 — Turn 4 \/ Main1/);
    assert.match(summary, /Reason:\ncast_creature/);
    assert.match(summary, /Cast Goblin Warchief/);

    assert.equal(decisionsJson.schemaVersion, 1);
    assert.equal(decisionsJson.match.sessionId, "match-1");
    assert.equal(decisionsJson.match.status, "ended_by_human");
    assert.equal(decisionsJson.decisions.length, 3);
    assert.deepEqual(decisionsJson.decisions.map((d: { reportId: string }) => d.reportId), ["A0001", "A0002", "A0003"]);
    for (const decision of decisionsJson.decisions) {
      assert.equal(decision.choice.reason, "cast_creature");
      assert.equal(decision.decision.decisionId, "d-4");
      assert.ok(decision.observation, "raw observation must be present in JSON");
      assert.ok(decision.decision, "raw decision must be present in JSON");
      // The recorder/report pipeline must round-trip the exact observation Forge already scoped to
      // Asphodel (V2c contract) — never enrich, merge, or otherwise touch it.
      assert.deepEqual(decision.observation, sourceObservation);
      const opponent = decision.observation.players.find((p: { playerId: string }) => p.playerId === "player-1");
      assert.equal(opponent.hand, undefined, "the human seat must carry no hand field in the recorded observation");
    }
  });
});

it("reports a natural completion with a winner, turn count and terminal reason", async () => {
  await withTempDir(async reportsRoot => {
    const recorder = new DecisionRecorder();
    const completed: ForgeExternalMatchSnapshot = {
      sessionId: "match-2", status: "completed", progress,
      publicTelemetry: { "player-1": { attacks: 2, damageToPlayers: 4, damageToCards: 0, spellsCast: 1 }, "player-2": { attacks: 5, damageToPlayers: 10, damageToCards: 2, spellsCast: 3 } },
      forgeAiStrategicFallbacks: [{ family: "combat_damage", method: "assignCombatDamage", sourceCardRef: null, reason: "x" }],
      result: { gameId: "g", format: "commander", seed: 42, players: [], winnerId: "player-2", turns: 12, gameOver: true, draw: false, terminalReason: "AllOpponentsLost", commanderRulesActive: true },
    };
    const result = await writePlaytestReport({
      startedAt: new Date("2026-09-05T22:30:00.000Z"), sessionId: "match-2", seed: 7,
      humanDeckName: "Human Deck", agentDeckName: "Asphodel Deck",
      humanPlayerId: "player-1", agentPlayerId: "player-2",
      endedByHuman: false, snapshot: completed, decisions: recorder.all(), reportsRoot,
    });
    const summary = await readFile(result.summaryPath, "utf8");
    assert.match(summary, /Status: completed/);
    assert.match(summary, /Winner: Asphodel/);
    assert.match(summary, /Turns: 12/);
    assert.match(summary, /Terminal reason: AllOpponentsLost/);
    assert.match(summary, /combat damage assignment: 1/);
  });
});

it("report directory names are chronologically sortable, filesystem-safe, and identify the decks", () => {
  const name = reportDirectoryName(new Date("2026-09-05T22:30:00.000Z"), "Uurg, Spawn of Turg", "Krenko, Tin Street Kingpin!");
  assert.match(name, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_uurg-spawn-of-turg-vs-krenko-tin-street-kingpin$/);
  assert.ok(!/[^a-z0-9_-]/i.test(name), "must be filesystem-safe");
});
