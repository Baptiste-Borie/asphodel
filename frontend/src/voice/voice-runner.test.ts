import assert from "node:assert/strict";
import { it } from "node:test";
import { VoiceRunner } from "./voice-runner.js";
import { createMemoryVoiceVocabularyStorage, type VoiceVocabularyStorage } from "./voice-vocabulary-store.js";
import { fakeCard, fakeMenuItem, fakeObservation, fakePendingMenu } from "./voice-test-fixtures.js";
import type { AgentChoice, AgentObservation, VoicePendingDecision } from "./voice-types.js";

function makeRunner(overrides: { pending?: VoicePendingDecision | null; observation?: AgentObservation | null; canAct?: boolean; storage?: VoiceVocabularyStorage } = {}) {
  const state = { pending: overrides.pending ?? null, observation: overrides.observation ?? null, canAct: overrides.canAct ?? true };
  const submitted: AgentChoice[] = [];
  const storage = overrides.storage ?? createMemoryVoiceVocabularyStorage();
  const runner = new VoiceRunner({
    getPendingDecision: () => state.pending,
    getObservation: () => state.observation,
    canAct: () => state.canAct,
    submit: (choice) => submitted.push(choice),
    storage,
  });
  return { runner, state, submitted, storage };
}

it("interpret() returns null when there is no pending decision to interpret against", () => {
  const { runner } = makeRunner({ pending: null });
  assert.equal(runner.interpret("je passe"), null);
});

it("execute() never submits anything while canAct() is false — e.g. frame playback active or another submission in flight", () => {
  const pending = fakePendingMenu("priority_action", [fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null })]);
  const { runner, state, submitted } = makeRunner({ pending, canAct: false });
  const result = runner.interpret("je passe")!;
  runner.execute(result.resolution);
  assert.equal(submitted.length, 0);
  state.canAct = true;
  runner.execute(result.resolution);
  assert.equal(submitted.length, 1);
});

it("execute() always submits through the injected submit callback — the host's own protected submitChoice(), never a second path", () => {
  const pending = fakePendingMenu("priority_action", [fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null })]);
  const { runner, submitted } = makeRunner({ pending });
  const result = runner.interpret("je passe")!;
  runner.execute(result.resolution);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]!.choice, "pass");
});

function attackPlanDecision(decisionId: string, items: Array<["krrik" | "vilis" | "finish", string]>) {
  const byKey = {
    krrik: fakeMenuItem("Add K'rrik attacking Asphodel", "o-krrik", { cardRef: "c-krrik" }),
    vilis: fakeMenuItem("Add Vilis, Broker of Blood attacking Asphodel", "o-vilis", { cardRef: "c-vilis" }),
    finish: fakeMenuItem("Finish declaring attackers/blockers", "o-finish"),
  };
  const built = items.map(([key, choiceId]) => ({ ...byKey[key], choice: { ...byKey[key].choice, choice: choiceId, decisionId } }));
  return fakePendingMenu("attackers_selection", built, "Declare attackers", decisionId);
}

function attackObservation() {
  return fakeObservation({ selfBattlefield: [fakeCard("c-krrik", "K'rrik, Head Rats"), fakeCard("c-vilis", "Vilis, Broker of Blood")] });
}

it("a compound plan advances one step at a time, always against the FRESH pending decision, never resubmitting a stale choice", () => {
  const first = attackPlanDecision("d-1", [["krrik", "o1"], ["vilis", "o2"], ["finish", "o3"]]);
  const { runner, state, submitted } = makeRunner({ pending: first, observation: attackObservation() });

  const result = runner.interpret("j'attaque avec k'rrik et vilis")!;
  assert.equal(result.resolution.kind, "plan");
  runner.execute(result.resolution);
  assert.deepEqual(submitted.map((c) => c.choice), ["o1"]);
  assert.deepEqual(runner.planStatus.remaining, ["Add Vilis, Broker of Blood attacking Asphodel"]);

  // Forge answers with a NEW decision (new decisionId, new objectId for the same card) — the next
  // step must resolve against THIS fresh state, never resubmit the old "o2".
  state.pending = attackPlanDecision("d-2", [["vilis", "o2-new"], ["finish", "o3-new"]]);
  runner.advancePlan();
  assert.deepEqual(submitted.map((c) => c.choice), ["o1", "o2-new"]);
  assert.deepEqual(runner.planStatus.remaining, []);
});

