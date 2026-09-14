import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DecisionGate } from './decision-gate.js';

it('consumes N immediately, rejects stale polls/callbacks and permits only N+1', () => {
  const gate = new DecisionGate();
  gate.observe('N');
  assert.equal(gate.consume('N'), true);
  gate.observe('N'); // HTTP poll started before submit completed
  assert.equal(gate.consume('N'), false);
  gate.observe(null);
  assert.equal(gate.consume('N'), false);
  gate.observe('N+1');
  assert.equal(gate.consume('N'), false);
  assert.equal(gate.consume('N+1'), true);
});
it('a rejected request can be retried only while its decision is current', () => {
  const gate = new DecisionGate();
  gate.observe('N'); gate.consume('N'); gate.retry('N');
  assert.equal(gate.allows('N'), true);
  gate.observe('N+1');
  assert.equal(gate.allows('N'), false);
});
