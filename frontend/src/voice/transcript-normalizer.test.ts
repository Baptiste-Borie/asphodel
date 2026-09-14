import assert from "node:assert/strict";
import { it } from "node:test";
import { normalizeTranscript, normalizeWord, splitElision } from "./transcript-normalizer.js";

it("lowercases, strips diacritics and punctuation, keeps apostrophes", () => {
  assert.equal(normalizeWord("Activé!"), "active");
  assert.equal(normalizeWord("K'rrik,"), "k'rrik");
  assert.equal(normalizeWord("Ürborg"), "urborg");
});

it("splits an elided pronoun/article from the word it attaches to", () => {
  assert.deepEqual(splitElision("j'attaque"), ["j", "attaque"]);
  assert.deepEqual(splitElision("l'active"), ["l", "active"]);
  assert.deepEqual(splitElision("qu'il"), ["qu", "il"]);
});

it("never splits a card name that merely happens to contain an apostrophe", () => {
  assert.deepEqual(splitElision("k'rrik"), ["k'rrik"]);
});

it("flags known French/English filler words as ignored, keeps real vocabulary", () => {
  const result = normalizeTranscript("je joue un swamp");
  assert.deepEqual(result.tokens.map((t) => [t.normalized, t.ignored]), [
    ["je", true],
    ["joue", false],
    ["un", true],
    ["swamp", false],
  ]);
});

it("splits elision inline while tokenizing a full transcript", () => {
  const result = normalizeTranscript("j'active Sol Ring");
  assert.deepEqual(result.tokens.map((t) => t.normalized), ["j", "active", "sol", "ring"]);
  assert.equal(result.tokens[0]!.ignored, true);
});

it("preserves the raw transcript verbatim alongside the normalized one", () => {
  const result = normalizeTranscript("  Je Joue Un SWAMP  ");
  assert.equal(result.raw, "Je Joue Un SWAMP");
  assert.equal(result.normalized, "je joue un swamp");
});

it("an empty/blank transcript normalizes to no tokens at all", () => {
  const result = normalizeTranscript("   ");
  assert.deepEqual(result.tokens, []);
  assert.equal(result.normalized, "");
});
