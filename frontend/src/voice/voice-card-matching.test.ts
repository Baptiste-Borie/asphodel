import assert from "node:assert/strict";
import { it } from "node:test";
import { buildCardNameIndex, matchCardName, significantCardWords, wordSimilarity } from "./voice-card-matching.js";
import { fakeCard, fakeObservation } from "./voice-test-fixtures.js";

it("exact match: a card's own significant word appears verbatim among the meaningful tokens", () => {
  const result = matchCardName("Kokusho, the Renegade Ninja", ["cible", "kokusho"], "je cible kokusho");
  assert.equal(result.level, "exact");
  assert.equal(result.matchedTokenIndex, 1);
});

it("exact match tolerates a dropped apostrophe (a common STT deformation)", () => {
  const result = matchCardName("K'rrik, Head Rats", ["caste", "krrik"], "je caste krrik");
  assert.equal(result.level, "exact");
});

it("whole multi-word name spoken as separate tokens matches exactly via the flattened transcript", () => {
  const result = matchCardName("Sol Ring", ["active", "sol", "ring"], "active sol ring");
  assert.equal(result.level, "exact");
});

it("conservative fuzzy match recovers a small STT deformation on a long enough word", () => {
  const result = matchCardName("Kokusho, the Renegade Ninja", ["cible", "kokushu"], "je cible kokushu");
  assert.equal(result.level, "fuzzy");
});

it("never fuzzy-matches a genuinely unrelated short word", () => {
  const result = matchCardName("K'rrik, Head Rats", ["casse", "cric"], "je casse cric");
  assert.equal(result.level, "none");
});

it("never fuzzy-matches on a very short (<4 char) card word even when close", () => {
  const solOnly = matchCardName("Sol", ["sel"], "je pose sel");
  assert.equal(solOnly.level, "none");
});

it("significantCardWords drops connective stopwords but keeps the real distinctive words", () => {
  assert.deepEqual(significantCardWords("Uurg, Spawn of Turg"), ["uurg", "spawn", "turg"]);
});

it("wordSimilarity is 1 for identical words and 0 for completely disjoint ones", () => {
  assert.equal(wordSimilarity("krrik", "krrik"), 1);
  assert.equal(wordSimilarity("krrik", "zzzzz"), 0);
});

it("buildCardNameIndex only includes visible cards, never a hidden one", () => {
  const observation = fakeObservation({
    selfBattlefield: [fakeCard("c1", "Swamp"), fakeCard("c2", "Hidden", { hidden: true, name: null })],
  });
  const index = buildCardNameIndex(observation);
  assert.equal(index.get("c1"), "Swamp");
  assert.equal(index.has("c2"), false);
});
