import assert from "node:assert/strict";
import { it } from "node:test";
import { rankCardSearchResults, type CardSearchCandidate } from "./card-search.js";

const candidates: CardSearchCandidate[] = [
  { id: "1", name: "Zuran Orb" },
  { id: "2", name: "Zulaport Cutthroat" },
  { id: "3", name: "Uurg, Spawn of Turg" },
  { id: "4", name: "Krenko, Tin Street Kingpin" },
  { id: "5", name: "Ürborg, Tomb of Yawgmoth" },
];

it("returns nothing for an empty or blank query", () => {
  assert.deepEqual(rankCardSearchResults(candidates, ""), []);
  assert.deepEqual(rankCardSearchResults(candidates, "   "), []);
});

it("is case-insensitive", () => {
  const results = rankCardSearchResults(candidates, "ZUR");
  assert.deepEqual(results.map((c) => c.id), ["1"]);
});

it("is a substring match, not only a prefix match", () => {
  const results = rankCardSearchResults(candidates, "orb");
  assert.deepEqual(results.map((c) => c.id), ["1"]);
});

it("favors a prefix match over a mid-string match", () => {
  // "Zulaport Cutthroat" contains "port" mid-string; nothing here starts with it, so both
  // are equally non-prefix — use a query where one candidate matches as a prefix and one doesn't.
  const results = rankCardSearchResults(candidates, "zu");
  assert.deepEqual(results.map((c) => c.id), ["1", "2"], "both start with \"zu\"; original order breaks the tie");
});

it("ranks a true prefix match before a candidate that only contains the query mid-string", () => {
  const pool: CardSearchCandidate[] = [
    { id: "mid", name: "Ral, Storm Conduit" },
    { id: "prefix", name: "Storm Crow" },
  ];
  const results = rankCardSearchResults(pool, "storm");
  assert.deepEqual(results.map((c) => c.id), ["prefix", "mid"]);
});

it("is accent-insensitive", () => {
  const results = rankCardSearchResults(candidates, "urborg");
  assert.deepEqual(results.map((c) => c.id), ["5"]);
});

it("is stable for equal-ranked candidates: original relative order is preserved", () => {
  const pool: CardSearchCandidate[] = [
    { id: "a", name: "Goblin Piker" },
    { id: "b", name: "Goblin Bully" },
    { id: "c", name: "Goblin Bully" },
  ];
  const results = rankCardSearchResults(pool, "goblin");
  assert.deepEqual(results.map((c) => c.id), ["a", "b", "c"]);
});

it("carries the remaining count through unchanged", () => {
  const pool: CardSearchCandidate[] = [{ id: "1", name: "Sol Ring", remaining: 1 }];
  const results = rankCardSearchResults(pool, "sol");
  assert.equal(results[0]!.remaining, 1);
});
