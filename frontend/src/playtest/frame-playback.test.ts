import assert from "node:assert/strict";
import { it } from "node:test";
import { classifyFrameImportance, computePlaybackDelayMs, FramePlaybackQueue, OPPONENT_ACTION_DELAY_MS, OPPONENT_MEDIUM_DELAY_MS, OPPONENT_MINOR_DELAY_MS } from "./frame-playback.js";
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

// V2h.2 "PACING": a real physical playtest reported an entire opponent turn — land, spell cast,
// resolution — collapsing to well under a second once a few frames were queued. HIGH-importance
// frames (the one thing a human most needs time to read) must now NEVER shrink for backlog, no
// matter how large; only MEDIUM is still allowed a mild, floored catch-up.
it("a HIGH-importance frame (cast/attack/block) never shrinks for backlog, however large", () => {
  const meaningful = { event: { id: 1, turn: 1, phase: "main1", text: "Asphodel casts Krenko" } };
  const small = computePlaybackDelayMs(meaningful, 1);
  const large = computePlaybackDelayMs(meaningful, 50);
  assert.equal(small, OPPONENT_ACTION_DELAY_MS);
  assert.equal(large, OPPONENT_ACTION_DELAY_MS, "a significant event must never be visually collapsed just because Forge has already computed a big backlog");
});

it("a MEDIUM-importance frame (land/activated ability) mildly shrinks once the backlog is genuinely large, never below a readable floor", () => {
  const medium = { event: { id: 1, turn: 1, phase: "main1", text: "Asphodel plays Forest" } };
  const small = computePlaybackDelayMs(medium, 1);
  const large = computePlaybackDelayMs(medium, 50);
  assert.equal(small, OPPONENT_MEDIUM_DELAY_MS);
  assert.ok(large < small, "a genuinely large backlog should still shrink the MEDIUM tier somewhat");
  assert.ok(large >= 700, "even an accelerated catch-up must not collapse below a still-readable floor");
});

it("a LOW-importance frame (no narratable event) is always minimal, backlog or not — never worth pacing", () => {
  const minor = { event: null };
  assert.equal(computePlaybackDelayMs(minor, 1), OPPONENT_MINOR_DELAY_MS);
  assert.equal(computePlaybackDelayMs(minor, 50), OPPONENT_MINOR_DELAY_MS);
});

it("a meaningful opponent action gets the longer OPPONENT_ACTION_DELAY_MS; a minor transition gets the shorter OPPONENT_MINOR_DELAY_MS", () => {
  const meaningful = { event: { id: 1, turn: 1, phase: "main1", text: "Asphodel casts Krenko" } };
  const minor = { event: null };
  assert.equal(computePlaybackDelayMs(meaningful, 0), OPPONENT_ACTION_DELAY_MS);
  assert.equal(computePlaybackDelayMs(minor, 0), OPPONENT_MINOR_DELAY_MS);
  assert.ok(OPPONENT_ACTION_DELAY_MS > OPPONENT_MINOR_DELAY_MS, "a real action should linger noticeably longer than a minor visual step");
  // V2h.2 "PACING": retuned toward the Physical Companion follow-up's explicit target — "approximately
  // 3-4 seconds for a meaningful new card" — deliberately much slower than the old V2e.5 starting values.
  assert.ok(OPPONENT_ACTION_DELAY_MS >= 3000 && OPPONENT_ACTION_DELAY_MS <= 4000, "matches the V2h.2 'SPELL CAST' target of ~3-4s");
  assert.ok(OPPONENT_MINOR_DELAY_MS > 0 && OPPONENT_MINOR_DELAY_MS <= 350, "a tiny/untracked state update must stay near-instant, never several seconds");
});

it("classifyFrameImportance (V2h): a cast/attack/block is HIGH, a land play or activated ability is MEDIUM, no event is LOW", () => {
  assert.equal(classifyFrameImportance({ event: { id: 1, turn: 1, phase: "main1", text: "Asphodel casts Krenko" } }), "high");
  assert.equal(classifyFrameImportance({ event: { id: 1, turn: 1, phase: "combat_declare_attackers", text: "Asphodel attacks with Krenko" } }), "high");
  assert.equal(classifyFrameImportance({ event: { id: 1, turn: 1, phase: "combat_declare_blockers", text: "Asphodel blocks with Wall" } }), "high");
  assert.equal(classifyFrameImportance({ event: { id: 1, turn: 1, phase: "main1", text: "Asphodel plays Forest" } }), "medium");
  assert.equal(classifyFrameImportance({ event: { id: 1, turn: 1, phase: "main1", text: "Asphodel activates Skirk Prospector" } }), "medium");
  assert.equal(classifyFrameImportance({ event: null }), "low");
});

it("a medium-importance frame gets a delay strictly between the low and high tiers", () => {
  const medium = { event: { id: 1, turn: 1, phase: "main1", text: "Asphodel plays Forest" } };
  assert.equal(computePlaybackDelayMs(medium, 0), OPPONENT_MEDIUM_DELAY_MS);
  assert.ok(OPPONENT_MINOR_DELAY_MS < OPPONENT_MEDIUM_DELAY_MS && OPPONENT_MEDIUM_DELAY_MS < OPPONENT_ACTION_DELAY_MS);
});
