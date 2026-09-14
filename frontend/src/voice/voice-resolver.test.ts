import assert from "node:assert/strict";
import { it } from "node:test";
import { resolveVoiceTranscript } from "./voice-resolver.js";
import { DEFAULT_LEXICON, mergeLexicon } from "./voice-lexicon.js";
import type { LexiconEntry } from "./voice-types.js";
import { fakeCard, fakeMenuItem, fakeObservation, fakePendingMenu, fakePendingValue } from "./voice-test-fixtures.js";

it('"je joue un swamp" / "je pose un swamp" / "je vais mettre un swamp" all resolve to Play Swamp with high confidence', () => {
  const pending = fakePendingMenu("priority_action", [
    fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null }),
    fakeMenuItem("Play Swamp", "play-1", { cardRef: "c-swamp" }),
  ]);
  const observation = fakeObservation({ selfHand: [fakeCard("c-swamp", "Swamp")] });
  for (const phrase of ["je joue un swamp", "je pose un swamp", "je vais mettre un swamp"]) {
    const result = resolveVoiceTranscript(phrase, pending, observation, DEFAULT_LEXICON);
    assert.equal(result.resolution.kind, "resolved", `expected "${phrase}" to resolve`);
    if (result.resolution.kind === "resolved") assert.equal(result.resolution.choice.choice, "play-1");
  }
});

it('an unknown semantic term ("lande") never blocks resolution when the card alone is unambiguous, and produces a dictionary proposal', () => {
  const pending = fakePendingMenu("priority_action", [
    fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null }),
    fakeMenuItem("Play Swamp", "play-1", { cardRef: "c-swamp" }),
  ]);
  const observation = fakeObservation({ selfHand: [fakeCard("c-swamp", "Swamp")] });
  const result = resolveVoiceTranscript("je lande un swamp", pending, observation, DEFAULT_LEXICON);
  assert.equal(result.resolution.kind, "resolved");
  assert.deepEqual(result.unknownTerms, ["lande"]);
  assert.deepEqual(result.dictionaryProposal, { term: "lande", intent: "play", context: "priority_action" });
});

it("card-name fuzzy matching resolves through voice-resolver end to end", () => {
  const pending = fakePendingMenu("target_selection", [fakeMenuItem("Target Kokusho, the Renegade Ninja", "t1", { cardRef: "c-kokusho" })]);
  const observation = fakeObservation({ opponentBattlefield: [fakeCard("c-kokusho", "Kokusho, the Renegade Ninja")] });
  const result = resolveVoiceTranscript("je cible kokushu", pending, observation, DEFAULT_LEXICON);
  assert.equal(result.resolution.kind, "resolved");
});

it("two equally plausible fuzzy card matches resolve as ambiguous, never a silent pick", () => {
  const pending = fakePendingMenu("target_selection", [
    fakeMenuItem("Target Kiora, Test Card", "t1", { cardRef: "c-kiora" }),
    fakeMenuItem("Target Kioro, Test Card", "t2", { cardRef: "c-kioro" }),
  ]);
  const observation = fakeObservation({
    opponentBattlefield: [fakeCard("c-kiora", "Kiora, Test Card"), fakeCard("c-kioro", "Kioro, Test Card")],
  });
  const result = resolveVoiceTranscript("je cible kioru", pending, observation, DEFAULT_LEXICON);
  assert.equal(result.resolution.kind, "ambiguous");
  if (result.resolution.kind === "ambiguous") assert.equal(result.resolution.candidates.length, 2);
});

it("an irrelevant/unknown sentence resolves as unrecognized and does nothing", () => {
  const pending = fakePendingMenu("priority_action", [
    fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null }),
    fakeMenuItem("Play Swamp", "play-1", { cardRef: "c-swamp" }),
  ]);
  const result = resolveVoiceTranscript("quel temps fait il aujourd'hui", pending, fakeObservation(), DEFAULT_LEXICON);
  assert.equal(result.resolution.kind, "unrecognized");
});

it('"je passe" and "oui"/"non" resolve with high confidence', () => {
  const passPending = fakePendingMenu("priority_action", [fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null })]);
  assert.equal(resolveVoiceTranscript("je passe", passPending, null, DEFAULT_LEXICON).resolution.kind, "resolved");

  const yesNoPending = fakePendingMenu("yes_no", [fakeMenuItem("Yes", "y"), fakeMenuItem("No", "n")]);
  const yes = resolveVoiceTranscript("oui", yesNoPending, null, DEFAULT_LEXICON);
  assert.equal(yes.resolution.kind, "resolved");
  if (yes.resolution.kind === "resolved") assert.equal(yes.resolution.choice.choice, "y");
});

it('a numeric value ("valeur quatre") resolves directly when in range', () => {
  const pending = fakePendingValue(0, 10);
  const result = resolveVoiceTranscript("valeur quatre", pending, null, DEFAULT_LEXICON);
  assert.equal(result.resolution.kind, "resolved");
  if (result.resolution.kind === "resolved") assert.equal(result.resolution.choice.choice, 4);
});

