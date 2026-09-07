import assert from "node:assert/strict";
import { it } from "node:test";
import { resolvePlayerPresentation } from "./player-presentation.js";
import type { AgentObservation, AgentSelfPlayerObservation } from "../forge/forge-protocol.js";

function selfPlayer(overrides: Partial<AgentSelfPlayerObservation> = {}): AgentSelfPlayerObservation {
  return {
    role: "self", playerId: "player-1", name: "External Player 1", life: 40, startingLife: 40, handSize: 0,
    librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: 0, externalController: true,
    hand: [], battlefield: [], graveyard: [], exile: [], command: [], commanders: [],
    ...overrides,
  };
}

function observation(players: AgentObservation["players"]): AgentObservation {
  return {
    selfPlayerId: "player-1", gameRef: "g",
    game: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1" },
    stack: [], players,
  };
}

it("resolves the human's own player id to a readable self presentation, never the raw engine name", () => {
  const self = selfPlayer();
  const opponent = { ...self, role: "opponent" as const, playerId: "player-2", name: "External Player 2" };
  const o = observation([self, opponent]);
  const presentation = resolvePlayerPresentation("player-1", o);
  assert.equal(presentation?.displayName, "You");
  assert.equal(presentation?.role, "self");
  assert.equal(presentation?.life, 40);
});

it("resolves a single opponent to a plain 'Asphodel' presentation (no letter suffix for 1v1)", () => {
  const self = selfPlayer();
  const opponent = { ...self, role: "opponent" as const, playerId: "player-2", name: "External Player 2", life: 28 };
  const o = observation([self, opponent]);
  const presentation = resolvePlayerPresentation("player-2", o);
  assert.equal(presentation?.displayName, "Asphodel");
  assert.equal(presentation?.role, "opponent");
  assert.equal(presentation?.life, 28);
});

it("V2f.1 §9: multiple opponents are distinguished by stable position, never by comparing playerId to a hardcoded id", () => {
  const self = selfPlayer();
  const opponentA = { ...self, role: "opponent" as const, playerId: "player-7", name: "External Player 7", life: 12 };
  const opponentB = { ...self, role: "opponent" as const, playerId: "player-3", name: "External Player 3", life: 5 };
  const o = observation([self, opponentA, opponentB]);
  assert.equal(resolvePlayerPresentation("player-7", o)?.displayName, "Asphodel A");
  assert.equal(resolvePlayerPresentation("player-3", o)?.displayName, "Asphodel B");
});

it("falls back safely (null) for a player id the current observation cannot resolve at all", () => {
  const self = selfPlayer();
  const o = observation([self]);
  assert.equal(resolvePlayerPresentation("player-does-not-exist", o), null);
});

it("never returns Forge's raw registered name ('External Player N') for a resolvable player", () => {
  const self = selfPlayer();
  const opponent = { ...self, role: "opponent" as const, playerId: "player-2", name: "External Player 2" };
  const o = observation([self, opponent]);
  for (const playerId of ["player-1", "player-2"]) {
    const presentation = resolvePlayerPresentation(playerId, o);
    assert.ok(presentation);
    assert.ok(!/External Player/i.test(presentation.displayName));
  }
});
