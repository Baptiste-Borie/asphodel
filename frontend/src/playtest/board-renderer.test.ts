import assert from "node:assert/strict";
import { it } from "node:test";
import { collectVisibleCardNames, formatPhase } from "./board-renderer.js";
import type { AgentObservation, AgentSelfPlayerObservation } from "./types.js";

it("formats phase identifiers into readable labels", () => {
  assert.equal(formatPhase("main1"), "Main 1");
  assert.equal(formatPhase("upkeep"), "Upkeep");
  assert.equal(formatPhase("combat_damage"), "Combat Damage");
  assert.equal(formatPhase("end_of_turn"), "End Of Turn");
});

function card(name: string | null, hidden = false) {
  return { cardRef: `card-${name ?? "x"}`, name, zone: "battlefield" as const, ownerId: "player-1", controllerId: "player-1", faceDown: false, hidden, tapped: false, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Land" };
}

it("collects every publicly-named card across all zones, deduplicated, and never a hidden/null name", () => {
  const self: AgentSelfPlayerObservation = {
    role: "self", playerId: "player-1", name: "You", life: 40, startingLife: 40, handSize: 2, librarySize: 50, graveyardSize: 1, exileSize: 0, commandZoneSize: 0, battlefieldSize: 1, externalController: true,
    hand: [card("Forest"), card("Forest")], battlefield: [card("Sol Ring")], graveyard: [card("Swamp")], exile: [], command: [], commanders: [],
  };
  const observation: AgentObservation = {
    selfPlayerId: "player-1", gameRef: "g", game: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1" }, stack: [],
    players: [self, { ...self, role: "opponent", playerId: "player-2", battlefield: [card("Mountain")], hand: undefined as never, handSize: 3, graveyard: [card(null, true)] }],
  };
  const names = collectVisibleCardNames(observation);
  assert.deepEqual(new Set(names), new Set(["Forest", "Sol Ring", "Swamp", "Mountain"]));
});