it("the same wording changes resolution depending only on the current decision's legal choices", () => {
  const observation = fakeObservation({ selfBattlefield: [fakeCard("c-krrik", "K'rrik, Head Rats")] });
  const attackers = fakePendingMenu("attackers_selection", [
    fakeMenuItem("Add K'rrik attacking Asphodel", "o1", { cardRef: "c-krrik" }),
    fakeMenuItem("Finish declaring attackers/blockers", "o2"),
  ]);
  const targets = fakePendingMenu("target_selection", [fakeMenuItem("Target K'rrik, Head Rats", "t1", { cardRef: "c-krrik" })]);

  const attackResult = resolveVoiceTranscript("k'rrik", attackers, observation, DEFAULT_LEXICON);
  const targetResult = resolveVoiceTranscript("k'rrik", targets, observation, DEFAULT_LEXICON);
  assert.equal(attackResult.resolution.kind, "resolved");
  assert.equal(targetResult.resolution.kind, "resolved");
  if (attackResult.resolution.kind === "resolved" && targetResult.resolution.kind === "resolved") {
    assert.equal(attackResult.resolution.choice.choice, "o1");
    assert.equal(targetResult.resolution.choice.choice, "t1");
  }
});

it("unknown vocabulary NEVER mutates the lexicon by itself, no matter how many times it's heard", () => {
  const pending = fakePendingMenu("priority_action", [
    fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null }),
    fakeMenuItem("Play Swamp", "play-1", { cardRef: "c-swamp" }),
  ]);
  const observation = fakeObservation({ selfHand: [fakeCard("c-swamp", "Swamp")] });
  const before = DEFAULT_LEXICON.length;
  for (let i = 0; i < 5; i++) resolveVoiceTranscript("je lande un swamp", pending, observation, DEFAULT_LEXICON);
  assert.equal(DEFAULT_LEXICON.length, before);
});

it('a contextual (approved) association affects ONLY the context it was approved for', () => {
  const approved: LexiconEntry[] = [{ term: "envoie", intent: "attack", contexts: ["attackers_selection"], origin: "approved" }];
  const lexicon = mergeLexicon(DEFAULT_LEXICON, approved);
  const observation = fakeObservation({ selfBattlefield: [fakeCard("c-kokusho", "Kokusho, the Renegade Ninja")] });

  const attackers = fakePendingMenu("attackers_selection", [
    fakeMenuItem("Add Kokusho attacking Asphodel", "o1", { cardRef: "c-kokusho" }),
    fakeMenuItem("Finish declaring attackers/blockers", "o2"),
  ]);
  const attackResult = resolveVoiceTranscript("envoie kokusho", attackers, observation, lexicon);
  assert.equal(attackResult.resolution.kind, "resolved");

  // The exact same word, spoken during a decision it was never approved for, must not silently
  // behave as "attack" there — with no other signal, "envoie" alone must not clear the bar.
  const priorityOnlyEnvoie = fakePendingMenu("priority_action", [
    fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null }),
  ]);
  const priorityResult = resolveVoiceTranscript("envoie", priorityOnlyEnvoie, null, lexicon);
  assert.equal(priorityResult.resolution.kind, "unrecognized");
});

it("a compound attack instruction naming two different creatures resolves as an ordered plan", () => {
  const observation = fakeObservation({
    selfBattlefield: [fakeCard("c-krrik", "K'rrik, Head Rats"), fakeCard("c-vilis", "Vilis, Broker of Blood")],
  });
  const pending = fakePendingMenu("attackers_selection", [
    fakeMenuItem("Add K'rrik attacking Asphodel", "o1", { cardRef: "c-krrik" }),
    fakeMenuItem("Add Vilis, Broker of Blood attacking Asphodel", "o2", { cardRef: "c-vilis" }),
    fakeMenuItem("Finish declaring attackers/blockers", "o3"),
  ]);
  const result = resolveVoiceTranscript("j'attaque avec k'rrik et vilis", pending, observation, DEFAULT_LEXICON);
  assert.equal(result.resolution.kind, "plan");
  if (result.resolution.kind === "plan") {
    assert.equal(result.resolution.steps.length, 2);
    assert.deepEqual(result.resolution.steps.map((s) => s.choice.choice), ["o1", "o2"]);
  }
});

it("declaring a single attacker never triggers plan detection — it's a normal high-confidence single resolution", () => {
  const observation = fakeObservation({ selfBattlefield: [fakeCard("c-krrik", "K'rrik, Head Rats")] });
  const pending = fakePendingMenu("attackers_selection", [
    fakeMenuItem("Add K'rrik attacking Asphodel", "o1", { cardRef: "c-krrik" }),
    fakeMenuItem("Finish declaring attackers/blockers", "o2"),
  ]);
  const result = resolveVoiceTranscript("j'attaque avec k'rrik", pending, observation, DEFAULT_LEXICON);
  assert.equal(result.resolution.kind, "resolved");
});
