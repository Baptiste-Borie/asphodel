import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DEFAULT_PRESENTATION, PRESENTATION_STORAGE_KEY, PresentationPreferenceStore, parsePresentationPreferences, presentationTiming} from './presentation-preferences';

function storage(initial: string | null = null) {
  let value = initial;
  return {getItem: () => value, setItem: (_key: string, next: string) => {value = next;}};
}

test('missing, corrupt and unsupported preferences use the existing Normal reading rhythm', () => {
  for (const raw of [null, '', '{', '{}', '{"version":2,"speed":"fast","reduceMotion":false}',
    '{"version":1,"speed":"constructor","reduceMotion":false}', '{"version":1,"speed":["fast"],"reduceMotion":false}', '{"version":1,"speed":"fast","reduceMotion":"false"}']) {
    assert.deepEqual(parsePresentationPreferences(raw), DEFAULT_PRESENTATION);
  }
  assert.equal(presentationTiming().high, 3500);
  assert.equal(presentationTiming().medium, 1000);
  assert.equal(presentationTiming().phase, 2100);
});

test('saved speed and motion survive a new store; returned values cannot mutate preferences', () => {
  const disk = storage();
  const first = new PresentationPreferenceStore(disk);
  first.set({version: 1, speed: 'deliberate', reduceMotion: true});
  const second = new PresentationPreferenceStore(disk);
  assert.deepEqual(second.state, {version: 1, speed: 'deliberate', reduceMotion: true});
  second.state.speed = 'fast';
  assert.equal(second.state.speed, 'deliberate');
  const timing = presentationTiming('fast'); timing.high = 0;
  assert.equal(presentationTiming('fast').high, 1000);
  assert.equal(JSON.parse(disk.getItem()!).version, 1);
});

test('all mounted settings see changes, storage failure is explicit, retry persists the session setting', () => {
  let fail = true;
  const disk = storage();
  const store = new PresentationPreferenceStore({getItem: disk.getItem, setItem(key, value) {
    assert.equal(key, PRESENTATION_STORAGE_KEY);
    if (fail) throw new Error('quota');
    disk.setItem(key, value);
  }});
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  store.set({version: 1, speed: 'fast', reduceMotion: true});
  assert.equal(store.state.speed, 'fast');
  assert.match(store.saveError!, /session.*non enregistré/);
  assert.equal(new PresentationPreferenceStore(disk).state.speed, 'normal');
  fail = false; store.set(store.state);
  assert.equal(store.saveError, null);
  assert.equal(new PresentationPreferenceStore(disk).state.speed, 'fast');
  assert.equal(calls, 2);
  unsubscribe(); store.set(DEFAULT_PRESENTATION); assert.equal(calls, 2);
});

test('refresh after an external restore reloads settings; unavailable storage remains usable', () => {
  const disk = storage(); const store = new PresentationPreferenceStore(disk);
  disk.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify({version: 1, speed: 'fast', reduceMotion: true}));
  store.refresh(); assert.equal(store.state.speed, 'fast');
  disk.setItem(PRESENTATION_STORAGE_KEY, '{}'); store.refresh(); assert.deepEqual(store.state, DEFAULT_PRESENTATION);
  const unavailable = new PresentationPreferenceStore({getItem() {throw new Error('blocked');}, setItem() {throw new Error('blocked');}});
  assert.ok(unavailable.saveError);
  unavailable.set({version: 1, speed: 'deliberate', reduceMotion: false});
  assert.equal(unavailable.state.speed, 'deliberate');
  unavailable.refresh(); assert.equal(unavailable.state.speed, 'deliberate'); assert.ok(unavailable.saveError);
});
