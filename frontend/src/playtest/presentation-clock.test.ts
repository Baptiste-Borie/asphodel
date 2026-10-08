import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PresentationClock} from './presentation-clock';
import {FramePlaybackQueue, computePlaybackDelayMs} from './frame-playback';
import type {PresentationSpeed} from './presentation-preferences';
import type {PublicGameFrame} from './types';

function scheduler() {
  const timers = new Map<number, () => void>(); const durations: number[] = []; let id = 0;
  return {timers, durations, set(fn: () => void, ms: number) {durations.push(ms); timers.set(++id, fn); return id;},
    clear(handle: unknown) {timers.delete(handle as number);},
    next() {const [key, fn] = [...timers][0]; timers.delete(key); fn();}};
}
const tick = async () => {for (let i = 0; i < 10; i++) await Promise.resolve();};
function frame(id: number): PublicGameFrame {
  return {id, event: {id, turn: 1, phase: 'main1', text: `Asphodel casts card ${id}`},
    observation: {gameRef: 'g', game: {turn: 1, phase: 'main1', activePlayerId: 'p', priorityPlayerId: 'p'}, selfPlayerId: 'h', players: [], stack: []}};
}

test('catch-up releases every active presentation wait and restores timers for the next batch', async () => {
  const timer = scheduler(); const clock = new PresentationClock(timer);
  const one = clock.wait(3500), two = clock.wait(2100);
  assert.equal(timer.timers.size, 2);
  clock.catchUp(); await Promise.all([one, two, clock.wait(5500)]);
  assert.equal(timer.timers.size, 0); assert.deepEqual(timer.durations, [3500, 2100]);
  clock.finish(); const next = clock.wait(1000);
  assert.equal(timer.timers.size, 1); timer.next(); await next;
});

test('catch-up preserves every public frame, deduplication and decision gating, including arrivals during playback', async () => {
  const timer = scheduler(); const clock = new PresentationClock(timer); const queue = new FramePlaybackQueue();
  const order: (number | string)[] = [];
  queue.enqueue([frame(2), frame(1)]);
  const done = queue.pump({onFrame: f => order.push(f.id), delay: ms => clock.wait(ms),
    onIdle: () => {assert.equal(queue.pendingCount(), 0); order.push('decision'); clock.finish();}});
  await tick(); assert.deepEqual(order, [1]); assert.equal(queue.pendingCount(), 2);
  queue.enqueue([frame(2), frame(3)]); assert.equal(queue.pendingCount(), 3);
  clock.catchUp(); await done;
  assert.deepEqual(order, [1, 2, 3, 'decision']); assert.equal(queue.isIdle(), true);
  queue.enqueue([frame(1), frame(2), frame(3), frame(4)]);
  const second = queue.pump({onFrame: f => order.push(f.id), delay: ms => clock.wait(ms), onIdle: () => order.push('next decision')});
  await tick(); assert.equal(timer.timers.size, 1, 'a new batch keeps the configured rhythm');
  timer.next(); await second; assert.deepEqual(order, [1, 2, 3, 'decision', 4, 'next decision']);
});

test('speed changes affect the next action, without changing the current reading pause', async () => {
  let speed: PresentationSpeed = 'normal'; const timer = scheduler(); const clock = new PresentationClock(timer);
  const queue = new FramePlaybackQueue(); queue.enqueue([frame(1), frame(2)]);
  const done = queue.pump({onFrame: () => {}, getDelay: (f, left) => computePlaybackDelayMs(f, left, speed),
    delay: ms => clock.wait(ms), onIdle: () => {}});
  await tick(); speed = 'fast'; assert.deepEqual(timer.durations, [3500]);
  timer.next(); await tick(); assert.deepEqual(timer.durations, [3500, 1000]); timer.next(); await done;
  for (const configured of ['fast', 'normal', 'deliberate'] as const) {
    assert.equal(computePlaybackDelayMs(frame(1), 100, configured), computePlaybackDelayMs(frame(1), 0, configured));
    const medium = {...frame(1), event: {...frame(1).event!, text: 'Asphodel plays Forest'}};
    assert.ok(computePlaybackDelayMs(medium, 100, configured) >= {fast: 250, normal: 700, deliberate: 1000}[configured]);
  }
});

test('canceling an old session releases waits without painting its next frame or exposing its decision', async () => {
  let current = true; const timer = scheduler(); const clock = new PresentationClock(timer);
  const queue = new FramePlaybackQueue(); queue.enqueue([frame(1), frame(2)]); const seen: number[] = [];
  const done = queue.pump({isCurrent: () => current, onFrame: f => seen.push(f.id), delay: ms => clock.wait(ms),
    onIdle: () => assert.fail('canceled session exposed a decision')});
  await tick(); current = false; clock.catchUp(); await done;
  assert.deepEqual(seen, [1]); assert.equal(timer.timers.size, 0);
});

test('catch-up during a phase-before-paint still paints and settles all frames before the decision', async () => {
  const timer = scheduler(); const clock = new PresentationClock(timer); const queue = new FramePlaybackQueue();
  queue.enqueue([frame(1), frame(2)]); const seen: string[] = [];
  const done = queue.pump({beforeFrame: async f => {seen.push(`phase${f.id}`); await clock.wait(2100);},
    onFrame: f => seen.push(`paint${f.id}`), afterFrame: async f => {await clock.wait(3500); seen.push(`settled${f.id}`);},
    onIdle: () => seen.push('decision')});
  await tick(); assert.deepEqual(seen, ['phase1']); clock.catchUp(); await done;
  assert.deepEqual(seen, ['phase1', 'paint1', 'settled1', 'phase2', 'paint2', 'settled2', 'decision']);
});
