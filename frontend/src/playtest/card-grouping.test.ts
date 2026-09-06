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

/*
 * V2e.6 §9 regression investigation: real playtest feedback claimed identical Goblin tokens from a
 * Krenko attack did not appear stacked. Reproduced against a REAL running game (V2e.5's own smoke
 * test) — two real tokens Krenko's attack trigger created reported this EXACT shape:
 *   { name: "Goblin Token", cardRef: "card-204"/"card-205", tapped: false, summoningSick: true,
 *     power: 1, toughness: 1, token: true }
 * i.e. genuinely equivalent visible state, distinct cardRefs. Locking that in here verbatim: this
 * grouping logic was NOT the bug (see docs for the actual finding — the reported issue was almost
 * certainly two tokens created on DIFFERENT turns, which legitimately differ in summoningSick and
 * therefore correctly do NOT group; that is proven directly below too).
 */
it("V2e.6 §9 regression: two real Krenko-created Goblin tokens (exact captured shape) group into ×2", () => {
  const cards = [
    card({ cardRef: "card-204", name: "Goblin Token", tapped: false, summoningSick: true, power: 1, toughness: 1, token: true }),
    card({ cardRef: "card-205", name: "Goblin Token", tapped: false, summoningSick: true, power: 1, toughness: 1, token: true }),
  ];
  const groups = groupCards(cards);
  assert.equal(groups.length, 1, "genuinely equivalent tokens must group");
  assert.equal(groups[0]!.count, 2);
  assert.deepEqual(groups[0]!.cardRefs, ["card-204", "card-205"]);
});

it("V2e.6 §9: a token made on an EARLIER turn (no longer summoning sick) correctly does NOT group with a freshly-made one — this is real state, not a bug", () => {
  const cards = [
    card({ cardRef: "card-100", name: "Goblin Token", tapped: false, summoningSick: false, power: 1, toughness: 1, token: true }), // made last turn
    card({ cardRef: "card-204", name: "Goblin Token", tapped: false, summoningSick: true, power: 1, toughness: 1, token: true }), // made this turn
  ];
  const groups = groupCards(cards);
  assert.equal(groups.length, 2, "a genuine visible-state difference must never be hidden inside one stack");
});

it("V2e.6 §9: a countered token never groups with an uncountered one of the same name", () => {
  const cards = [
    card({ cardRef: "card-1", name: "Goblin Token", counters: null }),
    card({ cardRef: "card-2", name: "Goblin Token", counters: { "+1/+1": 1 } }),
  ];
  const groups = groupCards(cards);
  assert.equal(groups.length, 2);
});
