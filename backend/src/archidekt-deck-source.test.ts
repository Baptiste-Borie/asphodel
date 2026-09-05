import assert from "node:assert/strict";
import { it } from "node:test";
import {
  ArchidektDeckSource,
  ArchidektDeckSourceError,
  extractArchidektDeckId,
  isArchidektDeckUrl,
  parseArchidektDeck,
} from "./decks/archidekt-deck-source.js";

function land(name: string, quantity: number) {
  return { quantity, categories: [], card: { oracleCard: { name } } };
}
function commander(name: string) {
  return { quantity: 1, categories: ["Commander"], card: { oracleCard: { name } } };
}

/** 1 commander + 99 lands = a valid, minimal 100-card fixture, plus every excluded shape the parser must skip. */
function validPayload(overrides: Partial<{ cards: unknown[]; categories: unknown[]; name: string }> = {}) {
  const mainboard = Array.from({ length: 99 }, (_, i) => land(`Basic Land ${i + 1}`, 1));
  return {
    name: "Uurg, Spawn of Turg",
    cards: [
      commander("Uurg, Spawn of Turg"),
      ...mainboard,
      { quantity: 5, categories: ["Sideboard"], card: { oracleCard: { name: "Some Sideboard Card" } } },
      { quantity: 3, categories: ["Maybeboard"], card: { oracleCard: { name: "Some Maybe Card" } } },
      { quantity: 2, categories: ["Excluded Custom Category"], card: { oracleCard: { name: "Excluded By Flag" } } },
    ],
    categories: [
      { name: "Commander", includedInDeck: true },
      { name: "Sideboard", includedInDeck: false },
      { name: "Maybeboard", includedInDeck: false },
      { name: "Excluded Custom Category", includedInDeck: false },
    ],
    ...overrides,
  };
}

it("parses commander + mainboard, excludes Sideboard/Maybeboard/includedInDeck:false, merges duplicates", () => {
  const payload = validPayload();
  const spec = parseArchidektDeck(payload, 123456);
  assert.equal(spec.name, "Uurg, Spawn of Turg");
  assert.equal(spec.sourceDeckId, 123456);
  const total = spec.cards.reduce((sum, c) => sum + c.quantity, 0);
  assert.equal(total, 100);
  const commanders = spec.cards.filter(c => c.section === "commander");
  assert.equal(commanders.length, 1);
  assert.equal(commanders[0]!.name, "Uurg, Spawn of Turg");
  assert.ok(!spec.cards.some(c => c.name === "Some Sideboard Card"), "Sideboard must be excluded");
  assert.ok(!spec.cards.some(c => c.name === "Some Maybe Card"), "Maybeboard must be excluded");
  assert.ok(!spec.cards.some(c => c.name === "Excluded By Flag"), "a custom includedInDeck:false category must be excluded");
});

it("merges duplicate mainboard entries by name and sums quantities", () => {
  const payload = validPayload({
    cards: [
      commander("Krenko, Tin Street Kingpin"),
      { quantity: 40, categories: [], card: { oracleCard: { name: "Mountain" } } },
      { quantity: 2, categories: [], card: { oracleCard: { name: "Mountain" } } },
      ...Array.from({ length: 57 }, (_, i) => land(`Creature ${i + 1}`, 1)),
    ],
  });
  const spec = parseArchidektDeck(payload);
  const mountains = spec.cards.filter(c => c.name === "Mountain");
  assert.equal(mountains.length, 1);
  assert.equal(mountains[0]!.quantity, 42);
  assert.equal(spec.cards.reduce((sum, c) => sum + c.quantity, 0), 100);
});

it("supports a scalar category field and the oracle_card/displayName/name name fallbacks", () => {
  const payload = validPayload({
    cards: [
      { quantity: 1, category: "Commander", card: { oracle_card: { name: "Ghalta, Primal Hunger" } } },
      { quantity: 1, category: undefined, card: { displayName: "Forest (Display)" } },
      { quantity: 1, card: { name: "Plain Old Name" } },
      ...Array.from({ length: 97 }, (_, i) => land(`Filler ${i + 1}`, 1)),
    ],
  });
  const spec = parseArchidektDeck(payload);
  assert.equal(spec.cards.filter(c => c.section === "commander").length, 1);
  assert.ok(spec.cards.some(c => c.name === "Forest (Display)"));
  assert.ok(spec.cards.some(c => c.name === "Plain Old Name"));
});

