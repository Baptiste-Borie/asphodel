import assert from "node:assert/strict";
import { it } from "node:test";
import { newlyArrivedPermanents } from "./reveal-detection.js";
import type { AgentCardObservation, AgentObservation } from "./types.js";

function card(overrides: Partial<AgentCardObservation> = {}): AgentCardObservation {
  return {
    cardRef: "c-1", name: "Centaur Courser", zone: "battlefield", ownerId: "player-2", controllerId: "player-2",
    faceDown: false, hidden: false, tapped: false, summoningSick: true, counters: null, power: 3, toughness: 3,
    typeLine: "Creature — Centaur", ...overrides,
  };
}

function observation(opponentHand: AgentCardObservation[], opponentBattlefield: AgentCardObservation[]): AgentObservation {
  return {
    selfPlayerId: "player-1", gameRef: "g", game: { turn: 1, phase: "main1", activePlayerId: "player-2", priorityPlayerId: "player-2" },
    stack: [],
    players: [
      { role: "self", playerId: "player-1", name: "player-1", life: 40, startingLife: 40, handSize: 0, librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: 0, externalController: true, hand: [], battlefield: [], graveyard: [], exile: [], command: [], commanders: [] },
      { role: "opponent", playerId: "player-2", name: "Asphodel", life: 40, startingLife: 40, handSize: opponentHand.length, librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: opponentBattlefield.length, externalController: false, battlefield: opponentBattlefield, graveyard: [], exile: [], command: [] , commanders: []},
    ],
  };
}

it("returns nothing for the very first observation (no previous to diff against)", () => {
  assert.deepEqual(newlyArrivedPermanents(null, observation([], [card()])), []);
});

it("reveals a creature that just entered the battlefield from the stack", () => {
  const previous = observation([], []);
  const next = observation([], [card()]);
  const revealed = newlyArrivedPermanents(previous, next);
  assert.equal(revealed.length, 1);
  assert.equal(revealed[0]!.name, "Centaur Courser");
});

it("never reveals a land — already announced via its own \"plays <land>\" line", () => {
  const previous = observation([], []);
  const next = observation([], [card({ cardRef: "forest-1", name: "Forest", typeLine: "Basic Land — Forest" })]);
  assert.deepEqual(newlyArrivedPermanents(previous, next), []);
});

it("never reveals a concealed/hidden arrival", () => {
  const previous = observation([], []);
  const next = observation([], [card({ hidden: true, name: null })]);
  assert.deepEqual(newlyArrivedPermanents(previous, next), []);
});

it("does not reveal a card that was already on the battlefield (no change)", () => {
  const obs = observation([], [card()]);
  assert.deepEqual(newlyArrivedPermanents(obs, obs), []);
});

it("reveals a card whose cardRef was never seen in ANY previous zone — the common case: a spell cast straight from the opponent's opaque hand", () => {
  // The opponent's hand contents are never visible in AgentObservation at all — so the very first
  // time a cast creature's cardRef appears anywhere is exactly when it lands on the battlefield.
  // A diffing approach that requires a KNOWN previous zone (like visual-transitions.ts's
  // diffLocations) would silently miss this — see this module's own doc comment.
  const previous = observation([], []);
  const next = observation([], [card({ cardRef: "never-seen-before" })]);
  const revealed = newlyArrivedPermanents(previous, next);
  assert.equal(revealed.length, 1);
  assert.equal(revealed[0]!.cardRef, "never-seen-before");
});

it("reveals every simultaneously-new permanent, not just one", () => {
  const previous = observation([], []);
  const next = observation([], [card({ cardRef: "a" }), card({ cardRef: "b", name: "Second Creature" })]);
  assert.deepEqual(newlyArrivedPermanents(previous, next).map((c) => c.cardRef).sort(), ["a", "b"]);
});
