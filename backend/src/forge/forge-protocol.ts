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
  start_external_match: {
    type: "start_external_match";
    format: "commander";
    seed?: number;
    decks: [ForgeDeckSpec, ForgeDeckSpec];
  };
  get_external_match: {
    type: "get_external_match";
    sessionId: string;
  };
  submit_external_decision: {
    type: "submit_external_decision";
    sessionId: string;
    decisionId: string;
    actionId: string;
  };
  cancel_external_match: {
    type: "cancel_external_match";
    sessionId: string;
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

export type ForgeExternalAction =
  | {
      actionId: string;
      type: "pass";
      label: string;
      cardRef: null;
      cardName: null;
      sourceZone: null;
      abilityText: null;
      manaCost: null;
      requiresTargets: false;
    }
  | {
      actionId: string;
      type: "play_land" | "cast_spell" | "activate_ability";
      label: string;
      cardRef: string;
      cardName: string;
      sourceZone:
        | "hand"
        | "battlefield"
        | "command"
        | "graveyard"
        | "exile"
        | "library"
        | "other";
      abilityText: string | null;
      manaCost: string | null;
      requiresTargets: boolean;
    };

export interface ForgePendingDecision {
  decisionId: string;
  type: "priority_action";
  playerId: string;
  context: {
    turn: number;
    phase: string;
    activePlayerId: string;
    priorityPlayerId: string;
    stackSize: number;
  };
  actions: ForgeExternalAction[];
}

export type ForgeExternalMatchStatus =
  | "starting"
  | "running"
  | "waiting_for_decision"
  | "completed"
  | "cancelled"
  | "failed";

export interface ForgeExternalMatchProgress {
  decisionsRequested: number;
  decisionsSubmitted: number;
  passesSubmitted: number;
  primaryActionsSubmitted: number;
  primaryActionsPlayed: number;
  landsPlayed: number;
  spellsCast: number;
  abilitiesActivated: number;
}

export type AgentCardZone =
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "command";

export interface AgentCardObservation {
  cardRef: string;
  name: string | null;
  zone: AgentCardZone;
  ownerId: string | null;
  controllerId: string | null;
  faceDown: boolean;
  hidden: boolean;
  tapped: boolean | null;
  summoningSick: boolean | null;
  counters: Record<string, number> | null;
  power: number | null;
  toughness: number | null;
  typeLine: string | null;
}

export interface AgentCommanderObservation {
  cardRef: string;
  name: string;
  inCommandZone: boolean;
  castsFromCommand: number;
}

interface AgentPlayerObservationBase {
  playerId: string;
  name: string;
  life: number;
  startingLife: number;
  handSize: number;
  librarySize: number;
  graveyardSize: number;
  exileSize: number;
  commandZoneSize: number;
  battlefieldSize: number;
  externalController: boolean;
  battlefield: AgentCardObservation[];
  graveyard: AgentCardObservation[];
  exile: AgentCardObservation[];
  command: AgentCardObservation[];
  commanders: AgentCommanderObservation[];
}

export interface AgentSelfPlayerObservation
  extends AgentPlayerObservationBase {
  role: "self";
  hand: AgentCardObservation[];
}

export interface AgentOpponentPlayerObservation
  extends AgentPlayerObservationBase {
  role: "opponent";
}

export type AgentPlayerObservation =
  | AgentSelfPlayerObservation
  | AgentOpponentPlayerObservation;

export interface AgentStackItem {
  stackRef: string;
  position: number;
  sourceCardRef: string | null;
  sourceCardName: string | null;
  controllerId: string | null;
  description: string | null;
  faceDown: boolean;
  hidden: boolean;
}

export interface AgentObservation {
  gameRef: string;
  game: {
    turn: number;
    phase: string;
    activePlayerId: string;
    priorityPlayerId: string;
  };
  selfPlayerId: string;
  players: AgentPlayerObservation[];
  stack: AgentStackItem[];
}

export interface ForgeExternalMatchSnapshot {
  sessionId: string;
  status: ForgeExternalMatchStatus;
  progress: ForgeExternalMatchProgress;
  observation?: AgentObservation;
  pendingDecision?: ForgePendingDecision;
  result?: ForgeGameResult;
  error?: { code: string; message: string };
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
  start_external_match: {
    sessionId: string;
    status: "running";
  };
  get_external_match: ForgeExternalMatchSnapshot;
  submit_external_decision: { accepted: true };
  cancel_external_match: {
    sessionId: string;
    status: "cancelled";
    cancelled: true;
  };
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
