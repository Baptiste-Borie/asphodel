import assert from "node:assert/strict";
import { it } from "node:test";
import { logCommanderCastDiagnostics } from "./commander-cast-diagnostics.js";
import type { AgentObservation, AgentSelfPlayerObservation, ForgePendingExternalDecision } from "../forge/forge-protocol.js";

function observation(): AgentObservation {
  const self: AgentSelfPlayerObservation = {
    role: "self", playerId: "player-1", name: "player-1", life: 40, startingLife: 40, handSize: 2, librarySize: 50,
    graveyardSize: 0, exileSize: 0, commandZoneSize: 1, battlefieldSize: 0, externalController: true,
    hand: [], battlefield: [], graveyard: [], exile: [], command: [],
    commanders: [{ cardRef: "krrik-1", name: "K'rrik, Son of Yawgmoth", inCommandZone: true, castsFromCommand: 0, commanderTaxGeneric: 0 }],
  };
  return {
    selfPlayerId: "player-1", gameRef: "g", game: { turn: 3, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1" }, stack: [],
    players: [self, { ...self, role: "opponent", playerId: "player-2" }],
  };
}

function priorityDecision(): Extract<ForgePendingExternalDecision, { type: "priority_action" }> {
  return {
    decisionId: "d-1", type: "priority_action", playerId: "player-1",
    context: { turn: 3, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 0 },
    actions: [{ actionId: "pass", type: "pass", label: "Pass priority", cardRef: null, cardName: null, sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false }],
  };
}

it("produces no output at all unless ASPHODEL_DEBUG_COMMANDER_CAST=1 — never noisy by default", () => {
  delete process.env.ASPHODEL_DEBUG_COMMANDER_CAST;
  let called = false;
  const original = console.debug;
  console.debug = () => { called = true; };
  try {
    logCommanderCastDiagnostics(observation(), priorityDecision());
  } finally {
    console.debug = original;
  }
  assert.equal(called, false);
});

it("logs the commander tax/cast/offered-actions snapshot when enabled and a commander is in the command zone", () => {
  process.env.ASPHODEL_DEBUG_COMMANDER_CAST = "1";
  let payload: string | null = null;
  const original = console.debug;
  console.debug = (..._args: unknown[]) => { payload = String(_args[1]); };
  try {
    logCommanderCastDiagnostics(observation(), priorityDecision());
  } finally {
    console.debug = original;
    delete process.env.ASPHODEL_DEBUG_COMMANDER_CAST;
  }
  assert.ok(payload, "expected a diagnostic line when enabled");
  const parsed = JSON.parse(payload!);
  assert.equal(parsed.commanders[0].name, "K'rrik, Son of Yawgmoth");
  assert.equal(parsed.commanders[0].commanderTaxGeneric, 0);
  assert.equal(parsed.life, 40);
});

it("produces no output when no commander is currently in the command zone — nothing to investigate", () => {
  process.env.ASPHODEL_DEBUG_COMMANDER_CAST = "1";
  let called = false;
  const original = console.debug;
  console.debug = () => { called = true; };
  try {
    const obs = observation();
    obs.players[0]!.commanders = [{ ...obs.players[0]!.commanders[0]!, inCommandZone: false }];
    logCommanderCastDiagnostics(obs, priorityDecision());
  } finally {
    console.debug = original;
    delete process.env.ASPHODEL_DEBUG_COMMANDER_CAST;
  }
  assert.equal(called, false);
});

it("never runs against a decision belonging to a different player than the one carrying commanders in the fixture (defensive: no crash, no output)", () => {
  process.env.ASPHODEL_DEBUG_COMMANDER_CAST = "1";
  let called = false;
  const original = console.debug;
  console.debug = () => { called = true; };
  try {
    const obs = observation();
    const decision = { ...priorityDecision(), playerId: "nonexistent-player" };
    logCommanderCastDiagnostics(obs, decision);
  } finally {
    console.debug = original;
    delete process.env.ASPHODEL_DEBUG_COMMANDER_CAST;
  }
  assert.equal(called, false);
});
