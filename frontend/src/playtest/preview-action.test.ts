import assert from "node:assert/strict";
import { it } from "node:test";
import { computePreviewAction } from "./preview-action.js";
import type { CardActionMap } from "./hand-action-mapping.js";
import type { AgentChoice } from "./types.js";

function choice(id: string): AgentChoice {
  return { decisionId: "d", kind: "action", choice: id, reason: "human_choice" };
}

it("nothing previewed => no action, regardless of what the board can do", () => {
  const map: CardActionMap = { byCardRef: new Map([["card-1", [{ label: "Sacrifice", choice: choice("a"), cardRef: "card-1" }]]]), unmapped: [] };
  assert.equal(computePreviewAction(null, map), null);
});

it("previewed card has no mapped action => no action (mere inspection, never forced actionable)", () => {
  const map: CardActionMap = { byCardRef: new Map([["card-1", [{ label: "Sacrifice", choice: choice("a"), cardRef: "card-1" }]]]), unmapped: [] };
  assert.equal(computePreviewAction("card-2", map), null);
});

it("no board action map at all (e.g. Asphodel's turn frame playback) => no action for anything previewed", () => {
  assert.equal(computePreviewAction("card-1", undefined), null);
});

it("a single legal action shows its own exact Forge label verbatim, items copied unchanged", () => {
  const item = { label: "Tap: Add {C}", choice: choice("a"), cardRef: "card-1" };
  const map: CardActionMap = { byCardRef: new Map([["card-1", [item]]]), unmapped: [] };
  const action = computePreviewAction("card-1", map);
  assert.equal(action?.label, "Tap: Add {C}");
  assert.deepEqual(action?.items, [item]);
});

it("several legal actions show a neutral count, never guessing or collapsing them", () => {
  const items = [
    { label: "Sacrifice for {C}", choice: choice("a"), cardRef: "card-1" },
    { label: "Sacrifice for {R}", choice: choice("b"), cardRef: "card-1" },
  ];
  const map: CardActionMap = { byCardRef: new Map([["card-1", items]]), unmapped: [] };
  const action = computePreviewAction("card-1", map);
  assert.equal(action?.label, "Choose action (2)");
  assert.deepEqual(action?.items, items);
});
