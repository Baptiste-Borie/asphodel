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

  it("rejects unsupported multi-commander configurations", () => {
    const cards = deck().cards.map((card, index) =>
      index === 0 ? { ...card, quantity: 2 } : card,
    );
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