it("a plan aborts safely — without resubmitting or inventing anything — if the next step is no longer a legal choice", () => {
  const first = attackPlanDecision("d-1", [["krrik", "o1"], ["vilis", "o2"], ["finish", "o3"]]);
  const { runner, state, submitted } = makeRunner({ pending: first, observation: attackObservation() });
  const result = runner.interpret("j'attaque avec k'rrik et vilis")!;
  runner.execute(result.resolution);
  assert.deepEqual(submitted.map((c) => c.choice), ["o1"]);

  // Reality no longer matches the plan (e.g. Vilis left combat for some other reason).
  state.pending = attackPlanDecision("d-2", [["finish", "o3-new"]]);
  runner.advancePlan();
  assert.deepEqual(submitted.map((c) => c.choice), ["o1"], "must never invent/resubmit anything");
  assert.ok(runner.planStatus.abortReason);
  assert.deepEqual(runner.planStatus.remaining, []);
});

it("advancePlan is a no-op while canAct() is false (frame playback / stale decision protection), and resumes once it's true again", () => {
  const first = attackPlanDecision("d-1", [["krrik", "o1"], ["vilis", "o2"], ["finish", "o3"]]);
  const { runner, state, submitted } = makeRunner({ pending: first, observation: attackObservation() });
  const result = runner.interpret("j'attaque avec k'rrik et vilis")!;
  runner.execute(result.resolution);
  assert.deepEqual(submitted.map((c) => c.choice), ["o1"]);

  state.canAct = false;
  runner.advancePlan();
  assert.deepEqual(submitted.map((c) => c.choice), ["o1"], "must not advance mid-frame-playback");

  state.canAct = true;
  runner.advancePlan();
  assert.deepEqual(submitted.map((c) => c.choice), ["o1", "o2"]);
});

it("approveDictionaryEntry is the only way the lexicon ever changes, and a fresh runner backed by the SAME storage sees it", () => {
  const { runner: firstRunner, storage } = makeRunner({});
  const before = firstRunner.lexicon.length;
  firstRunner.approveDictionaryEntry({ term: "lande", intent: "play", context: "priority_action" });
  assert.equal(firstRunner.lexicon.length, before + 1);

  const { runner: unrelatedRunner } = makeRunner({});
  assert.equal(unrelatedRunner.lexicon.length, before, "a different storage never sees another runner's approval");

  const { runner: reloadedRunner } = makeRunner({ storage });
  assert.equal(reloadedRunner.lexicon.length, before + 1, "the SAME storage persists the approval across a fresh runner instance");
});

it("a context-scoped approval only ever applies to the exact context it was approved for", () => {
  const observation = fakeObservation({ selfBattlefield: [fakeCard("c-kokusho", "Kokusho, the Renegade Ninja")] });
  const attackers = fakePendingMenu("attackers_selection", [fakeMenuItem("Add Kokusho attacking Asphodel", "o1", { cardRef: "c-kokusho" })]);
  const { runner, state } = makeRunner({ pending: attackers, observation });
  runner.approveDictionaryEntry({ term: "envoie", intent: "attack", context: "attackers_selection" }, "context");

  const resolved = runner.interpret("envoie kokusho")!;
  assert.equal(resolved.resolution.kind, "resolved");

  state.pending = fakePendingMenu("priority_action", [fakeMenuItem("Pass priority", "pass", { control: "pass", cardRef: null })]);
  const elsewhere = runner.interpret("envoie")!;
  assert.equal(elsewhere.resolution.kind, "unrecognized");
});
