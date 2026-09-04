import type { DeckDetailView } from "../decks/deck-service.js";
import { ForgeBridgeClient } from "./forge-bridge-client.js";
import { ForgeDeckAdapter } from "./forge-deck-adapter.js";
import type {
  ForgeDeckSpec,
  ForgeExternalMatchSnapshot,
} from "./forge-protocol.js";

export interface ForgeExternalMatchStartOptions {
  seed?: number;
}

export class ForgeExternalMatchClient {
  constructor(
    private readonly bridge: ForgeBridgeClient,
    private readonly adapter = new ForgeDeckAdapter(),
  ) {}

  start(
    playerDeck: DeckDetailView,
    aiDeck: DeckDetailView,
    options: ForgeExternalMatchStartOptions = {},
  ) {
    return this.startSpecs(
      this.adapter.toForgeDeckSpec(playerDeck),
      this.adapter.toForgeDeckSpec(aiDeck),
      options,
    );
  }

  startSpecs(
    playerDeck: ForgeDeckSpec,
    aiDeck: ForgeDeckSpec,
    options: ForgeExternalMatchStartOptions = {},
  ) {
    return this.bridge.request({
      type: "start_external_match",
      format: "commander",
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      decks: [playerDeck, aiDeck],
    });
  }

  get(sessionId: string): Promise<ForgeExternalMatchSnapshot> {
    return this.bridge.request({ type: "get_external_match", sessionId });
  }

  submitDecision(sessionId: string, decisionId: string, actionId: string) {
    return this.bridge.request({
      type: "submit_external_decision",
      sessionId,
      decisionId,
      actionId,
    });
  }

  submitTarget(sessionId: string, decisionId: string, targetId: string) {
    return this.bridge.request({
      type: "submit_external_decision",
      sessionId,
      decisionId,
      targetId,
    });
  }

  submitMode(sessionId: string, decisionId: string, modeId: string) {
    return this.bridge.request({
      type: "submit_external_decision",
      sessionId,
      decisionId,
      modeId,
    });
  }

  submitValue(sessionId: string, decisionId: string, value: number) {
    return this.bridge.request({
      type: "submit_external_decision",
      sessionId,
      decisionId,
      value,
    });
  }

  submitOptionalCost(sessionId: string, decisionId: string, costId: string) {
    return this.bridge.request({
      type: "submit_external_decision",
      sessionId,
      decisionId,
      costId,
    });
  }

  submitCostObject(sessionId: string, decisionId: string, objectId: string) {
    return this.bridge.request({
      type: "submit_external_decision",
      sessionId,
      decisionId,
      objectId,
    });
  }

  cancel(sessionId: string) {
    return this.bridge.request({ type: "cancel_external_match", sessionId });
  }
}
