import assert from "node:assert/strict";
import { it } from "node:test";
import { cardDisplayName, categorizeCard, formatCounters } from "./card-format.js";
import type { AgentCardObservation } from "./types.js";

function card(overrides: Partial<AgentCardObservation> = {}): AgentCardObservation {
  return {
    cardRef: "card-1", name: "Forest", zone: "battlefield", ownerId: "player-1", controllerId: "player-1",
    faceDown: false, hidden: false, tapped: false, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Land",
    ...overrides,
  };
}

it("shows the real name for a visible card", () => {
  assert.equal(cardDisplayName(card({ name: "Uurg, Spawn of Turg" })), "Uurg, Spawn of Turg");
});

it("never exposes a hidden card's identity", () => {
  assert.equal(cardDisplayName(card({ hidden: true, name: null })), "Hidden card");
  assert.equal(cardDisplayName(card({ hidden: true, name: null, faceDown: true })), "Face-down card");
});

it("categorizes a printed Land type line as land, everything else as other", () => {
  assert.equal(categorizeCard("Basic Land — Forest"), "land");
  assert.equal(categorizeCard("Land"), "land");
  assert.equal(categorizeCard("Legendary Creature — Human"), "other");
  assert.equal(categorizeCard("Artifact"), "other");
  assert.equal(categorizeCard(null), "other");
  assert.equal(categorizeCard(undefined), "other");
});

it("formats a counters map into a readable, stable list", () => {
  assert.equal(formatCounters({ "+1/+1": 2 }), "2 +1/+1");
  assert.equal(formatCounters({ "+1/+1": 2, loyalty: 3 }), "2 +1/+1, 3 loyalty");
  assert.equal(formatCounters(null), null);
  assert.equal(formatCounters({}), null);
});
