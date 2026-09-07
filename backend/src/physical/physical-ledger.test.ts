import assert from "node:assert/strict";
import { it } from "node:test";
import { PhysicalLedger, deckCompositionFrom } from "./physical-ledger.js";
import type { ForgeDeckSpec } from "../forge/forge-protocol.js";

function spec(cards: ForgeDeckSpec["cards"]): ForgeDeckSpec {
  return { name: "deck", cards };
}

it("deckCompositionFrom excludes the commander section and sums mainboard duplicates", () => {
  const composition = deckCompositionFrom(spec([
    { name: "Krenko, Tin Street Kingpin", quantity: 1, section: "commander" },
    { name: "Mountain", quantity: 20, section: "mainboard" },
    { name: "Mountain", quantity: 3, section: "mainboard" },
    { name: "Lightning Bolt", quantity: 1, section: "mainboard" },
  ]));
  assert.deepEqual(composition, { Mountain: 23, "Lightning Bolt": 1 });
  assert.equal("Krenko, Tin Street Kingpin" in composition, false, "the commander must never appear in the library composition");
});

it("deckCompositionFrom excludes BOTH commanders of a dual-commander (Partner/Background/...) deck spec", () => {
  const composition = deckCompositionFrom(spec([
    { name: "Frodo, Adventurous Hobbit", quantity: 1, section: "commander" },
    { name: "Sam, Loyal Attendant", quantity: 1, section: "commander" },
    { name: "Forest", quantity: 10, section: "mainboard" },
    { name: "Plains", quantity: 10, section: "mainboard" },
  ]));
  assert.deepEqual(composition, { Forest: 10, Plains: 10 });
  assert.equal("Frodo, Adventurous Hobbit" in composition, false);
  assert.equal("Sam, Loyal Attendant" in composition, false);
});

it("PhysicalLedger.snapshot() before any observe(): remaining is null, accounted is empty, composition matches input", () => {
  const composition = { Mountain: 23, "Lightning Bolt": 1 };
  const ledger = new PhysicalLedger(composition);
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.lastKnownRemaining, null);
  assert.deepEqual(snapshot.accounted, {});
  assert.deepEqual(snapshot.deckComposition, composition);
  assert.equal(snapshot.lastEventKind, null);
});

it("after one observe(): lastKnownRemaining mirrors the candidates exactly, and accounted is composition minus remaining (positive only)", () => {
  const composition = { Mountain: 23, "Lightning Bolt": 1, "Sol Ring": 1 };
  const ledger = new PhysicalLedger(composition);
  ledger.observe({ eventKind: "draw", candidates: [{ name: "Mountain", remaining: 20 }, { name: "Lightning Bolt", remaining: 1 }] });
  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.lastKnownRemaining, { Mountain: 20, "Lightning Bolt": 1 });
  assert.equal(snapshot.lastEventKind, "draw");
  // Mountain: 23 - 20 = 3 (positive, kept). Lightning Bolt: 1 - 1 = 0 (omitted). Sol Ring: never
  // named in candidates, falls back to its own total (1 - 1 = 0), also omitted.
  assert.deepEqual(snapshot.accounted, { Mountain: 3 });
});

it("never independently recomputes/guesses: an observe() whose candidates do NOT sum to a sensible declared amount is mirrored verbatim, with no validation/rejection", () => {
  const composition = { Mountain: 23 };
  const ledger = new PhysicalLedger(composition);
  // An arbitrary, Forge-supplied number that does not correspond to any "declared N cards" story
  // (e.g. more remaining than the deck even has) — the ledger must still just mirror it.
  ledger.observe({ eventKind: "mill", candidates: [{ name: "Mountain", remaining: 999 }] });
  let snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.lastKnownRemaining, { Mountain: 999 });
  assert.deepEqual(snapshot.accounted, {}, "23 - 999 is negative, so nothing is accounted — but the ledger never rejects or clamps the input itself");

  // A second observe() with a name never present in deckComposition at all — still mirrored as-is.
  ledger.observe({ eventKind: "scry_reveal", candidates: [{ name: "Totally Unknown Card", remaining: 4 }] });
  snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.lastKnownRemaining, { "Totally Unknown Card": 4 });
  assert.equal(snapshot.lastEventKind, "scry_reveal");
  assert.deepEqual(snapshot.accounted, {}, "an unrecognized name is silently ignored for accounting, never rejected");
});
