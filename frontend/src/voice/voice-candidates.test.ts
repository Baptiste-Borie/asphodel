import assert from "node:assert/strict";
import { it } from "node:test";
import { classifyMenuItem, computeUnknownTerms, generateCandidates, parseSpokenNumber } from "./voice-candidates.js";
import { normalizeTranscript } from "./transcript-normalizer.js";
import { DEFAULT_LEXICON } from "./voice-lexicon.js";
import { fakeCard, fakeMenuItem, fakeObservation, fakePendingMenu, fakePendingValue } from "./voice-test-fixtures.js";

it("classifies priority_action items from their deterministic label prefix", () => {
  assert.equal(classifyMenuItem("priority_action", fakeMenuItem("Play Swamp", "a1")), "play_land");
  assert.equal(classifyMenuItem("priority_action", fakeMenuItem("Cast K'rrik, Head Rats [1BBG]", "a2")), "cast_spell");
  assert.equal(classifyMenuItem("priority_action", fakeMenuItem("Activate Sol Ring", "a3")), "activate_ability");
  assert.equal(classifyMenuItem("priority_action", fakeMenuItem("Pass priority", "a4", { control: "pass" })), "pass");
});

it("classifies combat items as add/remove/finish", () => {
  assert.equal(classifyMenuItem("attackers_selection", fakeMenuItem("Add K'rrik attacking Asphodel", "o1")), "attack_add");
  assert.equal(classifyMenuItem("attackers_selection", fakeMenuItem("Finish declaring attackers/blockers", "o2")), "finish");
  assert.equal(classifyMenuItem("blockers_selection", fakeMenuItem("Add Kokusho blocking K'rrik", "o3")), "block_add");
});

it("parseSpokenNumber understands digits, French and English number words, and nothing else", () => {
  assert.equal(parseSpokenNumber("4"), 4);
  assert.equal(parseSpokenNumber("quatre"), 4);
  assert.equal(parseSpokenNumber("four"), 4);
  assert.equal(parseSpokenNumber("swamp"), null);
});

it('"je joue un swamp" resolves Play Swamp with no other candidate above zero', () => {
  const pending = fakePendingMenu("priority_action", [
    fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null }),
    fakeMenuItem("Play Swamp", "play-1", { cardRef: "c-swamp" }),
  ]);
  const observation = fakeObservation({ selfHand: [fakeCard("c-swamp", "Swamp")] });
  const transcript = normalizeTranscript("je joue un swamp");
  const candidates = generateCandidates(pending, observation, transcript, DEFAULT_LEXICON);
  assert.equal(candidates[0]!.choice.choice, "play-1");
  assert.equal(candidates.length, 1, "Pass priority never matches anything in this transcript");
});

it('the SAME verb ("joue") resolves to a DIFFERENT action type depending only on the referenced card', () => {
  const pending = fakePendingMenu("priority_action", [
    fakeMenuItem("Play Swamp", "play-1", { cardRef: "c-swamp" }),
    fakeMenuItem("Cast K'rrik, Head Rats [1BBG]", "cast-1", { cardRef: "c-krrik" }),
  ]);
  const observation = fakeObservation({ selfHand: [fakeCard("c-swamp", "Swamp"), fakeCard("c-krrik", "K'rrik, Head Rats")] });
  const lexicon = DEFAULT_LEXICON;

  const playResolved = generateCandidates(pending, observation, normalizeTranscript("je joue un swamp"), lexicon);
  assert.equal(playResolved[0]!.choice.choice, "play-1");

  const castResolved = generateCandidates(pending, observation, normalizeTranscript("je joue k'rrik"), lexicon);
  assert.equal(castResolved[0]!.choice.choice, "cast-1");
});

it("fuzzy card-name matching still resolves a slightly deformed name", () => {
  const pending = fakePendingMenu("target_selection", [
    fakeMenuItem("Target Kokusho, the Renegade Ninja", "t1", { cardRef: "c-kokusho" }),
  ]);
  const observation = fakeObservation({ opponentBattlefield: [fakeCard("c-kokusho", "Kokusho, the Renegade Ninja")] });
  const candidates = generateCandidates(pending, observation, normalizeTranscript("je cible kokushu"), DEFAULT_LEXICON);
  assert.equal(candidates[0]!.choice.choice, "t1");
});

