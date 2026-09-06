import type { PublicGameFrame } from "./types.js";

/** The one place this pacing constant lives — change it here to retune every playback speed. */
export const DEFAULT_FRAME_PLAYBACK_DELAY_MS = 450;

/**
 * Pure. Paces individual actions generously in the common case, but caps how long a big backlog
 * takes to catch up — order is always preserved, only the per-frame wait shrinks as the queue
 * grows (a "reasonable accelerated catch-up", never abandoning any frame).
 */
export function computePlaybackDelayMs(remainingAfterThisFrame: number, base = DEFAULT_FRAME_PLAYBACK_DELAY_MS): number {
  if (remainingAfterThisFrame <= 2) return base;
  if (remainingAfterThisFrame <= 6) return Math.round(base * 0.6);
  return Math.max(80, Math.round(base * 0.3));
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
        await wait(computePlaybackDelayMs(this.queue.length));
      }
    } finally {
      this.pumping = false;
    }
    callbacks.onIdle();
  }
}
