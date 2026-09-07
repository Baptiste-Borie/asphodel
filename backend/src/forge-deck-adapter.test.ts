import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DeckDetailView } from "./decks/deck-service.js";
import {
  ForgeDeckAdapter,
  ForgeDeckAdapterError,
} from "./forge/forge-deck-adapter.js";

function deck(overrides: Partial<DeckDetailView> = {}): DeckDetailView {
  return {
    id: 42,
    name: "Krenko Library Deck",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    totalCards: 16,
    cards: [
      {
        id: 1,
        scryfallId: "scryfall-krenko",
        oracleId: "oracle-krenko",
        name: "Krenko, Tin Street Kingpin",
        manaCost: "{2}{R}",
        manaValue: 3,
        typeLine: "Legendary Creature — Goblin",
        oracleText: "UI metadata must not cross the bridge.",
        colors: ["R"],
        colorIdentity: ["R"],
        imageUri: "https://cards.example/krenko.jpg",
        quantity: 1,
        section: "commander",
      },
      {
        id: 2,
        scryfallId: "scryfall-mountain",
        oracleId: "oracle-mountain",
        name: "Mountain",
        manaCost: null,
        manaValue: 0,
        typeLine: "Basic Land — Mountain",
        oracleText: null,
        colors: [],
        colorIdentity: ["R"],
        imageUri: "https://cards.example/mountain.jpg",
        quantity: 15,
        section: "mainboard",
      },
    ],
    ...overrides,
  };
}

describe("ForgeDeckAdapter", () => {
  it("maps only canonical names, quantities, sections, and deck provenance", () => {
    const spec = new ForgeDeckAdapter().toForgeDeckSpec(deck());

    assert.deepEqual(spec, {
      sourceDeckId: 42,
      name: "Krenko Library Deck",
      cards: [
        {
          name: "Krenko, Tin Street Kingpin",
          quantity: 1,
          section: "commander",
        },
        { name: "Mountain", quantity: 15, section: "mainboard" },
      ],
    });
    assert.equal("scryfallId" in spec.cards[0]!, false);
    assert.equal("oracleText" in spec.cards[0]!, false);
    assert.equal("imageUri" in spec.cards[0]!, false);
  });

  it("rejects a deck without a commander", () => {
    assert.throws(
      () =>
        new ForgeDeckAdapter().toForgeDeckSpec(
          deck({ cards: deck().cards.slice(1) }),
        ),
      (error: unknown) =>
        error instanceof ForgeDeckAdapterError &&
        error.code === "INVALID_FORGE_DECK" &&
        /none was found/.test(error.message),
    );
  });

  it("V2f: accepts a real two-commander (partner) configuration, preserving both entries", () => {
    const cards = [
      ...deck().cards,
      {
        id: 3,
        scryfallId: "scryfall-sam",
        oracleId: "oracle-sam",
        name: "Sam, Loyal Attendant",
        manaCost: "{1}{G}{W}",
        manaValue: 3,
        typeLine: "Legendary Creature — Halfling Peasant",
        oracleText: "UI metadata must not cross the bridge.",
        colors: ["G", "W"],
        colorIdentity: ["G", "W"],
        imageUri: "https://cards.example/sam.jpg",
        quantity: 1,
        section: "commander" as const,
      },
    ];
    const spec = new ForgeDeckAdapter().toForgeDeckSpec(deck({ cards }));
    assert.deepEqual(
      spec.cards.filter((card) => card.section === "commander").map((card) => card.name).sort(),
      ["Krenko, Tin Street Kingpin", "Sam, Loyal Attendant"],
    );
    // Legality of this SPECIFIC pair (Partner/Partner with/Friends forever/Background/Doctor's
    // companion) is never decided here — only Forge itself validates that (V2f).
  });

  it("rejects a single commander entry appearing more than once (malformed decklist, not \"two commanders\")", () => {
    const cards = deck().cards.map((card, index) =>
      index === 0 ? { ...card, quantity: 2 } : card,
    );
    assert.throws(
      () => new ForgeDeckAdapter().toForgeDeckSpec(deck({ cards })),
      (error: unknown) =>
        error instanceof ForgeDeckAdapterError &&
        error.code === "INVALID_FORGE_DECK" &&
        /exactly once/.test(error.message),
    );
  });

  it("rejects more than two distinct commanders as an unsupported configuration", () => {
    const cards = [
      ...deck().cards,
      { id: 3, scryfallId: "s3", oracleId: "o3", name: "Second Commander", manaCost: null, manaValue: 0,
        typeLine: "Legendary Creature", oracleText: null, colors: [], colorIdentity: [],
        imageUri: null, quantity: 1, section: "commander" as const },
      { id: 4, scryfallId: "s4", oracleId: "o4", name: "Third Commander", manaCost: null, manaValue: 0,
        typeLine: "Legendary Creature", oracleText: null, colors: [], colorIdentity: [],
        imageUri: null, quantity: 1, section: "commander" as const },
    ];
    assert.throws(
      () => new ForgeDeckAdapter().toForgeDeckSpec(deck({ cards })),
      (error: unknown) =>
        error instanceof ForgeDeckAdapterError &&
        error.code === "UNSUPPORTED_COMMANDER_CONFIGURATION",
    );
  });

  it("rejects an empty mainboard and non-positive quantities", () => {
    assert.throws(
      () =>
        new ForgeDeckAdapter().toForgeDeckSpec(
          deck({ cards: [deck().cards[0]!] }),
        ),
      ForgeDeckAdapterError,
    );

    const cards = deck().cards.map((card, index) =>
      index === 1 ? { ...card, quantity: 0 } : card,
    );
    assert.throws(
      () => new ForgeDeckAdapter().toForgeDeckSpec(deck({ cards })),
      (error: unknown) =>
        error instanceof ForgeDeckAdapterError &&
        error.code === "INVALID_FORGE_DECK" &&
        /positive integer/.test(error.message),
    );
  });
});
