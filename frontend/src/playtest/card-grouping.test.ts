import assert from "node:assert/strict";
import { it } from "node:test";
import { groupCards } from "./card-grouping.js";
import type { AgentCardObservation } from "./types.js";

function card(overrides: Partial<AgentCardObservation> & { cardRef: string }): AgentCardObservation {
  return {
    name: "Goblin Token", zone: "battlefield", ownerId: "player-1", controllerId: "player-1",
    faceDown: false, hidden: false, tapped: false, summoningSick: false, counters: null,
    power: 1, toughness: 1, typeLine: "Creature — Goblin", token: true,
    ...overrides,
  };
}

it("identical tokens (same name/tapped/sickness/pt/counters/token-status) group into one stack", () => {
  const cards = [card({ cardRef: "t1" }), card({ cardRef: "t2" }), card({ cardRef: "t3" }), card({ cardRef: "t4" })];
  const groups = groupCards(cards);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.count, 4);
  assert.deepEqual(groups[0]!.cardRefs, ["t1", "t2", "t3", "t4"]);
});

it("never merges Forge identities — every cardRef is retained even within one group", () => {
  const cards = [card({ cardRef: "t1" }), card({ cardRef: "t2" })];
  const groups = groupCards(cards);
  assert.deepEqual(new Set(groups[0]!.cardRefs), new Set(["t1", "t2"]));
});

it("tapped state splits a stack: 3 untapped + 1 tapped => two groups", () => {
  const cards = [
    card({ cardRef: "t1", tapped: false }),
    card({ cardRef: "t2", tapped: false }),
    card({ cardRef: "t3", tapped: false }),
    card({ cardRef: "t4", tapped: true }),
  ];
  const groups = groupCards(cards);
  assert.equal(groups.length, 2);
  const untapped = groups.find(g => g.representative.tapped === false)!;
  const tapped = groups.find(g => g.representative.tapped === true)!;
  assert.equal(untapped.count, 3);
  assert.equal(tapped.count, 1);
});

it("a token with a +1/+1 counter is never grouped with ordinary ones", () => {
  const cards = [
    card({ cardRef: "t1", counters: null }),
    card({ cardRef: "t2", counters: null }),
    card({ cardRef: "t3", counters: { "+1/+1": 1 } }),
  ];
  const groups = groupCards(cards);
  assert.equal(groups.length, 2);
  const withCounter = groups.find(g => g.cardRefs.includes("t3"))!;
  assert.equal(withCounter.count, 1);
});

it("summoning sickness differentiates groups even when everything else matches", () => {
  const cards = [card({ cardRef: "t1", summoningSick: true }), card({ cardRef: "t2", summoningSick: false })];
  const groups = groupCards(cards);
  assert.equal(groups.length, 2);
});

it("power/toughness differences (e.g. a pumped creature) split the group", () => {
  const cards = [card({ cardRef: "t1", power: 1, toughness: 1 }), card({ cardRef: "t2", power: 3, toughness: 3 })];
  const groups = groupCards(cards);
  assert.equal(groups.length, 2);
});

it("token vs non-token status is part of the signature, even with an identical name", () => {
  const cards = [card({ cardRef: "t1", token: true }), card({ cardRef: "t2", token: false })];
  const groups = groupCards(cards);
  assert.equal(groups.length, 2);
});

it("lands group the same way — 4 Forest + 2 Mountain + 1 Command Tower", () => {
  const cards = [
    card({ cardRef: "f1", name: "Forest", token: false }),
    card({ cardRef: "f2", name: "Forest", token: false }),
    card({ cardRef: "f3", name: "Forest", token: false }),
    card({ cardRef: "f4", name: "Forest", token: false }),
    card({ cardRef: "m1", name: "Mountain", token: false }),
    card({ cardRef: "m2", name: "Mountain", token: false }),
    card({ cardRef: "c1", name: "Command Tower", token: false }),
  ];
  const groups = groupCards(cards);
  assert.equal(groups.length, 3);
  assert.equal(groups.find(g => g.representative.name === "Forest")!.count, 4);
  assert.equal(groups.find(g => g.representative.name === "Mountain")!.count, 2);
  assert.equal(groups.find(g => g.representative.name === "Command Tower")!.count, 1);
});

it("one tapped land among several splits that land's group: Forest x3 + Forest (tapped) x1", () => {
  const cards = [
    card({ cardRef: "f1", name: "Forest", token: false, tapped: false }),
    card({ cardRef: "f2", name: "Forest", token: false, tapped: false }),
    card({ cardRef: "f3", name: "Forest", token: false, tapped: false }),
    card({ cardRef: "f4", name: "Forest", token: false, tapped: true }),
  ];
  const groups = groupCards(cards);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(g => g.representative.tapped === false)!.count, 3);
  assert.equal(groups.find(g => g.representative.tapped === true)!.count, 1);
});

it("group order follows the position of each group's first member (stable, deterministic)", () => {
  const cards = [
    card({ cardRef: "a1", name: "A" }),
    card({ cardRef: "b1", name: "B" }),
    card({ cardRef: "a2", name: "A" }),
  ];
  const groups = groupCards(cards);
  assert.deepEqual(groups.map(g => g.representative.name), ["A", "B"]);
});

it("calling groupCards again with unchanged input yields the same grouping (stable across re-polling)", () => {
  const cards = [card({ cardRef: "t1" }), card({ cardRef: "t2" }), card({ cardRef: "t3", tapped: true })];
  const first = groupCards(cards);
  const second = groupCards(cards);
  assert.deepEqual(first.map(g => ({ key: g.key, count: g.count, cardRefs: g.cardRefs })), second.map(g => ({ key: g.key, count: g.count, cardRefs: g.cardRefs })));
});

it("an empty zone groups to an empty list", () => {
  assert.deepEqual(groupCards([]), []);
});
