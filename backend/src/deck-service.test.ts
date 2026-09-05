import assert from "node:assert/strict";
import { it } from "node:test";
import { CardsNotFoundError } from "./app-errors.js";
import { DeckService } from "./decks/deck-service.js";
import { createTestDatabase, FakeCardProvider } from "./test-helpers.js";

async function createService(printings?: Map<string, string>, missingNames?: Set<string>) {
  const database = await createTestDatabase();
  const provider = new FakeCardProvider(missingNames, printings);
  const service = new DeckService(database.db, provider);
  return { service, provider, close: () => database.close() };
}

it("resolves the exact printing named by a decklist's (SET) NUMBER suffix", async () => {
  const { service, provider, close } = await createService(new Map([["dmu/225", "Uurg, Spawn of Turg"]]));
  try {
    const deck = await service.createDeck(
      "Uurg deck",
      "Commander\n1x Uurg, Spawn of Turg (DMU) 225\n\nMainboard\n99x Forest",
    );
    assert.equal(deck.cards.find((c) => c.section === "commander")?.name, "Uurg, Spawn of Turg");
    assert.deepEqual(provider.printingCalls, ["dmu/225"]);
  } finally {
    await close();
  }
});

it("is case-insensitive on the set code", async () => {
  const { service, provider, close } = await createService(new Map([["dmu/225", "Uurg, Spawn of Turg"]]));
  try {
    await service.createDeck("Uurg deck", "Commander\n1x Uurg, Spawn of Turg (dmu) 225\n\nMainboard\n99x Forest");
    await service.createDeck("Uurg deck 2", "Commander\n1x Uurg, Spawn of Turg (DMU) 225\n\nMainboard\n99x Forest");
    assert.deepEqual(provider.printingCalls, ["dmu/225"], "both cases must hit the same normalized printing key");
  } finally {
    await close();
  }
});

it("falls back to an exact name lookup when no printing suffix was given (unchanged behavior)", async () => {
  const { service, provider, close } = await createService();
  try {
    const deck = await service.createDeck("Krenko deck", "Commander\n1x Krenko, Tin Street Kingpin\n\nMainboard\n99x Mountain");
    assert.equal(deck.cards.find((c) => c.section === "commander")?.name, "Krenko, Tin Street Kingpin");
    assert.deepEqual(provider.calls, ["Krenko, Tin Street Kingpin", "Mountain"]);
  } finally {
    await close();
  }
});

it("falls back to the name lookup when the named printing is not found, and still succeeds", async () => {
  const { service, provider, close } = await createService(); // no known printings at all
  try {
    const deck = await service.createDeck(
      "Uurg deck",
      "Commander\n1x Uurg, Spawn of Turg (ZZZ) 999\n\nMainboard\n99x Forest",
    );
    assert.equal(deck.cards.find((c) => c.section === "commander")?.name, "Uurg, Spawn of Turg");
    assert.deepEqual(provider.printingCalls, ["zzz/999"], "the printing lookup must still be attempted, not skipped");
    assert.ok(provider.calls.includes("Uurg, Spawn of Turg"), "must fall back to the name lookup afterward");
  } finally {
    await close();
  }
});

it("fails clearly when neither the printing nor the name resolves to any card", async () => {
  const { service, close } = await createService(undefined, new Set(["Totally Made Up Card"]));
  try {
    await assert.rejects(
      service.createDeck("Bad deck", "Commander\n1x Totally Made Up Card (ZZZ) 999\n\nMainboard\n99x Forest"),
      (error: unknown) => error instanceof CardsNotFoundError,
    );
  } finally {
    await close();
  }
});
