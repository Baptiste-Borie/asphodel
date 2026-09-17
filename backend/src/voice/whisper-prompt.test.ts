import assert from "node:assert/strict";
import { it } from "node:test";
import { buildWhisperPrompt, MAX_PROMPT_CARD_NAMES, MAX_PROMPT_CHARS } from "./whisper-prompt.js";

it("returns null for an empty or absent vocabulary — no unnecessary prompt", () => {
  assert.equal(buildWhisperPrompt(undefined), null);
  assert.equal(buildWhisperPrompt([]), null);
  assert.equal(buildWhisperPrompt(["", "   "]), null);
});

it("builds a prompt naming every card once, in the caller's own order", () => {
  const prompt = buildWhisperPrompt(["Mind Stone", "Sol Ring", "K'rrik, Son of Yawgmoth"]);
  assert.ok(prompt);
  assert.match(prompt, /Mind Stone, Sol Ring, K'rrik, Son of Yawgmoth/);
});

it("deduplicates case-insensitively, keeping the first occurrence's casing and position", () => {
  const prompt = buildWhisperPrompt(["Sol Ring", "sol ring", "Mind Stone", "SOL RING"]);
  assert.equal(prompt, "Magic: The Gathering. Noms de cartes probables : Sol Ring, Mind Stone.");
});

it("is deterministic for the same input — same vocabulary always yields the same prompt string", () => {
  const vocabulary = ["Kokusho, the Renegade Ninja", "Vilis, Broker of Blood"];
  assert.equal(buildWhisperPrompt(vocabulary), buildWhisperPrompt(vocabulary));
});

it("caps the number of card names at MAX_PROMPT_CARD_NAMES", () => {
  const names = Array.from({ length: MAX_PROMPT_CARD_NAMES + 10 }, (_, i) => `Card ${i}`);
  const prompt = buildWhisperPrompt(names)!;
  const includedCount = names.filter((name) => prompt.includes(name)).length;
  assert.ok(includedCount <= MAX_PROMPT_CARD_NAMES);
  assert.ok(prompt.includes("Card 0"), "keeps the highest-priority (first) names, never drops the front of the list");
});

it("never exceeds the total character budget, even with very long card names", () => {
  const names = Array.from({ length: 20 }, (_, i) => `A Very Long Fantasy Card Name Number ${i} With Extra Words`);
  const prompt = buildWhisperPrompt(names)!;
  assert.ok(prompt.length <= MAX_PROMPT_CHARS);
});

it("respects a custom maxCardNames/maxChars override", () => {
  const prompt = buildWhisperPrompt(["Sol Ring", "Mind Stone", "Swamp"], { maxCardNames: 1 })!;
  assert.ok(prompt.includes("Sol Ring"));
  assert.ok(!prompt.includes("Mind Stone"));
});

it("a card name alone never overflows a tiny character budget into a truncated fragment", () => {
  assert.equal(buildWhisperPrompt(["Sol Ring"], { maxChars: 10 }), null);
});
