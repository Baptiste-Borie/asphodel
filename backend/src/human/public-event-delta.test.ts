import assert from "node:assert/strict";
import { it } from "node:test";
import { describeObservationDelta } from "./public-event-delta.js";
import type { AgentCardObservation, AgentObservation, AgentSelfPlayerObservation } from "../forge/forge-protocol.js";

function card(overrides: Partial<AgentCardObservation> = {}): AgentCardObservation {
  return {
    cardRef: "c-1", name: "Centaur Courser", zone: "battlefield", ownerId: "player-1", controllerId: "player-1",
    faceDown: false, hidden: false, tapped: false, summoningSick: true, counters: null, power: 3, toughness: 3,
    typeLine: "Creature — Centaur", ...overrides,
  };
}

function observation(overrides: { life?: number; opponentLife?: number; battlefield?: AgentCardObservation[]; opponentBattlefield?: AgentCardObservation[] } = {}): AgentObservation {
  const self: AgentSelfPlayerObservation = {
    role: "self", playerId: "player-1", name: "player-1", life: overrides.life ?? 40, startingLife: 40, handSize: 2,
    librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: (overrides.battlefield ?? []).length,
    externalController: true, hand: [], battlefield: overrides.battlefield ?? [], graveyard: [], exile: [], command: [], commanders: [],
  };
  const opponent = {
    ...self, role: "opponent" as const, playerId: "player-2", name: "Asphodel", life: overrides.opponentLife ?? 40,
    battlefield: overrides.opponentBattlefield ?? [], battlefieldSize: (overrides.opponentBattlefield ?? []).length,
  };
  return {
    selfPlayerId: "player-1", gameRef: "g", game: { turn: 1, phase: "main1", activePlayerId: "player-2", priorityPlayerId: "player-2" },
    stack: [], players: [self, opponent],
  };
}

it("returns nothing for the very first frame (no previous observation to compare against)", () => {
  assert.deepEqual(describeObservationDelta(null, observation()), []);
});

it("returns nothing across a different game (gameRef changed — never diffs across games)", () => {
  const previous = observation();
  const next = { ...observation(), gameRef: "different-game" };
  assert.deepEqual(describeObservationDelta(previous, next), []);
});

it("reports the human's own life loss as \"You lost N life\", never guessing whose life it is", () => {
  const lines = describeObservationDelta(observation({ life: 40 }), observation({ life: 37 }));
  assert.deepEqual(lines, ["You lost 3 life"]);
});

it("reports the opponent's life gain by their actual name, never a hardcoded label", () => {
  const lines = describeObservationDelta(observation({ opponentLife: 40 }), observation({ opponentLife: 44 }));
  assert.deepEqual(lines, ["Asphodel gained 4 life"]);
});

it("reports a new non-land permanent entering the battlefield", () => {
  const lines = describeObservationDelta(
    observation({ opponentBattlefield: [] }),
    observation({ opponentBattlefield: [card()] }),
  );
  assert.deepEqual(lines, ["Centaur Courser entered the battlefield"]);
});

it("never reports a land entering the battlefield — that is already the \"plays <land>\" line", () => {
  const lines = describeObservationDelta(
    observation({ opponentBattlefield: [] }),
    observation({ opponentBattlefield: [card({ cardRef: "forest-1", name: "Forest", typeLine: "Basic Land — Forest" })] }),
  );
  assert.deepEqual(lines, []);
});

it("never reports a hidden/concealed arrival by name", () => {
  const lines = describeObservationDelta(
    observation({ opponentBattlefield: [] }),
    observation({ opponentBattlefield: [card({ hidden: true, name: null })] }),
  );
  assert.deepEqual(lines, []);
});

it("reports nothing when nothing actually changed", () => {
  const obs = observation({ battlefield: [card()] });
  assert.deepEqual(describeObservationDelta(obs, obs), []);
});

it("combines a life change and a new arrival in one call", () => {
  const lines = describeObservationDelta(
    observation({ opponentLife: 40, opponentBattlefield: [] }),
    observation({ opponentLife: 37, opponentBattlefield: [card()] }),
  );
  assert.deepEqual(lines.sort(), ["Asphodel lost 3 life", "Centaur Courser entered the battlefield"]);
});
