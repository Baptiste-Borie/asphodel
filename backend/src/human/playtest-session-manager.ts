import { randomUUID } from "node:crypto";
import { ForgeBridgeClient } from "../forge/forge-bridge-client.js";
import { ForgeExternalMatchClient } from "../forge/forge-external-match-client.js";
import { commanderFixtures } from "../forge/testing/commander-fixtures.js";
import type { AgentChoice, AsphodelAgent } from "../agent/baseline-agent.js";
import { BaselineAsphodelAgentV2b } from "../agent/improved-agent.js";
import type { AgentMatchTransport } from "../agent/agent-runner.js";
import type { AgentCardObservation, AgentObservation, ForgeDeckSpec, ForgeGameResult } from "../forge/forge-protocol.js";
import type { DeckInput } from "../decks/deck-resolver.js";
import { resolveDeckInput } from "../decks/deck-resolver.js";
import type { DecisionOwner } from "./human-vs-agent-runner.js";
import { runHumanVsAgentMatch } from "./human-vs-agent-runner.js";
import { WebHumanDecisionProvider } from "./web-human-decision-provider.js";
import { DecisionRecorder } from "./decision-recorder.js";
import { describeAgentAction, describeDecision, describePhysicalDeclare, type DecisionPrompt } from "./human-decision-render.js";
import { sanitizeAgentObservation, type HumanSafePublicBoardObservation, type PublicGameFrame } from "./public-game-frame.js";
import { describeObservationDelta } from "./public-event-delta.js";
import { buildCommanderCastSnapshot, logCommanderCastDiagnostics, type CommanderCastSnapshot } from "./commander-cast-diagnostics.js";
import { writePlaytestReport, type PlaytestReportResult, type RecordedPhysicalDeclaration } from "./playtest-report.js";
import { ManualPhysicalCardProvider } from "../physical/physical-card-provider.js";
import { deckCompositionFrom, PhysicalLedger } from "../physical/physical-ledger.js";
import { redactPendingPhysicalIdentity } from "../physical/physical-observation-redaction.js";

/** The only two things the manager needs from a running bridge process — real or faked in tests. */
export interface PlaytestBridge {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
}

export interface PlaytestSessionManagerDeps {
  createBridge?: () => PlaytestBridge;
  createClient?: (bridge: PlaytestBridge) => AgentMatchTransport;
  createAgent?: () => AsphodelAgent;
  /** Test-only override for where writePlaytestReport writes; defaults to backend/playtest-reports/. */
  reportsRoot?: string;
}

const HUMAN_PLAYER_ID = "player-1";
const AGENT_PLAYER_ID = "player-2";

export type WebPlaytestStatus = "starting" | "running" | "waiting_for_human" | "completed" | "ended_by_human" | "failed";
const TERMINAL_STATUSES: ReadonlySet<WebPlaytestStatus> = new Set(["completed", "ended_by_human", "failed"]);

export interface PublicGameEvent {
  id: number;
  turn: number;
  phase: string;
  text: string;
}

/**
 * V2g §1: the playtest session's presentation/input-mode. Both modes drive the exact same Forge
 * match — this never forks game semantics, only which side supplies hidden-zone card identities
 * and how the frontend renders the human seat (see `TableSeatPresentation` on the frontend).
 */
export type PlayMode = "digital" | "physical";

export interface StartPlaytestRequest {
  humanDeck: DeckInput;
  asphodelDeck: DeckInput;
  seed?: number;
  /** Defaults to "digital" — omitting it never changes existing behavior. */
  playMode?: PlayMode;
}

export interface WebPendingDecisionDTO {
  decisionId: string;
  type: string;
  context: { turn: number; phase: string; activePlayerId: string; priorityPlayerId: string };
  /** Ready-to-render menu/value prompt (`describeDecision`, human-decision-render.ts) — the browser never re-derives choices from the raw Forge decision. */
  rendered: DecisionPrompt;
  /**
   * V2e.6: Forge's own currently-declared attackers/blockers, relayed verbatim as cardRefs — so the
   * tabletop can show a distinct "this card is selected as an attacker/blocker" visual, completely
   * separate from `tapped`. `null` for every decision type other than `attackers_selection`/
   * `blockers_selection` (never fabricated for other families, and never derived from tapped state).
   */
  selectedCardRefs: string[] | null;
  /**
   * V2h "COMBAT READABILITY": the exact same declared attacker/blocker set as `selectedCardRefs`,
   * but keeping Forge's own pairing (`relatedRef` — the defending player for an attacker, or the
   * attacker's own cardRef for a blocker) that `selectedCardRefs` flattens away. Relayed verbatim
   * from `ForgePendingCombatDecision.selected`, never derived/guessed on this side. `null` for every
   * decision type other than `attackers_selection`/`blockers_selection`.
   */
  combatPairings: { cardRef: string; relatedRef: string }[] | null;
}

