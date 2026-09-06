import assert from "node:assert/strict";
import { it } from "node:test";
import { computePlaybackDelayMs, FramePlaybackQueue, OPPONENT_ACTION_DELAY_MS, OPPONENT_MINOR_DELAY_MS } from "./frame-playback.js";
import type { PublicGameFrame } from "./types.js";

function frame(id: number, text: string | null = null): PublicGameFrame {
  return { id, event: text ? { id, turn: 1, phase: "main1", text } : null, observation: { gameRef: "g", game: { turn: 1, phase: "main1", activePlayerId: "p", priorityPlayerId: "p" }, selfPlayerId: "player-1", players: [], stack: [] } };
}

const instant = async (): Promise<void> => { /* no real wait in tests */ };

it("plays queued frames in FIFO order, then signals idle exactly once", async () => {
  const queue = new FramePlaybackQueue();
  const played: number[] = [];
  let idleCalls = 0;
  queue.enqueue([frame(1), frame(2), frame(3)]);
  await queue.pump({ onFrame: f => played.push(f.id), onIdle: () => idleCalls++, delay: instant });
  assert.deepEqual(played, [1, 2, 3]);
  assert.equal(idleCalls, 1);
  assert.ok(queue.isIdle());
});

it("silently ignores a duplicate frame id (already queued, playing, or already played)", async () => {
  const queue = new FramePlaybackQueue();
  const played: number[] = [];
  queue.enqueue([frame(1)]);
  await queue.pump({ onFrame: f => played.push(f.id), onIdle: () => {}, delay: instant });
  assert.deepEqual(played, [1]);
  // The exact same frame id arrives again on a later poll (backend resends the full list) — must not replay.
  queue.enqueue([frame(1)]);
  await queue.pump({ onFrame: f => played.push(f.id), onIdle: () => {}, delay: instant });
  assert.deepEqual(played, [1], "a frame id already played must never be queued/played again");
});

it("decision must stay hidden (isIdle() false) for the entire stretch until pump's onIdle fires", async () => {
  const queue = new FramePlaybackQueue();
  queue.enqueue([frame(1), frame(2)]);
  assert.equal(queue.isIdle(), false, "queue is non-empty before pump even starts");

  let resolveDelay: (() => void) | null = null;
  const controlledDelay = () => new Promise<void>(resolve => { resolveDelay = resolve; });
  const idleSeenDuring: boolean[] = [];
  const pumpDone = queue.pump({
    onFrame: () => { idleSeenDuring.push(queue.isIdle()); },
    onIdle: () => {},
    delay: controlledDelay,
  });
  // Let the first onFrame + delay() call happen.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(queue.isIdle(), false, "must stay hidden while mid-playback, waiting between frames");
  resolveDelay?.();
  await Promise.resolve();
  await Promise.resolve();
  resolveDelay?.();
  await pumpDone;
  assert.ok(idleSeenDuring.every(v => v === false), "isIdle() must never report true while frames were still being delivered");
  assert.equal(queue.isIdle(), true, "idle once the queue has genuinely drained");
});

it("computePlaybackDelayMs preserves order-relevant pacing but shrinks for a big backlog, never below a sane floor", () => {
  const meaningful = { event: { id: 1, turn: 1, phase: "main1", text: "Asphodel casts Krenko" } };
  const small = computePlaybackDelayMs(meaningful, 1);
  const medium = computePlaybackDelayMs(meaningful, 4);
  const large = computePlaybackDelayMs(meaningful, 20);
  assert.ok(small >= medium && medium >= large, "delay should shrink (or stay equal) as the remaining backlog grows");
  assert.ok(large >= 100, "even an accelerated catch-up must not collapse to ~0ms");
});

it("a meaningful opponent action gets the longer OPPONENT_ACTION_DELAY_MS; a minor transition gets the shorter OPPONENT_MINOR_DELAY_MS", () => {
  const meaningful = { event: { id: 1, turn: 1, phase: "main1", text: "Asphodel casts Krenko" } };
  const minor = { event: null };
  assert.equal(computePlaybackDelayMs(meaningful, 0), OPPONENT_ACTION_DELAY_MS);
  assert.equal(computePlaybackDelayMs(minor, 0), OPPONENT_MINOR_DELAY_MS);
  assert.ok(OPPONENT_ACTION_DELAY_MS > OPPONENT_MINOR_DELAY_MS, "a real action should linger noticeably longer than a minor visual step");
  assert.ok(OPPONENT_ACTION_DELAY_MS >= 900 && OPPONENT_MINOR_DELAY_MS >= 500 && OPPONENT_MINOR_DELAY_MS <= 650, "matches the V2e.5 suggested starting values");
});
