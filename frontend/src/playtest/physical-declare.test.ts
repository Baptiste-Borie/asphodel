import assert from "node:assert/strict";
import { it } from "node:test";
import { isDeclareReadyToConfirm, remainingDeclareCandidates, toCardSearchCandidates } from "./physical-declare.js";
import type { PhysicalDeclareCandidate } from "./types.js";

const candidates: PhysicalDeclareCandidate[] = [
  { name: "Forest", remaining: 3 },
  { name: "Sol Ring", remaining: 1 },
];

it("decrements a candidate's remaining count by how many times it's already been picked this round", () => {
  const result = remainingDeclareCandidates(candidates, ["Forest", "Forest"]);
  assert.deepEqual(result, [{ name: "Forest", remaining: 1 }, { name: "Sol Ring", remaining: 1 }]);
});

it("drops a candidate entirely once its remaining count hits 0 — it can no longer be selected", () => {
  const result = remainingDeclareCandidates(candidates, ["Sol Ring"]);
  assert.deepEqual(result, [{ name: "Forest", remaining: 3 }]);
});

it("drops a candidate picked exactly as many times as its full remaining count (3 of 3 Forests)", () => {
  const result = remainingDeclareCandidates(candidates, ["Forest", "Forest", "Forest"]);
  assert.deepEqual(result, [{ name: "Sol Ring", remaining: 1 }]);
});

it("never mutates the input candidates array", () => {
  const before = JSON.stringify(candidates);
  remainingDeclareCandidates(candidates, ["Forest"]);
  assert.equal(JSON.stringify(candidates), before);
});

it("a name never picked passes through with its original remaining count", () => {
  const result = remainingDeclareCandidates(candidates, []);
  assert.deepEqual(result, candidates);
});

it("requires exactly `count` picks before confirming — not fewer, not more", () => {
  assert.equal(isDeclareReadyToConfirm([], 7), false);
  assert.equal(isDeclareReadyToConfirm(["Forest"], 7), false);
  assert.equal(isDeclareReadyToConfirm(Array(7).fill("Forest"), 7), true);
  assert.equal(isDeclareReadyToConfirm(["Forest"], 1), true);
});

it("reshapes candidates for card-search.ts, using the name as the id (declare candidates have no separate stable id)", () => {
  const result = toCardSearchCandidates(candidates);
  assert.deepEqual(result, [
    { id: "Forest", name: "Forest", remaining: 3 },
    { id: "Sol Ring", name: "Sol Ring", remaining: 1 },
  ]);
});
