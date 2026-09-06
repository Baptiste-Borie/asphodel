import assert from "node:assert/strict";
import { it } from "node:test";
import { computeBattlefieldScale } from "./battlefield-scale.js";

it("1-6 permanents: full size, no overlap", () => {
  for (const count of [1, 2, 6]) {
    const scale = computeBattlefieldScale(count);
    assert.equal(scale.overlapPx, 0);
    assert.equal(scale.cardWidthPx, 160);
  }
});

it("7-10 permanents: same card size, mild growing overlap", () => {
  const seven = computeBattlefieldScale(7);
  const ten = computeBattlefieldScale(10);
  assert.equal(seven.cardWidthPx, 160);
  assert.equal(ten.cardWidthPx, 160);
  assert.ok(seven.overlapPx > 0);
  assert.ok(ten.overlapPx > seven.overlapPx);
});

it("large boards: overlap keeps growing well before card width ever shrinks", () => {
  const fifteen = computeBattlefieldScale(15);
  assert.equal(fifteen.cardWidthPx, 160, "width must not shrink yet at 15");
  assert.ok(fifteen.overlapPx > computeBattlefieldScale(10).overlapPx);
});

it("only shrinks card width once overlap has already maxed out, and never below a sane floor", () => {
  const huge = computeBattlefieldScale(60);
  assert.ok(huge.cardWidthPx < 160);
  assert.ok(huge.cardWidthPx >= 96);
  assert.equal(huge.overlapPx, 64, "overlap stays at its cap once width starts shrinking");
});

it("is monotonic: more cards never means a bigger card or less overlap", () => {
  let prev = computeBattlefieldScale(1);
  for (let n = 2; n <= 80; n++) {
    const next = computeBattlefieldScale(n);
    assert.ok(next.cardWidthPx <= prev.cardWidthPx);
    assert.ok(next.overlapPx >= prev.overlapPx);
    prev = next;
  }
});
