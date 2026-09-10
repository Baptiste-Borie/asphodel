import type { PublicGameFrame } from "./types.js";

/**
 * The one place these pacing constants live (V2e.5/V2h) — change them here to retune every
 * playback speed. Three importance tiers (V2h "AI PLAYBACK PACING", roughly following the spec's
 * suggested ranges):
 *   - LOW: no narratable event at all (e.g. a mana ability tapping a land mid-payment).
 *   - MEDIUM: a land played, or an activated ability — a real but modest step.
 *   - HIGH: a spell cast, an attack declaration, a block — the moments a human most needs a beat to
 *     actually register before the next thing happens.
 * `OPPONENT_ACTION_DELAY_MS`/`OPPONENT_MINOR_DELAY_MS` are the pre-V2h names for the HIGH/LOW
 * tiers, kept as the exact values a caller (or a future speed setting) reads for those two tiers.
 */
export const OPPONENT_ACTION_DELAY_MS = 900;
export const OPPONENT_MEDIUM_DELAY_MS = 700;
export const OPPONENT_MINOR_DELAY_MS = 600;

export type FrameImportance = "low" | "medium" | "high";

const IMPORTANCE_DELAY_MS: Readonly<Record<FrameImportance, number>> = {
  low: OPPONENT_MINOR_DELAY_MS,
  medium: OPPONENT_MEDIUM_DELAY_MS,
  high: OPPONENT_ACTION_DELAY_MS,
};

/** A spell cast, an attack declared, or a block — the events worth the longest, most readable pause. */
const HIGH_IMPORTANCE_PATTERN = /\bcasts?\b|\battacks? with\b|\bblocks?\b/i;
/** A land played or an ability activated — a real, narratable step, but a shorter one than the above. */
const MEDIUM_IMPORTANCE_PATTERN = /\bplays?\b|\bactivates?\b/i;

/**
 * Pure. Classifies one frame's pacing importance purely from whether/what it narrates — never from
 * raw Forge data, only the same human-readable `event.text` already used for Recent Actions (see
 * `describeAgentAction`, backend/src/human/human-decision-render.ts). A frame with no event at all
 * is always LOW; a narrated event this doesn't recognize defaults to MEDIUM (a real step, just not
 * one of the two named-and-tuned patterns above) — never silently collapsed to LOW, which would
 * under-pace a future event kind nobody has classified yet.
 */
export function classifyFrameImportance(frame: Pick<PublicGameFrame, "event">): FrameImportance {
  if (!frame.event) return "low";
  if (HIGH_IMPORTANCE_PATTERN.test(frame.event.text)) return "high";
  if (MEDIUM_IMPORTANCE_PATTERN.test(frame.event.text)) return "medium";
  return "medium";
}

/**
 * Pure. Paces individual actions generously in the common case, but caps how long a big backlog
 * takes to catch up — order is always preserved, only the per-frame wait shrinks as the queue
 * grows (a "reasonable accelerated catch-up", never abandoning any frame).
 */
export function computePlaybackDelayMs(frame: Pick<PublicGameFrame, "event">, remainingAfterThisFrame: number): number {
  const base = IMPORTANCE_DELAY_MS[classifyFrameImportance(frame)];
  if (remainingAfterThisFrame <= 2) return base;
  if (remainingAfterThisFrame <= 6) return Math.round(base * 0.6);
  return Math.max(150, Math.round(base * 0.3));
}

export interface FramePlaybackCallbacks {
  /** Called once per frame, in order, with the board/timeline update it represents. */
  onFrame: (frame: PublicGameFrame) => void;
  /** Called once after the queue drains — the moment it is safe to reveal the live decision. */
  onIdle: () => void;
  /** Injectable for tests; defaults to a real setTimeout-based wait. */
  delay?: (ms: number) => Promise<void>;
}

const realDelay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A FIFO queue of Asphodel's public turn frames. `enqueue` silently ignores any frame id already
 * seen (queued, currently playing, or already played) — the backend resends the full frame list
 * every poll, so the caller can pass it straight through without tracking what it already sent.
 * `pump` plays whatever is queued, one at a time with `computePlaybackDelayMs` between them, and
 * is safe to call again while already running (a no-op re-entry) — a fresh poll's `enqueue` just
 * feeds the SAME in-flight pump, which keeps consuming until the queue is genuinely empty before
 * calling `onIdle`. `isIdle()` is false for the entire stretch from the first queued frame to the
 * final `onIdle` call — exactly the window during which a human decision must stay hidden.
 */
export class FramePlaybackQueue {
  private queue: PublicGameFrame[] = [];
  private readonly knownIds = new Set<number>();
  private pumping = false;

  acknowledge(frames: readonly PublicGameFrame[]): void { for (const frame of frames) this.knownIds.add(frame.id); }

  enqueue(frames: readonly PublicGameFrame[]): void {
    let added = false;
    for (const frame of frames) {
      if (this.knownIds.has(frame.id)) continue;
      this.knownIds.add(frame.id);
      this.queue.push(frame);
      added = true;
    }
    if (added) this.queue.sort((a, b) => a.id - b.id);
  }

  isIdle(): boolean {
    return !this.pumping && this.queue.length === 0;
  }

  async pump(callbacks: FramePlaybackCallbacks): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const wait = callbacks.delay ?? realDelay;
    try {
      while (this.queue.length > 0) {
        const frame = this.queue.shift()!;
        callbacks.onFrame(frame);
        // Always pause after a frame, including the last one — so the final action is actually
        // seen for a beat before the decision controls appear, rather than being instantly swapped.
        await wait(computePlaybackDelayMs(frame, this.queue.length));
      }
    } finally {
      this.pumping = false;
    }
    callbacks.onIdle();
  }
}
