import assert from "node:assert/strict";
import { it } from "node:test";
import { describeCard, formatPhase } from "./board-renderer.js";
import type { AgentCardObservation } from "./types.js";

function card(overrides: Partial<AgentCardObservation> = {}): AgentCardObservation {
  return {
    cardRef: "card-1", name: "Forest", zone: "battlefield", ownerId: "player-1", controllerId: "player-1",
    faceDown: false, hidden: false, tapped: false, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Land",
    ...overrides,
  };
}

it("shows a plain name with no tags when nothing is notable", () => {
  assert.equal(describeCard(card(), "card-1"), "Forest");
});

it("shows (T) for a tapped permanent", () => {
  assert.equal(describeCard(card({ tapped: true }), "card-1"), "Forest [T]");
});

it("shows power/toughness, tapped, summoning sick and counters together", () => {
  const label = describeCard(card({
    name: "Birds of Paradise", power: 0, toughness: 1, tapped: true, summoningSick: true, counters: { "+1/+1": 2 },
  }), "card-1");
  assert.equal(label, "Birds of Paradise [0/1, T, summoning sick, 2 +1/+1]");
});

it("never exposes a hidden card's identity", () => {
  assert.equal(describeCard(card({ hidden: true, name: null }), "card-1"), "hidden card");
  assert.equal(describeCard(card({ hidden: true, name: null, faceDown: true }), "card-1"), "face-down card");
});

it("falls back to the cardRef when the card itself is unknown", () => {
  assert.equal(describeCard(undefined, "card-99"), "card-99");
});

it("formats phase identifiers into readable labels", () => {
  assert.equal(formatPhase("main1"), "Main 1");
  assert.equal(formatPhase("upkeep"), "Upkeep");
  assert.equal(formatPhase("combat_damage"), "Combat Damage");
  assert.equal(formatPhase("end_of_turn"), "End Of Turn");
});
