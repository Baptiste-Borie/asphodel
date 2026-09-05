/**
 * Mirrors the backend's playtest DTOs (forge-protocol.ts / playtest-session-manager.ts) field for
 * field, the same way the existing Deck Library view already duplicates its own backend shapes
 * (see deck-library-view.ts) rather than importing backend TypeScript into the browser bundle.
 */

/** Presentation-only metadata (backend cards/card-presentation-service.ts) — never a rules input. */
export interface CardPresentation {
  name: string;
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  oracleText: string | null;
  imageUri: string | null;
}

export type AgentCardZone = "hand" | "battlefield" | "graveyard" | "exile" | "command";

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
  combatKeywords?: string[] | null;
  selfAttackTriggers?: string[] | null;
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

export interface AgentSelfPlayerObservation extends AgentPlayerObservationBase {
  role: "self";
  hand: AgentCardObservation[];
}

export interface AgentOpponentPlayerObservation extends AgentPlayerObservationBase {
  role: "opponent";
}

export type AgentPlayerObservation = AgentSelfPlayerObservation | AgentOpponentPlayerObservation;

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
  game: { turn: number; phase: string; activePlayerId: string; priorityPlayerId: string };
  selfPlayerId: string;
  players: AgentPlayerObservation[];
  stack: AgentStackItem[];
}

export type AgentChoice = { decisionId: string; reason: string } & (
  | { kind: "action" | "target" | "mode" | "optional_cost" | "object" | "mana"; choice: string }
  | { kind: "value"; choice: number }
);

export interface MenuItem {
  label: string;
  choice: AgentChoice;
}

export type DecisionPrompt =
  | { kind: "menu"; title: string; items: MenuItem[] }
  | { kind: "value"; title: string; decisionId: string; min: number; max: number; suggested: number[] };

export interface WebPendingDecisionDTO {
  decisionId: string;
  type: string;
  context: { turn: number; phase: string; activePlayerId: string; priorityPlayerId: string; stackSize: number };
  rendered: DecisionPrompt;
}

export interface PublicGameEvent {
  id: number;
  turn: number;
  phase: string;
  text: string;
}

export interface ForgeGameResult {
  gameId: string;
  format: "commander" | "constructed";
  seed: number;
  winnerId: string | null;
  turns: number;
  gameOver: boolean;
  draw: boolean;
  terminalReason: string;
  commanderRulesActive: boolean;
}

export type WebPlaytestStatus = "starting" | "running" | "waiting_for_human" | "completed" | "ended_by_human" | "failed";

export interface WebPlaytestStateDTO {
  sessionId: string;
  status: WebPlaytestStatus;
  humanDeckName: string;
  asphodelDeckName: string;
  observation: AgentObservation | null;
  pendingDecision: WebPendingDecisionDTO | null;
  publicEvents: PublicGameEvent[];
  asphodelDecisionCount: number;
  endedByHuman: boolean;
  result: ForgeGameResult | null;
  error: string | null;
}

export type DeckInput =
  | { type: "fixture" }
  | { type: "library"; value: string }
  | { type: "archidekt"; value: string };

export interface StartPlaytestRequest {
  humanDeck: DeckInput;
  asphodelDeck: DeckInput;
  seed?: number;
}

export interface PlaytestReportDTO {
  directory: string;
  summaryPath: string;
  decisionsPath: string;
}
