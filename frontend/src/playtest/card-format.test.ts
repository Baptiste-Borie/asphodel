import assert from "node:assert/strict";
import { it } from "node:test";
import { cardDisplayName, categorizeCard, counterBadges, formatCounters } from "./card-format.js";
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

it("counterBadges: a +1/+1 counter produces one badge with its count", () => {
  assert.deepEqual(counterBadges({ "+1/+1": 2 }), [{ type: "+1/+1", count: 2 }]);
});

it("counterBadges: an arbitrary/unrecognized Forge counter type uses the same generic badge, never hardcoded to +1/+1", () => {
  assert.deepEqual(counterBadges({ charge: 5 }), [{ type: "charge", count: 5 }]);
  assert.deepEqual(counterBadges({ loyalty: 3 }), [{ type: "loyalty", count: 3 }]);
  assert.deepEqual(counterBadges({ "-1/-1": 1 }), [{ type: "-1/-1", count: 1 }]);
});

it("counterBadges: multiple counter types produce multiple badges, in a stable sorted order", () => {
  assert.deepEqual(counterBadges({ loyalty: 3, "+1/+1": 2 }), [{ type: "+1/+1", count: 2 }, { type: "loyalty", count: 3 }]);
});

it("counterBadges: a zero-count entry is dropped, and null/empty counters produce no badges", () => {
  assert.deepEqual(counterBadges({ "+1/+1": 0 }), []);
  assert.deepEqual(counterBadges(null), []);
  assert.deepEqual(counterBadges(undefined), []);
  assert.deepEqual(counterBadges({}), []);
});

it("counterBadges: calling it again with the same input (simulated re-poll) yields the identical badge list", () => {
  const counters = { "+1/+1": 1 };
  assert.deepEqual(counterBadges(counters), counterBadges(counters));
});
