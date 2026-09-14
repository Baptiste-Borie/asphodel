import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryVoiceVocabularyStorage, loadApprovedVocabulary, saveApprovedVocabulary } from "./voice-vocabulary-store.js";
import type { LexiconEntry } from "./voice-types.js";

it("loading from empty storage returns no approved vocabulary at all", () => {
  const storage = createMemoryVoiceVocabularyStorage();
  assert.deepEqual(loadApprovedVocabulary(storage), []);
});

it("an approved entry saved to storage loads back correctly, tagged as approved", () => {
  const storage = createMemoryVoiceVocabularyStorage();
  const entries: LexiconEntry[] = [{ term: "lande", intent: "play", contexts: ["priority_action"], origin: "approved" }];
  saveApprovedVocabulary(storage, entries);
  const loaded = loadApprovedVocabulary(storage);
  assert.deepEqual(loaded, entries);
});

it("a global (contexts: null) approved entry round-trips correctly", () => {
  const storage = createMemoryVoiceVocabularyStorage();
  const entries: LexiconEntry[] = [{ term: "attaque", intent: "attack", contexts: null, origin: "approved" }];
  saveApprovedVocabulary(storage, entries);
  assert.deepEqual(loadApprovedVocabulary(storage), entries);
});

it("corrupt/foreign JSON in storage never throws — treated as no approved vocabulary", () => {
  const storage = createMemoryVoiceVocabularyStorage();
  storage.setItem("asphodel.voice.approvedVocabulary.v1", "{not json");
  assert.deepEqual(loadApprovedVocabulary(storage), []);
  storage.setItem("asphodel.voice.approvedVocabulary.v1", JSON.stringify({ version: 999, entries: [] }));
  assert.deepEqual(loadApprovedVocabulary(storage), [], "an unrecognized future version is never guessed at");
});

it("two independent storages never see each other's writes", () => {
  const a = createMemoryVoiceVocabularyStorage();
  const b = createMemoryVoiceVocabularyStorage();
  saveApprovedVocabulary(a, [{ term: "lande", intent: "play", contexts: null, origin: "approved" }]);
  assert.deepEqual(loadApprovedVocabulary(b), []);
});
