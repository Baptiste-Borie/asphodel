import assert from "node:assert/strict";
import { it } from "node:test";
import { isLandCard, partitionBattlefield } from "./land-zone.js";
import type { AgentCardObservation } from "./types.js";

function card(overrides: Partial<AgentCardObservation> & { cardRef: string }): AgentCardObservation {
  return {
    name: "Forest", zone: "battlefield", ownerId: "player-1", controllerId: "player-1",
    faceDown: false, hidden: false, tapped: false, summoningSick: false, counters: null,
    power: null, toughness: null, typeLine: "Basic Land — Forest", token: false,
    ...overrides,
  };
}

it("detects a land via typeLine containing the Magic card type \"Land\"", () => {
  assert.ok(isLandCard({ typeLine: "Basic Land — Forest" }));
  assert.ok(isLandCard({ typeLine: "Land" }));
  assert.ok(isLandCard({ typeLine: "Artifact Land" }));
});

it("does not treat a non-land permanent as a land", () => {
  assert.ok(!isLandCard({ typeLine: "Creature — Goblin" }));
  assert.ok(!isLandCard({ typeLine: "Artifact — Equipment" }));
  assert.ok(!isLandCard({ typeLine: "Legendary Creature — Human Wizard" }));
});

it("a null typeLine (hidden card) is never treated as a land", () => {
  assert.ok(!isLandCard({ typeLine: null }));
});

it("partitionBattlefield splits lands from everything else, preserving order within each side", () => {
  const cards = [
    card({ cardRef: "f1", name: "Forest", typeLine: "Basic Land — Forest" }),
    card({ cardRef: "krenko", name: "Krenko, Tin Street Kingpin", typeLine: "Legendary Creature — Goblin" }),
    card({ cardRef: "f2", name: "Forest", typeLine: "Basic Land — Forest" }),
    card({ cardRef: "solring", name: "Sol Ring", typeLine: "Artifact" }),
    card({ cardRef: "m1", name: "Mountain", typeLine: "Basic Land — Mountain" }),
  ];
  const { lands, nonLands } = partitionBattlefield(cards);
  assert.deepEqual(lands.map(c => c.cardRef), ["f1", "f2", "m1"]);
  assert.deepEqual(nonLands.map(c => c.cardRef), ["krenko", "solring"]);
});

it("an all-lands battlefield yields an empty nonLands list, and vice versa", () => {
  const allLands = [card({ cardRef: "f1" }), card({ cardRef: "f2" })];
  assert.deepEqual(partitionBattlefield(allLands).nonLands, []);
  const allCreatures = [card({ cardRef: "c1", typeLine: "Creature — Bear" })];
  assert.deepEqual(partitionBattlefield(allCreatures).lands, []);
});

it("this is presentation only — the partition never mutates or drops any card, every cardRef is preserved across both lists combined", () => {
  const cards = [card({ cardRef: "a" }), card({ cardRef: "b", typeLine: "Creature — Bear" }), card({ cardRef: "c" })];
  const { lands, nonLands } = partitionBattlefield(cards);
  const allRefs = [...lands, ...nonLands].map(c => c.cardRef).sort();
  assert.deepEqual(allRefs, ["a", "b", "c"]);
});
