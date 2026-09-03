import type { DeckService, DeckDetailView } from "../decks/deck-service.js";
import { ForgeBridgeClient } from "./forge-bridge-client.js";
import { ForgeDeckAdapter } from "./forge-deck-adapter.js";
import type { ForgeGameResult } from "./forge-protocol.js";

export interface ForgeDeckMatchOptions {
  seed?: number;
  timeoutSeconds?: number;
}

export class ForgeDeckMatchRunner {
  constructor(
    private readonly deckService: DeckService,
    private readonly bridge: ForgeBridgeClient,
    private readonly adapter = new ForgeDeckAdapter(),
  ) {}

  async runDeckMatch(
    playerDeck: DeckDetailView,
    aiDeck: DeckDetailView,
    options: ForgeDeckMatchOptions = {},
  ): Promise<ForgeGameResult> {
    return this.bridge.request({
      type: "run_deck_match",
      format: "commander",
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.timeoutSeconds === undefined
        ? {}
        : { timeoutSeconds: options.timeoutSeconds }),
      decks: [
        this.adapter.toForgeDeckSpec(playerDeck),
        this.adapter.toForgeDeckSpec(aiDeck),
      ],
    });
  }

  async runDeckMatchByIds(
    playerDeckId: number,
    aiDeckId: number,
    options: ForgeDeckMatchOptions = {},
  ): Promise<ForgeGameResult> {
    const [playerDeck, aiDeck] = await Promise.all([
      this.deckService.getDeck(playerDeckId),
      this.deckService.getDeck(aiDeckId),
    ]);
    return this.runDeckMatch(playerDeck, aiDeck, options);
  }
}