it("two legal cards equally close to a fuzzy-matched word both remain plausible candidates", () => {
  // Fabricated near-duplicate names, purely to force two EQUALLY-close fuzzy matches ("kioru" is one
  // substitution away from both "kiora" and "kioro").
  const pending = fakePendingMenu("target_selection", [
    fakeMenuItem("Target Kiora, Test Card", "t1", { cardRef: "c-kiora" }),
    fakeMenuItem("Target Kioro, Test Card", "t2", { cardRef: "c-kioro" }),
  ]);
  const observation = fakeObservation({
    opponentBattlefield: [fakeCard("c-kiora", "Kiora, Test Card"), fakeCard("c-kioro", "Kioro, Test Card")],
  });
  const candidates = generateCandidates(pending, observation, normalizeTranscript("je cible kioru"), DEFAULT_LEXICON);
  // Whichever module resolves the FINAL choice (voice-resolver.test.ts) is where a genuine tie must
  // turn into "ambiguous" rather than a silent pick — this module's job is only to never filter one
  // out pre-emptively when both are legitimately equally close.
  const positive = candidates.filter((c) => c.score > 0);
  assert.equal(positive.length, 2);
  assert.equal(positive[0]!.score, positive[1]!.score);
});

it("an irrelevant sentence with no legal-vocabulary overlap produces no positive candidate", () => {
  const pending = fakePendingMenu("priority_action", [
    fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null }),
    fakeMenuItem("Play Swamp", "play-1", { cardRef: "c-swamp" }),
  ]);
  const observation = fakeObservation({ selfHand: [fakeCard("c-swamp", "Swamp")] });
  const candidates = generateCandidates(pending, observation, normalizeTranscript("quel temps fait il aujourd'hui"), DEFAULT_LEXICON);
  assert.equal(candidates.length, 0);
});

it('"je passe" resolves the pass action', () => {
  const pending = fakePendingMenu("priority_action", [
    fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null }),
    fakeMenuItem("Play Swamp", "play-1", { cardRef: "c-swamp" }),
  ]);
  const candidates = generateCandidates(pending, null, normalizeTranscript("je passe"), DEFAULT_LEXICON);
  assert.equal(candidates[0]!.choice.choice, "pass");
});

it('"oui"/"non" resolve a yes_no decision', () => {
  const pending = fakePendingMenu("yes_no", [fakeMenuItem("Yes", "y"), fakeMenuItem("No", "n")]);
  assert.equal(generateCandidates(pending, null, normalizeTranscript("oui"), DEFAULT_LEXICON)[0]!.choice.choice, "y");
  assert.equal(generateCandidates(pending, null, normalizeTranscript("non"), DEFAULT_LEXICON)[0]!.choice.choice, "n");
});

it('a numeric value ("valeur quatre") resolves within the legal range and never outside it', () => {
  const pending = fakePendingValue(0, 3);
  const transcript = normalizeTranscript("valeur quatre");
  const candidates = generateCandidates(pending, null, transcript, DEFAULT_LEXICON);
  assert.equal(candidates.length, 0, "4 is outside [0,3] and must never be manufactured as a choice");

  const inRange = fakePendingValue(0, 10);
  const inRangeCandidates = generateCandidates(inRange, null, transcript, DEFAULT_LEXICON);
  assert.equal(inRangeCandidates[0]!.choice.kind, "value");
  assert.equal((inRangeCandidates[0]!.choice as { choice: number }).choice, 4);
});

it("changing the current decision's legal choices changes which candidate ranks first, for the exact same transcript", () => {
  const attackers = fakePendingMenu("attackers_selection", [
    fakeMenuItem("Add K'rrik attacking Asphodel", "o1", { cardRef: "c-krrik" }),
    fakeMenuItem("Finish declaring attackers/blockers", "o2"),
  ]);
  const targets = fakePendingMenu("target_selection", [
    fakeMenuItem("Target K'rrik, Head Rats", "t1", { cardRef: "c-krrik" }),
  ]);
  const observation = fakeObservation({ selfBattlefield: [fakeCard("c-krrik", "K'rrik, Head Rats")] });
  const transcript = normalizeTranscript("k'rrik");

  const attackCandidates = generateCandidates(attackers, observation, transcript, DEFAULT_LEXICON);
  assert.equal(attackCandidates[0]!.category, "attack_add");

  const targetCandidates = generateCandidates(targets, observation, transcript, DEFAULT_LEXICON);
  assert.equal(targetCandidates[0]!.category, "target");
});

it("computeUnknownTerms tells ignored filler, known vocabulary, recognized entities and genuinely unknown words apart", () => {
  const observation = fakeObservation({ selfHand: [fakeCard("c-swamp", "Swamp")] });
  const unknown = computeUnknownTerms(normalizeTranscript("je lande un swamp"), DEFAULT_LEXICON, observation);
  assert.deepEqual(unknown, ["lande"]);
});

it("a recognized card name is never reported as an unknown term even when it isn't a legal choice right now", () => {
  const observation = fakeObservation({ opponentBattlefield: [fakeCard("c-kokusho", "Kokusho, the Renegade Ninja")] });
  const unknown = computeUnknownTerms(normalizeTranscript("je cible kokusho"), DEFAULT_LEXICON, observation);
  assert.deepEqual(unknown, []);
});
