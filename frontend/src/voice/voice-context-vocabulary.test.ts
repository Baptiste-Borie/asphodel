import assert from "node:assert/strict";
import { it } from "node:test";
import { buildContextualVocabulary, MAX_CONTEXTUAL_VOCABULARY_TERMS } from "./voice-context-vocabulary.js";
import { fakeCard, fakeCommander, fakeMenuItem, fakeObservation, fakePendingMenu, fakeStackItem } from "./voice-test-fixtures.js";

it("returns an empty list when there is neither a pending decision nor an observation", () => {
  assert.deepEqual(buildContextualVocabulary(null, null), []);
});

it("prioritizes card names referenced by the CURRENT legal choices over everything else", () => {
  const pending = fakePendingMenu("priority_action", [fakeMenuItem("Cast K'rrik, Son of Yawgmoth", "o1", { cardRef: "c-krrik", presentationName: "K'rrik, Son of Yawgmoth" })]);
  const observation = fakeObservation({ selfBattlefield: [fakeCard("c-swamp", "Swamp")] });
  const vocabulary = buildContextualVocabulary(pending, observation);
  assert.equal(vocabulary[0], "K'rrik, Son of Yawgmoth");
  assert.ok(vocabulary.includes("Swamp"));
});

it("includes cards from the human's own hand", () => {
  const observation = fakeObservation({ selfHand: [fakeCard("c-sol-ring", "Sol Ring", { zone: "hand" })] });
  assert.deepEqual(buildContextualVocabulary(null, observation), ["Sol Ring"]);
});

it("never includes a hidden card, from the hand or anywhere else", () => {
  const observation = fakeObservation({ selfHand: [fakeCard("c-hidden", "Some Secret Card", { zone: "hand", hidden: true })] });
  assert.deepEqual(buildContextualVocabulary(null, observation), []);
});

it("includes permanents visible on ANY battlefield, not just the human's own", () => {
  const observation = fakeObservation({
    selfBattlefield: [fakeCard("c-mind-stone", "Mind Stone")],
    opponentBattlefield: [fakeCard("c-kokusho", "Kokusho, the Renegade Ninja")],
  });
  const vocabulary = buildContextualVocabulary(null, observation);
  assert.ok(vocabulary.includes("Mind Stone"));
  assert.ok(vocabulary.includes("Kokusho, the Renegade Ninja"));
});

it("includes commanders and command-zone cards", () => {
  const observation = fakeObservation({ selfCommanders: [fakeCommander("c-vilis", "Vilis, Broker of Blood")] });
  assert.deepEqual(buildContextualVocabulary(null, observation), ["Vilis, Broker of Blood"]);
});

it("includes cards currently on the stack", () => {
  const observation = fakeObservation({ stack: [fakeStackItem("s1", "Kokusho, the Renegade Ninja")] });
  assert.deepEqual(buildContextualVocabulary(null, observation), ["Kokusho, the Renegade Ninja"]);
});

it("never includes a hidden stack item's source name", () => {
  const observation = fakeObservation({ stack: [fakeStackItem("s1", "Some Secret Spell", { hidden: true })] });
  assert.deepEqual(buildContextualVocabulary(null, observation), []);
});

it("deduplicates a card seen through multiple sources (e.g. a legal choice AND a battlefield permanent) — never repeated in the prompt", () => {
  const pending = fakePendingMenu("priority_action", [fakeMenuItem("Activate Sol Ring", "o1", { cardRef: "c-sol-ring" })]);
  const observation = fakeObservation({ selfBattlefield: [fakeCard("c-sol-ring", "Sol Ring")] });
  const vocabulary = buildContextualVocabulary(pending, observation);
  assert.deepEqual(vocabulary, ["Sol Ring"]);
});

it("caps the result at MAX_CONTEXTUAL_VOCABULARY_TERMS, keeping the highest-priority names", () => {
  const battlefield = Array.from({ length: MAX_CONTEXTUAL_VOCABULARY_TERMS + 5 }, (_, i) => fakeCard(`c-${i}`, `Card ${i}`));
  const observation = fakeObservation({ selfBattlefield: battlefield });
  const vocabulary = buildContextualVocabulary(null, observation);
  assert.equal(vocabulary.length, MAX_CONTEXTUAL_VOCABULARY_TERMS);
  assert.deepEqual(vocabulary, battlefield.slice(0, MAX_CONTEXTUAL_VOCABULARY_TERMS).map((c) => c.name));
});

it("produces a stable, deterministic ordering for the same input — never re-sorted between calls", () => {
  const pending = fakePendingMenu("priority_action", [fakeMenuItem("Cast K'rrik", "o1", { cardRef: "c-krrik", presentationName: "K'rrik, Son of Yawgmoth" })]);
  const observation = fakeObservation({ selfBattlefield: [fakeCard("c-vilis", "Vilis, Broker of Blood")], selfHand: [fakeCard("c-mind-stone", "Mind Stone", { zone: "hand" })] });
  const first = buildContextualVocabulary(pending, observation);
  const second = buildContextualVocabulary(pending, observation);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["K'rrik, Son of Yawgmoth", "Mind Stone", "Vilis, Broker of Blood"]);
});

it("respects a custom maxTerms override", () => {
  const observation = fakeObservation({ selfBattlefield: [fakeCard("c-1", "Card One"), fakeCard("c-2", "Card Two")] });
  assert.deepEqual(buildContextualVocabulary(null, observation, 1), ["Card One"]);
});
