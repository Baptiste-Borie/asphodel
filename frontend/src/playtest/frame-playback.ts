import type { PublicGameFrame } from "./types.js";

/**
 * The one place these pacing constants live (V2e.5/V2h/V2h.2) — change them here to retune every
 * playback speed. Three importance tiers (V2h "AI PLAYBACK PACING"):
 *   - LOW: no narratable event at all (e.g. a mana ability tapping a land mid-payment, an untap, an
 *     internal Forge decision with no visible consequence). Never worth pacing — see the Physical
 *     Companion follow-up (V2h.2 "PACING") spec: "do not add several seconds to every priority
 *     pass/every internal Forge decision/every untap/every tiny state update".
 *   - MEDIUM: a land played, or an activated ability — a real but modest step (~1s: "movement /
 *     placement, short settle").
 *   - HIGH: a spell cast, an attack declaration, a block — the moments a human most needs real time
 *     to actually register before the next thing happens (~3-4s: "clearly reveal the spell/card,
 *     enough time to understand what was cast").
 * `OPPONENT_ACTION_DELAY_MS`/`OPPONENT_MINOR_DELAY_MS` are the pre-V2h names for the HIGH/LOW
 * tiers, kept as the exact values a caller (or a future Fast/Normal/Slow speed setting) reads for
 * those two tiers.
 *
 * V2h.2 "PACING": a real physical playtest reported the whole opponent turn — land, spell cast,
 * resolution, priority back to the human — completing before the human could even process what had
 * happened. Retuned toward deliberately readable ("optimize for comprehension, not speed") as the
 * new default; see `computePlaybackDelayMs`'s doc comment for why a HIGH-importance frame no longer
 * shrinks under backlog the way MEDIUM still mildly does.
 */
export const OPPONENT_ACTION_DELAY_MS = 3500;
export const OPPONENT_MEDIUM_DELAY_MS = 1000;
export const OPPONENT_MINOR_DELAY_MS = 250;

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
 * Pure. Paces individual actions generously in the common case. V2h.2 "PACING": a real physical
 * playtest showed the previous across-the-board backlog shrink collapsing an entire opponent turn —
 * land, cast, resolution — into well under a second once more than a couple of frames were queued,
 * defeating the whole point of a human-readable timeline ("do not let several significant queued
 * events visually collapse into each other simply because Forge has already computed future state").
 * So the shrink is now tier-scoped, never applied uniformly:
 *   - HIGH (a cast/attack/block) NEVER shrinks — the one thing a human most needs time to read is
 *     exactly the one thing that must never be crushed by backlog. Slower-than-necessary is the
 *     accepted tradeoff for now (a future Fast/Normal/Slow setting is the intended way to speed this
 *     back up, not a silent backlog-driven shortcut).
 *   - LOW (no narratable event) is already minimal and never worth pacing further either way —
 *     always its flat, short delay, backlog or not.
 *   - MEDIUM (land/activated ability) is the only tier still allowed a MILD catch-up, and only once
 *     the backlog is genuinely large — order is always preserved regardless, only the per-frame wait
 *     shrinks, and never below a still-readable floor.
 */
export function computePlaybackDelayMs(frame: Pick<PublicGameFrame, "event">, remainingAfterThisFrame: number): number {
  const importance = classifyFrameImportance(frame);
  const base = IMPORTANCE_DELAY_MS[importance];
  if (importance !== "medium") return base;
  if (remainingAfterThisFrame <= 8) return base;
  return Math.max(700, Math.round(base * 0.7));
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
