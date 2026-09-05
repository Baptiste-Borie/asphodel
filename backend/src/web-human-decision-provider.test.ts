import assert from "node:assert/strict";
import { it } from "node:test";
import { HumanEndMatchError } from "./human/human-decision-provider.js";
import { WebHumanDecisionError, WebHumanDecisionProvider } from "./human/web-human-decision-provider.js";
import type { AgentObservation, AgentSelfPlayerObservation, ForgePendingExternalDecision as Decision } from "./forge/forge-protocol.js";

function observation(selfId = "player-1", opponentId = "player-2"): AgentObservation {
  const context = { turn: 1, phase: "main1", activePlayerId: selfId, priorityPlayerId: selfId };
  const self: AgentSelfPlayerObservation = { role: "self", playerId: selfId, name: selfId, life: 40, startingLife: 40, handSize: 0, librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: 0, externalController: true, hand: [], battlefield: [], graveyard: [], exile: [], command: [], commanders: [] };
  const { hand: _hand, ...publicSelf } = self;
  return { selfPlayerId: selfId, gameRef: "g", game: context, stack: [], players: [self, { ...publicSelf, role: "opponent", playerId: opponentId, name: opponentId, externalController: false, battlefield: [] }] };
}

function priorityDecision(id = "d-1"): Extract<Decision, { type: "priority_action" }> {
  return { decisionId: id, type: "priority_action", playerId: "player-1", context: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 0 },
    actions: [{ actionId: "pass", type: "pass", label: "Pass priority", cardRef: null, cardName: null, sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false }] };
}

it("choose() stays pending until submit() answers it", async () => {
  const provider = new WebHumanDecisionProvider();
  let resolved: unknown;
  const promise = provider.choose(observation(), priorityDecision()).then(choice => { resolved = choice; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, undefined, "choose() must not resolve before a submission");
  assert.deepEqual(provider.current()?.decision.decisionId, "d-1");
  provider.submit({ decisionId: "d-1", kind: "action", choice: "pass", reason: "human_choice" });
  await promise;
  assert.deepEqual(resolved, { decisionId: "d-1", kind: "action", choice: "pass", reason: "human_choice" });
  assert.equal(provider.current(), null, "no decision remains pending once answered");
});

it("submit() rejects a wrong/stale decisionId and submits nothing", async () => {
  const provider = new WebHumanDecisionProvider();
  let settled = false;
  const promise = provider.choose(observation(), priorityDecision("d-1")).then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(
    () => provider.submit({ decisionId: "d-stale", kind: "action", choice: "pass", reason: "human_choice" }),
    (error: unknown) => error instanceof WebHumanDecisionError && error.code === "STALE_DECISION",
  );
  assert.equal(settled, false, "a stale decisionId must not resolve the pending choose()");
  assert.notEqual(provider.current(), null, "the original decision is still pending after a rejected stale submit");
  provider.submit({ decisionId: "d-1", kind: "action", choice: "pass", reason: "human_choice" });
  await promise;
  assert.equal(settled, true);
});

it("submit() rejects an illegal choice via validateChoice and submits nothing", async () => {
  const provider = new WebHumanDecisionProvider();
  const promise = provider.choose(observation(), priorityDecision("d-1"));
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => provider.submit({ decisionId: "d-1", kind: "action", choice: "not-a-real-action", reason: "human_choice" }));
  assert.notEqual(provider.current(), null, "an illegal choice must not consume the pending decision");
  provider.submit({ decisionId: "d-1", kind: "action", choice: "pass", reason: "human_choice" });
  await promise;
});

it("a double submit for the same decision is refused the second time", async () => {
  const provider = new WebHumanDecisionProvider();
  const promise = provider.choose(observation(), priorityDecision("d-1"));
  await new Promise(resolve => setImmediate(resolve));
  provider.submit({ decisionId: "d-1", kind: "action", choice: "pass", reason: "human_choice" });
  await promise;
  assert.throws(
    () => provider.submit({ decisionId: "d-1", kind: "action", choice: "pass", reason: "human_choice" }),
    (error: unknown) => error instanceof WebHumanDecisionError && error.code === "NO_PENDING_DECISION",
  );
});

it("requestEnd() rejects an in-flight choose() with HumanEndMatchError", async () => {
  const provider = new WebHumanDecisionProvider();
  const promise = provider.choose(observation(), priorityDecision("d-1"));
  await new Promise(resolve => setImmediate(resolve));
  provider.requestEnd();
  await assert.rejects(promise, (error: unknown) => error instanceof HumanEndMatchError);
  assert.equal(provider.current(), null);
});

it("requestEnd() before any decision makes the next choose() reject immediately, and endRequested() reports true", async () => {
  const provider = new WebHumanDecisionProvider();
  provider.requestEnd();
  assert.equal(provider.endRequested(), true);
  await assert.rejects(provider.choose(observation(), priorityDecision("d-1")), (error: unknown) => error instanceof HumanEndMatchError);
});
