import type { ParseIssue } from "./deck-parser.js";

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidDeckError extends AppError {
  constructor(issues: ParseIssue[]) {
    super(
      "Certaines lignes de la liste ne respectent pas le format attendu.",
      422,
      "INVALID_DECK_FORMAT",
      { issues },
    );
  }
}

export class CardsNotFoundError extends AppError {
  constructor(cardNames: string[]) {
    super(
      "Certaines cartes sont introuvables sur Scryfall.",
      422,
      "CARDS_NOT_FOUND",
      { cardNames },
    );
  }
}

export class CardProviderUnavailableError extends AppError {
  constructor(message = "Scryfall est temporairement inaccessible.") {
    super(message, 502, "CARD_PROVIDER_UNAVAILABLE");
  }
}

export class DeckNotFoundError extends AppError {
  constructor() {
    super("Deck introuvable.", 404, "DECK_NOT_FOUND");
  }
}
