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

    // Distinct commander names, not summed quantity: two entries named "Sam, Loyal Attendant"
    // (or one entry with quantity 2) are the SAME structural problem — a malformed decklist, never
    // "two commanders". Legality of a specific two-commander PAIR (Partner/Partner with/Friends
    // forever/Background/Doctor's companion) is never decided here — Forge is the sole authority
    // for that, checked bridge-side against the resolved cards themselves (V2f).
    const commanderQuantities = new Map<string, number>();
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
        commanderQuantities.set(card.name, (commanderQuantities.get(card.name) ?? 0) + card.quantity);
      } else if (card.section === "mainboard") {
        mainboardCards += card.quantity;
      } else {
        throw new ForgeDeckAdapterError(
          "INVALID_FORGE_DECK",
          `unsupported deck section for ${card.name}.`,
        );
      }
    }

    if ([...commanderQuantities.values()].some((quantity) => quantity !== 1)) {
      throw new ForgeDeckAdapterError(
        "INVALID_FORGE_DECK",
        "Each commander must appear exactly once.",
      );
    }
    if (commanderQuantities.size === 0) {
      throw new ForgeDeckAdapterError(
        "INVALID_FORGE_DECK",
        "Commander decks must contain one or two commanders; none was found.",
      );
    }
    if (commanderQuantities.size > 2) {
      throw new ForgeDeckAdapterError(
        "UNSUPPORTED_COMMANDER_CONFIGURATION",
        `Asphodel supports one or two commanders; found ${commanderQuantities.size}.`,
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