export interface WebPlaytestStateDTO {
  sessionId: string;
  status: WebPlaytestStatus;
  playMode: PlayMode;
  humanDeckName: string;
  asphodelDeckName: string;
  /** The HUMAN's own observation only — never Asphodel's. Null when it is not currently the human's turn. */
  observation: AgentObservation | null;
  pendingDecision: WebPendingDecisionDTO | null;
  /**
   * V2h.1 "MANA/PAYMENT OVERLAY LIFECYCLE": true from the moment the human's most recent DECISION
   * (not merely the most recent DTO poll) was a `mana_payment` step, until a subsequent decision —
   * of ANY type, for EITHER seat — is actually processed. A transient `pendingDecision: null` poll
   * mid-sequence (Forge still computing the next payment step) leaves this `true`; the first decision
   * genuinely following the payment — even one invisible to the frontend, like an auto-passed human
   * priority or the very next Asphodel decision — flips it `false`. This is the one reliable signal
   * that distinguishes "still the same payment" from "payment has truly ended", independent of
   * whether `pendingDecision` itself happens to be null right now — see `session.manaPaymentActive`
   * and its `onDecision` update below.
   */
  manaPaymentActive: boolean;
  publicEvents: PublicGameEvent[];
  /**
   * Ordered, human-safe snapshots of Asphodel's turn in progress (V2e.3) — never Asphodel's own
   * `AgentObservation` raw; see `sanitizeAgentObservation`. The full list every poll (same
   * always-authoritative, browser-dedupes-itself shape as `publicEvents`); the frontend plays
   * unseen ids back in order with a short delay instead of jumping straight to the final board.
   */
  frames: PublicGameFrame[];
  asphodelDecisionCount: number;
  endedByHuman: boolean;
  result: ForgeGameResult | null;
  error: string | null;
}

export type PlaytestSessionErrorCode = "PLAYTEST_ALREADY_RUNNING" | "SESSION_NOT_FOUND" | "NOT_WAITING_FOR_HUMAN" | "REPORT_NOT_READY";

export class PlaytestSessionError extends Error {
  constructor(
    public readonly code: PlaytestSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlaytestSessionError";
  }
}

