export const FORGE_PROTOCOL_VERSION = 1 as const;

export interface ForgeDeckCardSpec {
  name: string;
  quantity: number;
  section: "commander" | "mainboard";
}

export interface ForgeDeckSpec {
  sourceDeckId?: number;
  name: string;
  cards: ForgeDeckCardSpec[];
}

export interface ForgeRequestMap {
  ping: { type: "ping" };
  engine_info: { type: "engine_info" };
  forge_color_identity: { type: "forge_color_identity"; color: string };
  run_test_game: {
    type: "run_test_game";
    format: "commander" | "constructed";
    seed?: number;
    timeoutSeconds?: number;
  };
  inspect_deck: {
    type: "inspect_deck";
    deck: ForgeDeckSpec;
  };
  run_deck_match: {
    type: "run_deck_match";
    format: "commander";
    seed?: number;
    timeoutSeconds?: number;
    decks: [ForgeDeckSpec, ForgeDeckSpec];
  };
}

export interface ForgeTestGamePlayer {
  id: string;
  name: string;
  deckName: string;
  startingLife: number;
  ai: boolean;
  controllerClass: string;
  zones: {
    library: number;
    hand: number;
    battlefield: number;
    graveyard: number;
    command: number;
  };
  commanders: string[];
  commandersInCommandZone: boolean;
}

export interface ForgeDeckInspection {
  name: string;
  totalCards: number;
  mainboardCards: number;
  commanderCards: number;
  commanders: string[];
  resolvedUniqueCards: number;
}

export interface ForgeGameResult {
  gameId: string;
  format: "commander" | "constructed";
  seed: number;
  players: ForgeTestGamePlayer[];
  winnerId: string | null;
  turns: number;
  gameOver: boolean;
  draw: boolean;
  terminalReason: string;
  commanderRulesActive: boolean;
}

export interface ForgeResultMap {
  ping: { message: "pong" };
  engine_info: {
    bridgeVersion: string;
    protocolVersion: typeof FORGE_PROTOCOL_VERSION;
    forgeVersion: string;
    forgeRevision: string;
    forgeModules: string[];
  };
  forge_color_identity: {
    input: string;
    mask: number;
    symbols: string[];
    forgeClass: "forge.card.MagicColor";
    sourceModule: "forge-core";
  };
  run_test_game: {
    gameId: string;
    format: "commander" | "constructed";
    seed: number;
    players: ForgeTestGamePlayer[];
    winnerId: string | null;
    turns: number;
    gameOver: boolean;
    draw: boolean;
    terminalReason: string;
    commanderRulesActive: boolean;
    fixtureConformance: string;
    cardEvidence: {
      name: string;
      manaCost: string;
      oracleText: string;
      scriptAbilities: string[];
      scriptAbilityCount: number;
      rulesClass: string;
    };
    forgeClasses: {
      game: string;
      match: string;
      aiPlayer: string;
    };
  };
  inspect_deck: ForgeDeckInspection;
  run_deck_match: ForgeGameResult;
}

export type ForgeRequestType = keyof ForgeRequestMap;
export type ForgeRequest = ForgeRequestMap[ForgeRequestType];

export type ForgeWireRequest = ForgeRequest & {
  protocolVersion: typeof FORGE_PROTOCOL_VERSION;
  requestId: string;
};

export interface ForgeWireSuccessResponse {
  protocolVersion: typeof FORGE_PROTOCOL_VERSION;
  requestId: string;
  ok: true;
  type: string;
  result: unknown;
}

export interface ForgeWireErrorResponse {
  protocolVersion: typeof FORGE_PROTOCOL_VERSION;
  requestId: string;
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ForgeWireResponse =
  | ForgeWireSuccessResponse
  | ForgeWireErrorResponse;
