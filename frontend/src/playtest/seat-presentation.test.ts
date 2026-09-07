import assert from "node:assert/strict";
import { it } from "node:test";
import { computeSeatPresentations } from "./seat-presentation.js";

it("digital: both seats stay \"primary\" — the symmetric Obsidian Table is untouched", () => {
  const result = computeSeatPresentations("digital", "player-1", "player-2");
  assert.equal(result.human.emphasis, "primary");
  assert.equal(result.opponent.emphasis, "primary");
});

it("physical: the human's own seat becomes \"compact\", the opponent stays \"primary\"", () => {
  const result = computeSeatPresentations("physical", "player-1", "player-2");
  assert.equal(result.human.emphasis, "compact");
  assert.equal(result.opponent.emphasis, "primary");
});

it("carries playerId/role through verbatim, regardless of player-id ordering", () => {
  const a = computeSeatPresentations("physical", "player-1", "player-2");
  assert.equal(a.human.playerId, "player-1");
  assert.equal(a.human.role, "human");
  assert.equal(a.opponent.playerId, "player-2");
  assert.equal(a.opponent.role, "agent");

  const b = computeSeatPresentations("physical", "player-2", "player-1");
  assert.equal(b.human.playerId, "player-2");
  assert.equal(b.opponent.playerId, "player-1");
});

it("is unaffected by which literal ids are passed for either play mode", () => {
  const digital = computeSeatPresentations("digital", "human-abc", "agent-xyz");
  assert.equal(digital.human.emphasis, "primary");
  assert.equal(digital.opponent.emphasis, "primary");
  assert.equal(digital.human.playerId, "human-abc");
  assert.equal(digital.opponent.playerId, "agent-xyz");
});
