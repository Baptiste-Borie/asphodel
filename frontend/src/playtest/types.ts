/**
 * Mirrors the backend's playtest DTOs (forge-protocol.ts / playtest-session-manager.ts) field for
 * field, the same way the existing Deck Library view already duplicates its own backend shapes
 * (see deck-library-view.ts) rather than importing backend TypeScript into the browser bundle.
 */

/** Presentation-only metadata (backend cards/card-presentation-service.ts) — never a rules input. */
export interface CardPresentation {
  artUri?: string | null;
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
  /** True for a Forge-generated token; absent on older bridges. Presentation-only (visual stacking) — never a rules input. */
  token?: boolean;
}

export interface AgentCommanderObservation {
  cardRef: string;
  name: string;
  inCommandZone: boolean;
  castsFromCommand: number;
  /**
   * V2h "COMMANDER TAX VISIBILITY": the generic-mana commander tax currently in effect — computed
   * bridge-side the exact same way Forge itself applies it to the real cast cost (see
   * backend/src/forge/forge-protocol.ts's field doc / `forge.game.cost.CostAdjustment`), never
   * recomputed here. `undefined` on an older bridge that predates this field — see
   * commander-tax.ts, which is the ONLY place allowed to read this and never defaults it to 0.
   */
  commanderTaxGeneric?: number;
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
  /** V2g: the human declares which real physical card(s) correspond to a hidden-zone event (draw, mill, scry reveal, …) — see `physical_declare`/`PhysicalDeclareCandidate` below. */
  | { kind: "physical_identity"; declaredNames: string[] }
);

export interface MenuItem {
  presentationName?: string;
  /** Presentation hint for an explicit Forge cancellation choice. */
  control?: "cancel" | "pass";
  /** Exact Forge player target, for board selection. */
  playerId?: string | null;
  label: string;
  choice: AgentChoice;
  /**
   * The Forge cardRef this action refers to (V2e.4) — populated only for `priority_action` items;
   * `undefined` for every other decision family, `null` for a card-less action (e.g. "Pass
   * priority"). A stable id, never a name — two same-named cards (two Mountains) stay distinct.
   */
  cardRef?: string | null;
}

/**
 * V2g "Physical Companion": one candidate real card the human might be declaring (name +
 * remaining count still unaccounted for in the physical deck/zone this decision is about) — never
 * a rules input, purely what the backend's `ManualPhysicalCardProvider` currently considers legal.
 */
export interface PhysicalDeclareCandidate {
  name: string;
  remaining: number;
}

export type DecisionPrompt =
  | { kind: "opening_hand"; title: string; items: MenuItem[] }
  | { kind: "card_picker"; title: string; items: MenuItem[]; selected: string[]; minSelections: number; maxSelections: number }

  | { kind: "menu"; title: string; items: MenuItem[] }
  | { kind: "value"; title: string; decisionId: string; min: number; max: number; suggested: number[] }
  /**
   * V2g: the human declares which real card(s) correspond to a hidden-zone event — draw (including
   * the very first opening hand, which is simply `eventKind: "draw"`, `count: 7` the first time it
   * appears; there is no separate opening-hand decision kind), mill, exile-from-library,
   * library-to-battlefield/command, a generic library event, or a scry/surveil reveal. `title` is
   * already a fully-formed human string from the backend (e.g. "Declare your opening hand") — never
   * re-derive a title from `eventKind` in the UI.
   */
  | {
      kind: "physical_declare";
      title: string;
      decisionId: string;
      eventKind: "draw" | "mill" | "exile_from_library" | "library_to_battlefield" | "library_to_command" | "library_event" | "scry_reveal" | "surveil_reveal";
      count: number;
      candidates: PhysicalDeclareCandidate[];
    };

export interface WebPendingDecisionDTO {
  decisionId: string;
  type: string;
  context: { turn: number; phase: string; activePlayerId: string; priorityPlayerId: string; stackSize: number };
  rendered: DecisionPrompt;
  /** V2e.6: Forge's own currently-declared attackers/blockers, as cardRefs — null outside attackers_selection/blockers_selection. Never derived from tapped state. */
  selectedCardRefs: string[] | null;
  /**
   * V2h "COMBAT READABILITY": the same declared attacker/blocker set as `selectedCardRefs`, but
   * keeping Forge's own pairing (`relatedRef` — the defending player for an attacker, or the
   * attacker's cardRef for a blocker) — see combat-selection.ts's `combatRelations`. `null` outside
   * attackers_selection/blockers_selection.
   */
  combatPairings: { cardRef: string; relatedRef: string }[] | null;
}

export interface PublicGameEvent {
  id: number;
  turn: number;
  phase: string;
  text: string;
}

/**
 * One step of Asphodel's turn the human is allowed to watch (V2e.3) — always human-safe: never
 * Asphodel's own hand, never a hidden/agent-only field. `event` mirrors a `PublicGameEvent` when
 * this step is worth narrating in the timeline, or is `null` for a state change with nothing to
 * say (e.g. a mana ability tapping a land) — the frame is still captured so the board updates.
 */
export interface PublicGameFrame {
  id: number;
  event: PublicGameEvent | null;
  observation: AgentObservation;
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
  /**
   * V2h.1 "MANA/PAYMENT OVERLAY LIFECYCLE": true while the human's most recently PROCESSED decision
   * (not merely the most recent poll) was a `mana_payment` step — see `mana-payment-lifecycle.ts`
   * and `PlaytestSessionManager`'s own doc comment on this same field. The one reliable "is this
   * still the same payment sequence" signal, independent of whether `pendingDecision` is null right
   * now (Forge computing the next step, or the human's next priority getting auto-passed).
   */
  manaPaymentActive: boolean;
  publicEvents: PublicGameEvent[];
  frames: PublicGameFrame[];
  asphodelDecisionCount: number;
  endedByHuman: boolean;
  result: ForgeGameResult | null;
  error: string | null;
  /** V2g: always present — "digital" (today's symmetric Obsidian Table) or "physical" (compact human mirror, see seat-presentation.ts). */
  playMode: "digital" | "physical";
}

export type DeckInput =
  | { type: "fixture" }
  | { type: "library"; value: string }
  | { type: "archidekt"; value: string };

export interface StartPlaytestRequest {
  humanDeck: DeckInput;
  asphodelDeck: DeckInput;
  seed?: number;
  /** V2g: "digital" (default, today's Obsidian Table) or "physical" (Physical Companion — the human plays a real deck). Omitted is treated as "digital" by the backend. */
  playMode?: "digital" | "physical";
}

export interface PlaytestReportDTO {
  directory: string;
  summaryPath: string;
  decisionsPath: string;
}