interface Session {
  id: string;
  humanDeckName: string;
  agentDeckName: string;
  seed: number;
  playMode: PlayMode;
  startedAt: Date;
  bridge: PlaytestBridge;
  client: AgentMatchTransport;
  provider: WebHumanDecisionProvider;
  /** Non-null only in physical mode — see `PlayMode`. */
  physicalProvider: ManualPhysicalCardProvider | null;
  physicalLedger: PhysicalLedger | null;
  physicalDeclarations: RecordedPhysicalDeclaration[];
  /**
   * V2h.2 "K'RRIK FORENSICS": one entry per HUMAN `priority_action` decision where a commander sat
   * in the command zone — unconditional (no `ASPHODEL_DEBUG_COMMANDER_CAST` toggle needed, unlike
   * `commander-cast-diagnostics.ts`'s console path), so a real "Cast <commander>" unavailability is
   * actually reviewable after the fact instead of requiring the toggle to have been set in advance.
   * See `buildCommanderCastSnapshot`'s own doc comment and `playtest-report.ts`'s new section.
   */
  commanderCastSnapshots: CommanderCastSnapshot[];
  /** Last observation genuinely captured for the human seat — kept fresh across a pending physical
   *  declaration too (which carries no observation of its own in `getState()`'s DTO otherwise),
   *  so the compact human board mirror never goes blank while a declaration is pending. */
  lastObservation: AgentObservation | null;
  /**
   * V2g.2 "PHYSICAL DRAW PRESENTATION BUG": the human's last observation known to be FULLY
   * reconciled — unlike `lastObservation` above, this deliberately does NOT advance when the
   * decision that just resolved was itself a `physical_identity_declare` (its own leading
   * observation is exactly the pre-reconciliation snapshot `redactPendingPhysicalIdentity` exists
   * to redact — using it as next time's "known-good" baseline would make that redaction itself
   * unreliable). The sole baseline for `redactPendingPhysicalIdentity` in `getState()`.
   */
  lastReconciledObservation: AgentObservation | null;
  /**
   * V2h.1 "MANA/PAYMENT OVERLAY LIFECYCLE" — see `WebPlaytestStateDTO.manaPaymentActive`'s doc
   * comment. Updated unconditionally in `onDecision` below, for every decision of either seat.
   */
  manaPaymentActive: boolean;
  recorder: DecisionRecorder;
  events: PublicGameEvent[];
  frames: PublicGameFrame[];
  /** The human's own hand from the last time it was genuinely their observation — carried into sanitized frames captured mid-Asphodel-turn, since an agent-self observation never contains it at all. */
  lastHumanHand: AgentCardObservation[];
  /** Text for the NEXT frame, stashed from the agent decision that is about to resolve into it (see onDecision below) — null when there is nothing worth narrating (e.g. a mana ability tap). */
  pendingFrameEvent: { turn: number; phase: string; text: string } | null;
  /** The owner of the previously processed decision. A frame is captured only when this was "agent" — i.e. the incoming observation reflects a state Asphodel's own action just produced, regardless of who owns the decision that just arrived. */
  pendingFrameOwner: DecisionOwner | null;
  lastFrameObservationKey: string | null;
  /** The last sanitized public observation a frame was actually pushed for — the "previous" side of `describeObservationDelta` (V2h "RECENT ACTIONS"), so a life change / new arrival during Asphodel's turn is narrated even when `describeAgentAction` itself had nothing to say (e.g. a triggered ability, not a direct cast). `null` before the first agent-owned frame. */
  lastNarratedObservation: HumanSafePublicBoardObservation | null;
  phase: "starting" | "in_progress" | "completed" | "ended_by_human" | "failed";
  result: ForgeGameResult | null;
  errorMessage: string | null;
  reportResult: PlaytestReportResult | null;
  runPromise: Promise<void>;
}

/**
 * One active playtest at a time — a personal tool, not a multi-user/distributed system. Owns the
 * bridge/transport/provider/agent/recorder and drives them through the existing
 * `runHumanVsAgentMatch` (V2c) in a background promise so Fastify keeps serving HTTP while a game
 * is in progress. No second game engine, no manual board reconstruction: every field this manager
 * exposes comes straight from Forge's own snapshot/observation or from the already-existing V2c/V2d
 * pieces (`WebHumanDecisionProvider.current()`, `DecisionRecorder`, `writePlaytestReport`).
 */
export class PlaytestSessionManager {
  private session: Session | null = null;
  private readonly createBridge: () => PlaytestBridge;
  private readonly createClient: (bridge: PlaytestBridge) => AgentMatchTransport;
  private readonly createAgent: () => AsphodelAgent;
  private readonly reportsRoot: string | undefined;

  constructor(deps: PlaytestSessionManagerDeps = {}) {
    this.createBridge = deps.createBridge ?? (() => new ForgeBridgeClient());
    this.createClient = deps.createClient ?? (bridge => new ForgeExternalMatchClient(bridge as ForgeBridgeClient));
    this.createAgent = deps.createAgent ?? (() => new BaselineAsphodelAgentV2b());
    this.reportsRoot = deps.reportsRoot;
  }

