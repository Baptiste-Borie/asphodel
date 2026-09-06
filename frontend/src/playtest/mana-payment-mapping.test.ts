import assert from "node:assert/strict";
import { it } from "node:test";
import { decideCardAction } from "./hand-action-mapping.js";
import { groupManaPaymentOptions } from "./mana-payment-mapping.js";
import type { AgentCardObservation, MenuItem } from "./types.js";

function card(cardRef: string, name: string, typeLine: string): AgentCardObservation {
  return {
    cardRef, name, zone: "battlefield", ownerId: "player-1", controllerId: "player-1",
    faceDown: false, hidden: false, tapped: false, summoningSick: false, counters: null,
    power: null, toughness: null, typeLine, token: false,
  };
}

function manaItem(label: string, choiceId: string, cardRef: string | null): MenuItem {
  return { label, choice: { decisionId: "d-1", kind: "mana", choice: choiceId, reason: "human_choice" }, cardRef };
}

it("groups mana sources by sourceCardRef, classifying lands vs other sources", () => {
  const cardsByRef = new Map([
    ["mtn-1", card("mtn-1", "Mountain", "Basic Land — Mountain")],
    ["solring-1", card("solring-1", "Sol Ring", "Artifact")],
  ]);
  const items = [manaItem("Mountain (produces R)", "opt-1", "mtn-1"), manaItem("Sol Ring (produces C/C)", "opt-2", "solring-1")];
  const groups = groupManaPaymentOptions(items, cardsByRef);
  assert.equal(groups.lands.length, 1);
  assert.equal(groups.lands[0]?.cardRef, "mtn-1");
  assert.equal(groups.other.length, 1);
  assert.equal(groups.other[0]?.cardRef, "solring-1");
  assert.deepEqual(groups.floating, []);
});

it("keeps two same-named lands as two distinct source groups (never merged by name)", () => {
  const cardsByRef = new Map([
    ["mtn-1", card("mtn-1", "Mountain", "Basic Land — Mountain")],
    ["mtn-2", card("mtn-2", "Mountain", "Basic Land — Mountain")],
  ]);
  const items = [manaItem("Mountain (produces R)", "opt-1", "mtn-1"), manaItem("Mountain (produces R)", "opt-2", "mtn-2")];
  const groups = groupManaPaymentOptions(items, cardsByRef);
  assert.equal(groups.lands.length, 2);
  assert.deepEqual(groups.lands.map(g => g.cardRef).sort(), ["mtn-1", "mtn-2"]);
});

it("detects a multi-option source (e.g. Command Tower) and preserves every exact option", () => {
  const cardsByRef = new Map([["tower-1", card("tower-1", "Command Tower", "Land")]]);
  const items = [manaItem("Command Tower (produces W)", "opt-w", "tower-1"), manaItem("Command Tower (produces U)", "opt-u", "tower-1")];
  const groups = groupManaPaymentOptions(items, cardsByRef);
  assert.equal(groups.lands.length, 1, "one physical source, not two");
  assert.equal(groups.lands[0]?.options.length, 2, "both color options preserved under the same source");
  assert.deepEqual(groups.lands[0]?.options.map(o => o.choice.choice), ["opt-w", "opt-u"]);
});

it("separates floating mana entirely — no physical card, never grouped with a source", () => {
  const cardsByRef = new Map<string, AgentCardObservation>();
  const items = [manaItem("Floating R mana", "opt-float", null)];
  const groups = groupManaPaymentOptions(items, cardsByRef);
  assert.equal(groups.lands.length, 0);
  assert.equal(groups.other.length, 0);
  assert.equal(groups.floating.length, 1);
  assert.equal(groups.floating[0]?.label, "Floating R mana");
});

it("a mana creature or Treasure classifies as \"other\", not a land", () => {
  const cardsByRef = new Map([["treasure-1", card("treasure-1", "Treasure", "Artifact — Treasure")]]);
  const items = [manaItem("Treasure (produces C)", "opt-1", "treasure-1")];
  const groups = groupManaPaymentOptions(items, cardsByRef);
  assert.equal(groups.lands.length, 0);
  assert.equal(groups.other.length, 1);
});

it("clicking a single-option source (e.g. one Mountain) submits its exact mana choice directly — same decision logic as every other card-driven click", () => {
  const cardsByRef = new Map([["mtn-1", card("mtn-1", "Mountain", "Basic Land — Mountain")]]);
  const groups = groupManaPaymentOptions([manaItem("Mountain (produces R)", "opt-1", "mtn-1")], cardsByRef);
  const decision = decideCardAction(groups.lands[0]!.options);
  assert.equal(decision.kind, "submit");
  if (decision.kind === "submit") assert.equal(decision.choice.choice, "opt-1");
});

it("clicking a multi-option source (e.g. Command Tower) opens the color selector instead of guessing", () => {
  const cardsByRef = new Map([["tower-1", card("tower-1", "Command Tower", "Land")]]);
  const groups = groupManaPaymentOptions([
    manaItem("Command Tower (produces W)", "opt-w", "tower-1"),
    manaItem("Command Tower (produces U)", "opt-u", "tower-1"),
  ], cardsByRef);
  const decision = decideCardAction(groups.lands[0]!.options);
  assert.equal(decision.kind, "menu");
  if (decision.kind === "menu") assert.deepEqual(decision.items.map(i => i.choice.choice), ["opt-w", "opt-u"]);
});

it("preserves Forge's own ordering of distinct sources", () => {
  const cardsByRef = new Map([
    ["a", card("a", "Forest", "Basic Land — Forest")],
    ["b", card("b", "Mountain", "Basic Land — Mountain")],
  ]);
  const items = [manaItem("Mountain", "opt-b", "b"), manaItem("Forest", "opt-a", "a")];
  const groups = groupManaPaymentOptions(items, cardsByRef);
  assert.deepEqual(groups.lands.map(g => g.cardRef), ["b", "a"]);
});
