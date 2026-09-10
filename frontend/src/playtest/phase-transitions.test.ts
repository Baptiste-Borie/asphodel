import assert from "node:assert/strict";
import { it } from "node:test";
import { detectMajorPhaseTransition, phaseTransitionLabel } from "./phase-transitions.js";

it("is null on the very first reading — nothing to compare against yet", () => {
  assert.equal(detectMajorPhaseTransition(null, { turn: 1, phase: "main1", activePlayerId: "player-1" }, "player-1"), null);
});

it("detects the human's own turn starting", () => {
  const previous = { turn: 1, phase: "end", activePlayerId: "player-2" };
  const next = { turn: 2, phase: "upkeep", activePlayerId: "player-1" };
  assert.equal(detectMajorPhaseTransition(previous, next, "player-1"), "your_turn");
});

it("detects the opponent's turn starting", () => {
  const previous = { turn: 1, phase: "end", activePlayerId: "player-1" };
  const next = { turn: 2, phase: "upkeep", activePlayerId: "player-2" };
  assert.equal(detectMajorPhaseTransition(previous, next, "player-1"), "opponent_turn");
});

it("detects entering combat, but only on the step INTO it", () => {
  const previous = { turn: 1, phase: "main1", activePlayerId: "player-1" };
  const next = { turn: 1, phase: "combat_begin", activePlayerId: "player-1" };
  assert.equal(detectMajorPhaseTransition(previous, next, "player-1"), "combat");
});

it("never re-fires combat while already inside a combat sub-step", () => {
  const previous = { turn: 1, phase: "combat_begin", activePlayerId: "player-1" };
  const next = { turn: 1, phase: "combat_declare_attackers", activePlayerId: "player-1" };
  assert.equal(detectMajorPhaseTransition(previous, next, "player-1"), null);
});

it("is null for every other ordinary phase/step change (upkeep, draw, end step, …)", () => {
  const previous = { turn: 1, phase: "upkeep", activePlayerId: "player-1" };
  const next = { turn: 1, phase: "draw", activePlayerId: "player-1" };
  assert.equal(detectMajorPhaseTransition(previous, next, "player-1"), null);
});

it("phaseTransitionLabel: exact, restrained text for each transition", () => {
  assert.equal(phaseTransitionLabel("your_turn", "Asphodel"), "YOUR TURN");
  assert.equal(phaseTransitionLabel("opponent_turn", "Asphodel"), "ASPHODEL'S TURN");
  assert.equal(phaseTransitionLabel("combat", "Asphodel"), "COMBAT");
});
