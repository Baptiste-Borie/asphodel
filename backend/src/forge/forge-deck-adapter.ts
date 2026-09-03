import type { DeckDetailView } from "../decks/deck-service.js";
import type { ForgeDeckSpec } from "./forge-protocol.js";

export type ForgeDeckAdapterErrorCode =
  | "INVALID_FORGE_DECK"
  | "UNSUPPORTED_COMMANDER_CONFIGURATION";

export class ForgeDeckAdapterError extends Error {
  constructor(
    public readonly code: ForgeDeckAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ForgeDeckAdapterError";
  }
}

export class ForgeDeckAdapter {
  toForgeDeckSpec(deck: DeckDetailView): ForgeDeckSpec {
    if (!Number.isSafeInteger(deck.id) || deck.id < 1) {
      throw new ForgeDeckAdapterError(
        "INVALID_FORGE_DECK",
        "source deck id must be a positive integer.",
      );
    }
    if (deck.name.trim() === "") {
      throw new ForgeDeckAdapterError(
        "INVALID_FORGE_DECK",
        "deck name must be a non-empty string.",
      );
    }

    let commanderCards = 0;
    let mainboardCards = 0;

    for (const card of deck.cards) {
      if (card.name.trim() === "") {
        throw new ForgeDeckAdapterError(
          "INVALID_FORGE_DECK",
          "card names must be non-empty strings.",
        );
      }
      if (!Number.isSafeInteger(card.quantity) || card.quantity < 1) {
        throw new ForgeDeckAdapterError(
          "INVALID_FORGE_DECK",
          `card quantity must be a positive integer: ${card.name}.`,
        );
      }
      if (card.section === "commander") {
        commanderCards += card.quantity;
      } else if (card.section === "mainboard") {
        mainboardCards += card.quantity;
      } else {
        throw new ForgeDeckAdapterError(
          "INVALID_FORGE_DECK",
          `unsupported deck section for ${card.name}.`,
        );
      }
    }

    if (commanderCards === 0) {
      throw new ForgeDeckAdapterError(
        "INVALID_FORGE_DECK",
        "Commander decks must contain exactly one commander; none was found.",
      );
    }
    if (commanderCards > 1) {
      throw new ForgeDeckAdapterError(
        "UNSUPPORTED_COMMANDER_CONFIGURATION",
        "Asphodel Forge Deck Adapter V1b supports exactly one commander.",
      );
    }
    if (mainboardCards === 0) {
      throw new ForgeDeckAdapterError(
        "INVALID_FORGE_DECK",
        "Commander decks must contain a non-empty mainboard.",
      );
    }

    return {
      sourceDeckId: deck.id,
      name: deck.name,
      cards: deck.cards.map(({ name, quantity, section }) => ({
        name,
        quantity,
        section,
      })),
    };
  }
}
