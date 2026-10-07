import assert from 'node:assert/strict';
import test from 'node:test';
import { describePlaytestFailure } from './human/playtest-failure.js';
import { ForgeBridgeError, ForgeBridgeProcessError } from './forge/forge-bridge-client.js';
test('preserves bridge code, exception class, request and seed without serializing hidden observations', () => {
  const e = new ForgeBridgeError('INTERNAL_ERROR', 'The Forge bridge could not process the request.', 'java.lang.NullPointerException', 'start_external_match');
  const d = describePlaytestFailure(e, 42); assert.equal(d.code, 'INTERNAL_ERROR'); assert.equal(d.requestType, 'start_external_match'); assert.deepEqual(d.details, ['java.lang.NullPointerException']); assert.equal(d.seed, 42);
  const limited = describePlaytestFailure(new ForgeBridgeError('FORGE_CARDS_NOT_FOUND', 'Missing', { cards: ['A'], observation: { hand: ['SECRET'] }, payload: 'SECRET' }), 12);
  assert.deepEqual(limited.details, ['cards: A']); assert.ok(!JSON.stringify(limited).includes('SECRET'));
});
test('unwraps runner and failed cancellation errors without replacing the original failure', () => {
  const original = new ForgeBridgeError('INTERNAL_ERROR', 'original', 'java.lang.IllegalStateException');
  const wrapped = new Error('wrapped', { cause: new AggregateError([new Error('nested', { cause: original }), new Error('cancel failed')]) });
  assert.equal(describePlaytestFailure(wrapped, 1).code, 'INTERNAL_ERROR'); assert.equal(describePlaytestFailure(wrapped, 1).message, 'original');
});
test('bounds unknown data and cyclic causes; distinguishes process errors', () => {
  const e = new Error('x'.repeat(3000)); e.cause = e; assert.equal(describePlaytestFailure(e, 1).message.length, 2000);
  assert.equal(describePlaytestFailure(new ForgeBridgeProcessError('Java unavailable'), 2).code, 'FORGE_PROCESS_ERROR'); assert.equal(describePlaytestFailure('unknown', 2).message, 'unknown');
});