  async start(request: StartPlaytestRequest): Promise<{ sessionId: string; status: WebPlaytestStatus }> {
    if (this.session && !TERMINAL_STATUSES.has(this.statusOf(this.session))) {
      throw new PlaytestSessionError("PLAYTEST_ALREADY_RUNNING", "A playtest is already running. End it before starting another.");
    }

    const [defaultHumanDeck, defaultAgentDeck] = commanderFixtures();
    const [humanDeck, agentDeck] = await Promise.all([
      resolveDeckInput(request.humanDeck, defaultHumanDeck),
      resolveDeckInput(request.asphodelDeck, defaultAgentDeck),
    ]);

    const bridge = this.createBridge();
    await bridge.start();
    const client = this.createClient(bridge);

    const playMode: PlayMode = request.playMode ?? "digital";
    const session: Session = {
      id: randomUUID(), humanDeckName: humanDeck.name, agentDeckName: agentDeck.name,
      seed: request.seed ?? 42, playMode, startedAt: new Date(), bridge, client,
      provider: new WebHumanDecisionProvider(),
      // V2g: only the physical seat ever gets a provider/ledger; digital mode leaves both null and
      // is otherwise byte-for-byte the same session shape as before this milestone.
      physicalProvider: playMode === "physical" ? new ManualPhysicalCardProvider() : null,
      physicalLedger: playMode === "physical" ? new PhysicalLedger(deckCompositionFrom(humanDeck)) : null,
      physicalDeclarations: [],
      commanderCastSnapshots: [],
      lastObservation: null,
      lastReconciledObservation: null,
      manaPaymentActive: false,
      recorder: new DecisionRecorder(), events: [],
      frames: [], lastHumanHand: [], pendingFrameEvent: null, pendingFrameOwner: null, lastFrameObservationKey: null,
      lastNarratedObservation: null,
      phase: "starting", result: null, errorMessage: null, reportResult: null,
      runPromise: Promise.resolve(),
    };
    this.session = session;
    session.runPromise = this.runMatch(session, [humanDeck, agentDeck]);
    return { sessionId: session.id, status: this.statusOf(session) };
  }

  private async runMatch(session: Session, decks: [ForgeDeckSpec, ForgeDeckSpec]): Promise<void> {
    session.phase = "in_progress";
    try {
      const agent = this.createAgent();
      const run = await runHumanVsAgentMatch(
        session.client, session.provider, agent, decks,
        HUMAN_PLAYER_ID, AGENT_PLAYER_ID,
        {
          seed: session.seed,
          endRequested: session.provider.endRequested,
          ...(session.physicalProvider ? { physicalCardProvider: session.physicalProvider } : {}),
          onPhysicalDeclaration: (decision, declaredNames) => {
            session.physicalLedger?.observe(decision);
            session.physicalDeclarations.push({
              decisionId: decision.decisionId, turn: decision.context.turn, phase: decision.context.phase,
              eventKind: decision.eventKind, count: decision.count, declaredNames,
            });
          },
          // `observation` here is always the state that LED TO `decision` — i.e. the state Asphodel's
          // previous action (if any) actually produced. So a frame representing the PREVIOUS agent
          // decision's result is captured here, one iteration later, using THIS decision's incoming
          // observation. Only while BOTH the previous and the current decision belong to Asphodel:
          // the very first agent decision after a human turn needs no frame (the human already saw
          // that exact board live), and the final agent->human transition needs none either — Magic's
          // own priority rules mean Asphodel always gets one more decision (typically "pass") after
          // its last real action before priority actually reaches the human, so that final real
          // action is already captured here one step early; the human's own already-isolated
          // `observation`/`pendingDecision` fields expose the (by then unchanged) settled board the
          // instant it is genuinely their turn — no second, redundant frame is needed for that.
          onDecision: (owner, observation, decision, choice) => {
            // V2h.1 "MANA/PAYMENT OVERLAY LIFECYCLE": unconditional, on EVERY decision (either seat,
            // including one auto-passed for the human and so otherwise invisible to the frontend —
            // see WebPlaytestStateDTO.manaPaymentActive's doc comment). This is what lets getState()
            // tell "still the same payment sequence" apart from "a real decision has since moved the
            // game past it", independent of whether `pendingDecision` itself is null right now.
            session.manaPaymentActive = owner === "human" && decision.type === "mana_payment";
            if (owner === "agent" && session.pendingFrameOwner === "agent") {
              const safeObservation = sanitizeAgentObservation(observation, HUMAN_PLAYER_ID, session.lastHumanHand);
              const key = JSON.stringify(safeObservation);
              if (session.pendingFrameEvent !== null || key !== session.lastFrameObservationKey) {
                const frameId = session.frames.length + 1;
                const event = session.pendingFrameEvent ? { id: frameId, ...session.pendingFrameEvent } : null;
                session.frames.push({ id: frameId, event, observation: safeObservation });
                session.lastFrameObservationKey = key;
                // V2h "RECENT ACTIONS": life changes and new non-land arrivals during Asphodel's turn,
                // on top of whatever describeAgentAction already said for the action that caused them
                // (a triggered ability's life loss, e.g., has no priority_action of its own to narrate).
                for (const text of describeObservationDelta(session.lastNarratedObservation, safeObservation)) {
                  session.events.push({ id: session.events.length + 1, turn: decision.context.turn, phase: decision.context.phase, text });
                }
                session.lastNarratedObservation = safeObservation;
              }
            }
            if (owner === "human") {
              // V2h.2 "K'RRIK FORENSICS": unconditional (see CommanderCastSnapshot's own doc
              // comment) — captured here, once per decision, rather than in getState() (polled
              // many times per decision), so a real occurrence leaves exactly one reviewable entry.
              if (decision.type === "priority_action") {
                const snapshot = buildCommanderCastSnapshot(observation, decision);
                if (snapshot) session.commanderCastSnapshots.push(snapshot);
              }
              const self = observation.players.find(p => p.role === "self");
              if (self) session.lastHumanHand = self.hand;
              session.lastObservation = observation;
              // V2g.2: a physical_identity_declare's OWN leading observation is exactly the
              // pre-reconciliation snapshot (see `lastReconciledObservation`'s doc comment) — never
              // promoted to "known-good", or the very next physical decision's redaction baseline
              // would itself be tainted.
              if (decision.type !== "physical_identity_declare") session.lastReconciledObservation = observation;
              session.pendingFrameEvent = null;
              session.pendingFrameOwner = "human";
              return;
            }
            session.recorder.record(observation, decision, choice);
            const text = describeAgentAction(observation, decision, choice);
            session.pendingFrameEvent = text ? { turn: decision.context.turn, phase: decision.context.phase, text } : null;
            session.pendingFrameOwner = "agent";
            if (text) session.events.push({ id: session.events.length + 1, turn: decision.context.turn, phase: decision.context.phase, text });
          },
        },
      );
      session.result = run.snapshot.result ?? null;
      // Written BEFORE the phase flips to terminal, so status "completed"/"ended_by_human" is a
      // reliable external guarantee that the report already exists — never a race to poll around.
      session.reportResult = await writePlaytestReport({
        startedAt: session.startedAt, sessionId: session.id, seed: session.seed,
        humanDeckName: session.humanDeckName, agentDeckName: session.agentDeckName,
        humanPlayerId: HUMAN_PLAYER_ID, agentPlayerId: AGENT_PLAYER_ID,
        endedByHuman: run.endedByHuman, snapshot: run.snapshot, decisions: session.recorder.all(),
        playMode: session.playMode, physicalDeclarations: session.physicalDeclarations,
        commanderCastSnapshots: session.commanderCastSnapshots,
        ...(this.reportsRoot === undefined ? {} : { reportsRoot: this.reportsRoot }),
      });
      session.phase = run.endedByHuman ? "ended_by_human" : "completed";
    } catch (error) {
      session.phase = "failed";
      session.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      await session.bridge.stop().catch(() => { /* best-effort shutdown */ });
    }
  }

