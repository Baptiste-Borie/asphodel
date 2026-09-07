import type { AgentObservation, ForgePendingPhysicalIdentityDecision } from "../forge/forge-protocol.js";

export interface PhysicalCardCandidate {
  name: string;
  /** Authoritative — Forge's own current remaining-library count for this exact name. */
  remaining: number;
}

/**
 * One physical hidden-zone event that needs a real-world card identity: Forge silently placed
 * `count` cards into one of the physical player's zones using its own internally-shuffled library
 * order (a draw, a mill, an opening hand, a scry/surveil reveal, ...), and the physical human must
 * declare which real cards those actually are before the game can continue. `candidates` already
 * accounts for every copy already placed elsewhere — see docs/physical-companion-v0.md.
 */
export interface PhysicalCardRequest {
  decisionId: string;
  playerId: string;
  context: { turn: number; phase: string; activePlayerId: string; priorityPlayerId: string };
  eventKind: ForgePendingPhysicalIdentityDecision["eventKind"];
  count: number;
  candidates: PhysicalCardCandidate[];
}

export interface PhysicalCardSelection {
  declaredNames: string[];
}

/**
 * The seam a physical hidden-zone event resolves through. `human-vs-agent-runner.ts` depends only
 * on this narrow contract — never on `WebHumanDecisionProvider`/`AgentChoice` — so a future
 * `CameraPhysicalCardProvider` (recognizing a card from a video frame) can answer a
 * `PhysicalCardRequest` without the browser, without a human typing anything, and without any
 * change to the runner or the Forge bridge. `ManualPhysicalCardProvider` is the only V0
 * implementation.
 */
export interface PhysicalCardProvider {
  /**
   * `observation` is presentation-only diagnostic context (the human's own board, for a compact
   * mirror rendered alongside the prompt) — never required to answer the request, and never the
   * physical human's actual source of truth (they look at their real cards, not the screen). A
   * `CameraPhysicalCardProvider` can ignore the parameter entirely.
   */
  chooseCard(request: PhysicalCardRequest, observation?: AgentObservation): Promise<PhysicalCardSelection>;
}

export type ManualPhysicalCardProviderErrorCode =
  | "NO_PENDING_REQUEST"
  | "STALE_REQUEST"
  | "DECLARED_COUNT_MISMATCH"
  | "DECLARED_NAME_NOT_FOUND";

export class ManualPhysicalCardProviderError extends Error {
  constructor(
    public readonly code: ManualPhysicalCardProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ManualPhysicalCardProviderError";
  }
}

class PhysicalEndMatchError extends Error {}

/**
 * V0: the human answers through the browser. Mirrors `WebHumanDecisionProvider`'s exact "one
 * pending item, resolved by submit()" contract, but scoped to the narrow `PhysicalCardProvider`
 * shape instead of a full `AgentChoice` — kept as an independent channel (not layered on top of
 * `WebHumanDecisionProvider`) so the two can be pending at different times without one leaking into
 * the other's transport details.
 */
export class ManualPhysicalCardProvider implements PhysicalCardProvider {
  private pending:
    | { request: PhysicalCardRequest; observation: AgentObservation | undefined; resolve: (selection: PhysicalCardSelection) => void; reject: (error: unknown) => void }
    | undefined;
  private ended = false;

  async chooseCard(request: PhysicalCardRequest, observation?: AgentObservation): Promise<PhysicalCardSelection> {
    if (this.ended) throw new PhysicalEndMatchError();
    return new Promise<PhysicalCardSelection>((resolve, reject) => {
      this.pending = { request, observation, resolve, reject };
    });
  }

  /** The physical declaration currently awaiting a browser answer, or null. */
  current(): { request: PhysicalCardRequest; observation: AgentObservation | undefined } | null {
    return this.pending ? { request: this.pending.request, observation: this.pending.observation } : null;
  }

  /** Answers the pending request. Throws (submits nothing) on a stale id or an illegal declaration. */
  submit(decisionId: string, declaredNames: string[]): void {
    const pending = this.pending;
    if (!pending) throw new ManualPhysicalCardProviderError("NO_PENDING_REQUEST", "There is no pending physical declaration to answer right now.");
    if (decisionId !== pending.request.decisionId) {
      throw new ManualPhysicalCardProviderError("STALE_REQUEST", "This physical declaration has already been answered or is no longer current.");
    }
    if (declaredNames.length !== pending.request.count) {
      throw new ManualPhysicalCardProviderError("DECLARED_COUNT_MISMATCH", `Expected exactly ${pending.request.count} declared card(s).`);
    }
    const remaining = new Map(pending.request.candidates.map(c => [c.name, c.remaining]));
    for (const name of declaredNames) {
      const left = remaining.get(name) ?? 0;
      if (left <= 0) throw new ManualPhysicalCardProviderError("DECLARED_NAME_NOT_FOUND", `"${name}" is not a legal remaining candidate.`);
      remaining.set(name, left - 1);
    }
    this.pending = undefined;
    pending.resolve({ declaredNames });
  }

  /** Mirrors `WebHumanDecisionProvider.requestEnd()` — rejects an in-flight declaration immediately. */
  requestEnd(): void {
    this.ended = true;
    const pending = this.pending;
    if (pending) {
      this.pending = undefined;
      pending.reject(new PhysicalEndMatchError());
    }
  }
}

export function isPhysicalEndMatchError(error: unknown): boolean {
  return error instanceof PhysicalEndMatchError;
}
