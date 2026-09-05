import { randomUUID } from "node:crypto";
import { ForgeBridgeClient } from "../forge/forge-bridge-client.js";
import { ForgeExternalMatchClient } from "../forge/forge-external-match-client.js";
import { commanderFixtures } from "../forge/testing/commander-fixtures.js";
import type { AgentChoice, AsphodelAgent } from "../agent/baseline-agent.js";
import { BaselineAsphodelAgentV2b } from "../agent/improved-agent.js";
import type { AgentMatchTransport } from "../agent/agent-runner.js";
import type { AgentObservation, ForgeDeckSpec, ForgeGameResult } from "../forge/forge-protocol.js";
import type { DeckInput } from "../decks/deck-resolver.js";
import { resolveDeckInput } from "../decks/deck-resolver.js";
import { runHumanVsAgentMatch } from "./human-vs-agent-runner.js";
import { WebHumanDecisionProvider } from "./web-human-decision-provider.js";
import { DecisionRecorder } from "./decision-recorder.js";
import { describeAgentAction, describeDecision, type DecisionPrompt } from "./human-decision-render.js";
import { writePlaytestReport, type PlaytestReportResult } from "./playtest-report.js";

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

export interface StartPlaytestRequest {
  humanDeck: DeckInput;
  asphodelDeck: DeckInput;
  seed?: number;
}

export interface WebPendingDecisionDTO {
  decisionId: string;
  type: string;
  context: { turn: number; phase: string; activePlayerId: string; priorityPlayerId: string };
  /** Ready-to-render menu/value prompt (`describeDecision`, human-decision-render.ts) — the browser never re-derives choices from the raw Forge decision. */
  rendered: DecisionPrompt;
}

export interface WebPlaytestStateDTO {
  sessionId: string;
  status: WebPlaytestStatus;
  humanDeckName: string;
  asphodelDeckName: string;
  /** The HUMAN's own observation only — never Asphodel's. Null when it is not currently the human's turn. */
  observation: AgentObservation | null;
  pendingDecision: WebPendingDecisionDTO | null;
  publicEvents: PublicGameEvent[];
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
  startedAt: Date;
  bridge: PlaytestBridge;
  client: AgentMatchTransport;
  provider: WebHumanDecisionProvider;
  recorder: DecisionRecorder;
  events: PublicGameEvent[];
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

    const session: Session = {
      id: randomUUID(), humanDeckName: humanDeck.name, agentDeckName: agentDeck.name,
      seed: request.seed ?? 42, startedAt: new Date(), bridge, client,
      provider: new WebHumanDecisionProvider(), recorder: new DecisionRecorder(), events: [],
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
          onDecision: (owner, observation, decision, choice) => {
            if (owner !== "agent") return;
            session.recorder.record(observation, decision, choice);
            const text = describeAgentAction(observation, decision, choice);
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
    if (session.phase === "in_progress") return session.provider.current() ? "waiting_for_human" : "running";
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
    const pending = session.provider.current();
    return {
      sessionId: session.id, status: this.statusOf(session),
      humanDeckName: session.humanDeckName, asphodelDeckName: session.agentDeckName,
      observation: pending?.observation ?? null,
      pendingDecision: pending ? {
        decisionId: pending.decision.decisionId, type: pending.decision.type, context: pending.decision.context,
        rendered: describeDecision(pending.observation, pending.decision),
      } : null,
      publicEvents: session.events,
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
    if (session.phase !== "in_progress" || !session.provider.current()) {
      throw new PlaytestSessionError("NOT_WAITING_FOR_HUMAN", "The playtest is not currently waiting for a human decision.");
    }
    session.provider.submit(choice);
  }

  /** Requests the same voluntary end as V2d's CLI "end"/"quit", waits for it to actually finish (Forge cancelled, report written), and returns the settled state. */
  async end(sessionId: string): Promise<WebPlaytestStateDTO> {
    const session = this.requireSession(sessionId);
    if (session.phase !== "starting" && session.phase !== "in_progress") return this.getState(sessionId);
    session.provider.requestEnd();
    await session.runPromise;
    return this.getState(sessionId);
  }

  getReport(sessionId: string): PlaytestReportResult {
    const session = this.requireSession(sessionId);
    if (!session.reportResult) throw new PlaytestSessionError("REPORT_NOT_READY", "The playtest has not finished yet.");
    return session.reportResult;
  }
}