  private statusOf(session: Session): WebPlaytestStatus {
    if (session.phase === "starting") return "starting";
    if (session.phase === "in_progress") {
      return (session.provider.current() || session.physicalProvider?.current()) ? "waiting_for_human" : "running";
    }
    return session.phase;
  }

  private requireSession(sessionId: string): Session {
    if (!this.session || this.session.id !== sessionId) {
      throw new PlaytestSessionError("SESSION_NOT_FOUND", `No playtest exists for sessionId "${sessionId}".`);
    }
    return this.session;
  }

  /** The human's own observation and a ready-to-render decision — Asphodel's hand/observation is never reachable through this manager. */
  getState(sessionId: string): WebPlaytestStateDTO {
    const session = this.requireSession(sessionId);
    // V2g: a physical declaration always takes priority when pending — the two channels are never
    // simultaneously pending in practice (see human-vs-agent-runner.ts's dispatch), but preferring
    // the physical one here is the defensive, well-defined choice either way.
    const physicalPending = session.physicalProvider?.current();
    const pending = session.provider.current();
    // V2h "K'RRIK REAL-MATCH ISSUE": opt-in diagnostic only (see commander-cast-diagnostics.ts) —
    // a no-op unless ASPHODEL_DEBUG_COMMANDER_CAST=1 is set.
    if (pending && pending.decision.type === "priority_action") {
      logCommanderCastDiagnostics(pending.observation, pending.decision);
    }
    // V2g.2 "PHYSICAL DRAW PRESENTATION BUG": `physicalPending.observation` is built strictly BEFORE
    // reconciliation (see docs/physical-companion-v0.md §2.1) — it is Forge's own provisional,
    // undeclared pick for exactly the zone this decision is about, never the physical human's real
    // card. Redacted here, once, at the single seam every consumer of this DTO (compact hand
    // verifier, the full physical-scene hand render, aria-labels, ...) reads through, rather than in
    // each frontend render call — see `redactPendingPhysicalIdentity`'s own doc comment.
    const physicalObservation = physicalPending?.observation
      ? redactPendingPhysicalIdentity(physicalPending.observation, physicalPending.request.eventKind, session.lastReconciledObservation)
      : (session.lastObservation ?? null);
    return {
      sessionId: session.id, status: this.statusOf(session), playMode: session.playMode,
      humanDeckName: session.humanDeckName, asphodelDeckName: session.agentDeckName,
      observation: physicalPending ? physicalObservation : (pending?.observation ?? null),
      pendingDecision: physicalPending ? {
        decisionId: physicalPending.request.decisionId, type: "physical_identity_declare", context: physicalPending.request.context,
        rendered: describePhysicalDeclare(physicalPending.request),
        selectedCardRefs: null,
        combatPairings: null,
      } : pending ? {
        decisionId: pending.decision.decisionId, type: pending.decision.type, context: pending.decision.context,
        rendered: describeDecision(pending.observation, pending.decision),
        selectedCardRefs: (pending.decision.type === "attackers_selection" || pending.decision.type === "blockers_selection")
          ? pending.decision.selected.map(s => s.cardRef) : null,
        combatPairings: (pending.decision.type === "attackers_selection" || pending.decision.type === "blockers_selection")
          ? pending.decision.selected.map(s => ({ cardRef: s.cardRef, relatedRef: s.relatedRef })) : null,
      } : null,
      manaPaymentActive: session.manaPaymentActive,
      publicEvents: session.events,
      frames: session.frames,
      asphodelDecisionCount: session.recorder.all().length,
      endedByHuman: session.phase === "ended_by_human",
      result: session.result,
      error: session.errorMessage,
    };
  }

