import assert from "node:assert/strict";
import { it } from "node:test";
import { collectVisibleCardNames, commandZoneCards, formatPhase } from "./board-renderer.js";
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

function selfPlayerWithCommand(command: ReturnType<typeof card>[]): AgentSelfPlayerObservation {
  return {
    role: "self", playerId: "player-1", name: "You", life: 40, startingLife: 40, handSize: 0, librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: command.length, battlefieldSize: 0, externalController: true,
    hand: [], battlefield: [], graveyard: [], exile: [], command, commanders: [],
  };
}

it("commandZoneCards excludes Forge's own pseudo-objects (e.g. \"Commander Effect\") but keeps a real commander", () => {
  const player = selfPlayerWithCommand([card("Krenko, Tin Street Kingpin"), { ...card("Commander Effect"), zone: "command" }]);
  const rendered = commandZoneCards(player);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0]?.name, "Krenko, Tin Street Kingpin");
});

it("commandZoneCards supports multiple real commanders (partners)", () => {
  const player = selfPlayerWithCommand([card("Ravos, Soultender"), card("Silas Renn, Seeker Adept")]);
  const rendered = commandZoneCards(player);
  assert.deepEqual(rendered.map(c => c.name), ["Ravos, Soultender", "Silas Renn, Seeker Adept"]);
});

it("commandZoneCards is empty (not faked) once the only commander has been cast to the battlefield", () => {
  const player = selfPlayerWithCommand([]);
  assert.deepEqual(commandZoneCards(player), []);
});

it("collectVisibleCardNames never asks about Forge's own command-zone pseudo-objects", () => {
  const self = selfPlayerWithCommand([{ ...card("Commander Effect"), zone: "command" }]);
  const observation: AgentObservation = {
    selfPlayerId: "player-1", gameRef: "g", game: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1" }, stack: [],
    players: [self],
  };
  assert.deepEqual(collectVisibleCardNames(observation), []);
});

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
