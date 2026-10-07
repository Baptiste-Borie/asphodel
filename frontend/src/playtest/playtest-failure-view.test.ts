import assert from 'node:assert/strict';
import test from 'node:test';
import { playtestDiagnostic } from './playtest-failure-view';
import type { WebPlaytestStateDTO } from './types';
const state = { sessionId: 'session', status: 'failed', playMode: 'digital', humanDeckName: 'My deck', asphodelDeckNames: ['Opponent'], asphodelDecisionCount: 0, error: 'The Forge bridge could not process the request.', observation: { hand: ['SECRET'] } } as unknown as WebPlaytestStateDTO;
test('diagnostic is readable, includes session/deck/seed/exception/request and never dumps observations', () => {
  const text = playtestDiagnostic({ ...state, failure: { code: 'INTERNAL_ERROR', message: 'generic', details: ['java.lang.NullPointerException'], seed: 42, capturedAt: '2026-10-07', requestType: 'start_external_match', bridgeMessage: 'Missing resource' } });
  for (const part of ['session', 'My deck', 'Opponent', '42', 'java.lang.NullPointerException', 'start_external_match', 'Missing resource']) assert.ok(text.includes(part)); assert.ok(!text.includes('SECRET'));
});
test('old failed states still show a diagnostic without inventing technical details', () => {
  const text = playtestDiagnostic(state); assert.match(text, /indisponibles/); assert.ok(!text.includes('undefined')); assert.ok(!text.includes('SECRET'));
});
