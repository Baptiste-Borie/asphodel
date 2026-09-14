import assert from "node:assert/strict";
import { it } from "node:test";
import { DEFAULT_LEXICON, isKnownTerm, lookupTerm, mergeLexicon } from "./voice-lexicon.js";
import type { LexiconEntry } from "./voice-types.js";

it("a global entry (contexts: null) matches in every decision context", () => {
  const matches = lookupTerm(DEFAULT_LEXICON, "attaque", "priority_action");
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.entry.intent, "attack");
  assert.equal(matches[0]!.contextual, false);
});

it("a context-restricted default entry only matches in its own context", () => {
  assert.equal(lookupTerm(DEFAULT_LEXICON, "envoie", "attackers_selection").length, 1);
  assert.equal(lookupTerm(DEFAULT_LEXICON, "envoie", "priority_action").length, 0);
});

it("mergeLexicon combines the default vocabulary with approved additions without dropping either", () => {
  const approved: LexiconEntry[] = [{ term: "lande", intent: "play", contexts: ["priority_action"], origin: "approved" }];
  const merged = mergeLexicon(DEFAULT_LEXICON, approved);
  assert.equal(merged.length, DEFAULT_LEXICON.length + 1);
  assert.equal(lookupTerm(merged, "lande", "priority_action").length, 1);
  assert.equal(lookupTerm(merged, "attaque", "priority_action").length, 1);
});

it("isKnownTerm is true for a term valid in ANY context, even one that doesn't apply right now", () => {
  assert.equal(isKnownTerm(DEFAULT_LEXICON, "envoie"), true);
  assert.equal(isKnownTerm(DEFAULT_LEXICON, "zorblax"), false);
});