it("supports two commanders (partners)", () => {
  const payload = validPayload({
    cards: [
      commander("Commander One"),
      commander("Commander Two"),
      ...Array.from({ length: 98 }, (_, i) => land(`Filler ${i + 1}`, 1)),
    ],
  });
  const spec = parseArchidektDeck(payload);
  assert.equal(spec.cards.filter(c => c.section === "commander").length, 2);
});

it("rejects a deck whose total size is not exactly 100", () => {
  const payload = validPayload({ cards: [commander("Uurg, Spawn of Turg"), land("Only Land", 1)] });
  assert.throws(() => parseArchidektDeck(payload), (error: unknown) => error instanceof ArchidektDeckSourceError && error.code === "INVALID_DECK_SIZE");
});

it("rejects a deck with no commander", () => {
  const payload = validPayload({ cards: Array.from({ length: 100 }, (_, i) => land(`Land ${i + 1}`, 1)) });
  assert.throws(() => parseArchidektDeck(payload), (error: unknown) => error instanceof ArchidektDeckSourceError && error.code === "INVALID_COMMANDER_COUNT");
});

it("rejects a deck with more than two commanders", () => {
  const payload = validPayload({
    cards: [commander("One"), commander("Two"), commander("Three"), ...Array.from({ length: 97 }, (_, i) => land(`Filler ${i + 1}`, 1))],
  });
  assert.throws(() => parseArchidektDeck(payload), (error: unknown) => error instanceof ArchidektDeckSourceError && error.code === "INVALID_COMMANDER_COUNT");
});

it("rejects a payload with no cards array", () => {
  assert.throws(() => parseArchidektDeck({ name: "Broken" }), (error: unknown) => error instanceof ArchidektDeckSourceError && error.code === "INVALID_PAYLOAD");
});

it("rejects an included card entry with no resolvable name", () => {
  const payload = validPayload({ cards: [commander("Uurg, Spawn of Turg"), { quantity: 99, categories: [], card: {} }] });
  assert.throws(() => parseArchidektDeck(payload), (error: unknown) => error instanceof ArchidektDeckSourceError && error.code === "INVALID_PAYLOAD");
});

it("isArchidektDeckUrl / extractArchidektDeckId only trust the archidekt.com host and a numeric id", () => {
  assert.equal(isArchidektDeckUrl("https://archidekt.com/decks/123456/my-deck"), true);
  assert.equal(isArchidektDeckUrl("https://www.archidekt.com/decks/1/x"), true);
  assert.equal(isArchidektDeckUrl("https://evil.example.com/decks/1"), false);
  assert.equal(isArchidektDeckUrl("42"), false);
  assert.equal(isArchidektDeckUrl("not a url"), false);
  assert.equal(extractArchidektDeckId("https://archidekt.com/decks/123456/mon-deck"), 123456);
  assert.throws(() => extractArchidektDeckId("not a url"), (error: unknown) => error instanceof ArchidektDeckSourceError && error.code === "INVALID_URL");
  assert.throws(() => extractArchidektDeckId("https://evil.example.com/decks/123456/"), (error: unknown) => error instanceof ArchidektDeckSourceError && error.code === "INVALID_HOST");
  assert.throws(() => extractArchidektDeckId("https://archidekt.com/not-a-deck-path"), (error: unknown) => error instanceof ArchidektDeckSourceError && error.code === "INVALID_URL");
});

it("ArchidektDeckSource fetches only the fixed API host derived from the id, never the user's URL directly", async () => {
  const requested: string[] = [];
  const source = new ArchidektDeckSource(async url => {
    requested.push(url);
    return { ok: true, status: 200, json: async () => validPayload() };
  });
  const spec = await source.fetchDeckSpec("https://archidekt.com/decks/999/whatever-slug-a-user-typed");
  assert.deepEqual(requested, ["https://archidekt.com/api/decks/999/"]);
  assert.equal(spec.name, "Uurg, Spawn of Turg");
});

it("ArchidektDeckSource reports a private deck as a clear error, never silently retries with credentials", async () => {
  const source = new ArchidektDeckSource(async () => ({ ok: false, status: 403, json: async () => ({}) }));
  await assert.rejects(
    source.fetchDeckSpec("https://archidekt.com/decks/999/private-deck"),
    (error: unknown) => error instanceof ArchidektDeckSourceError && error.code === "PRIVATE_DECK",
  );
});

it("ArchidektDeckSource reports a generic fetch failure clearly", async () => {
  const source = new ArchidektDeckSource(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await assert.rejects(
    source.fetchDeckSpec("https://archidekt.com/decks/999/whatever"),
    (error: unknown) => error instanceof ArchidektDeckSourceError && error.code === "FETCH_FAILED",
  );
});