  /**
   * The one active (non-terminal) playtest, if any — lets a browser reconnect after a page
   * reload without starting a second Forge game: the session itself already keeps running in its
   * background promise regardless of whether any browser is polling it.
   */
  getActiveState(): WebPlaytestStateDTO | null {
    if (!this.session || TERMINAL_STATUSES.has(this.statusOf(this.session))) return null;
    return this.getState(this.session.id);
  }

  submitChoice(sessionId: string, choice: AgentChoice): void {
    const session = this.requireSession(sessionId);
    if (session.phase !== "in_progress") {
      throw new PlaytestSessionError("NOT_WAITING_FOR_HUMAN", "The playtest is not currently waiting for a human decision.");
    }
    // V2g: the SAME generic `/choice` route carries a physical declaration too — routed by choice
    // kind, never a separate endpoint (spec §7's manual-entry UX still posts through one channel).
    if (choice.kind === "physical_identity") {
      if (!session.physicalProvider?.current()) {
        throw new PlaytestSessionError("NOT_WAITING_FOR_HUMAN", "The playtest is not currently waiting for a physical declaration.");
      }
      session.physicalProvider.submit(choice.decisionId, choice.declaredNames);
      return;
    }
    if (!session.provider.current()) {
      throw new PlaytestSessionError("NOT_WAITING_FOR_HUMAN", "The playtest is not currently waiting for a human decision.");
    }
    session.provider.submit(choice);
  }

  /** Requests the same voluntary end as V2d's CLI "end"/"quit", waits for it to actually finish (Forge cancelled, report written), and returns the settled state. */
  async end(sessionId: string): Promise<WebPlaytestStateDTO> {
    const session = this.requireSession(sessionId);
    if (session.phase !== "starting" && session.phase !== "in_progress") return this.getState(sessionId);
    session.provider.requestEnd();
    session.physicalProvider?.requestEnd();
    await session.runPromise;
    return this.getState(sessionId);
  }

  getReport(sessionId: string): PlaytestReportResult {
    const session = this.requireSession(sessionId);
    if (!session.reportResult) throw new PlaytestSessionError("REPORT_NOT_READY", "The playtest has not finished yet.");
    return session.reportResult;
  }
}
