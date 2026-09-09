import assert from 'node:assert/strict';
import { it } from 'node:test';
import { physicalLayout } from './physical-layout.js';
import type { AgentObservation } from './types.js';
const observation = (count: number) => ({ selfPlayerId: 'me', players: Array.from({length: count}, (_,i) => ({playerId: i ? `ai-${i}` : 'me'})) }) as AgentObservation;
it('physical overview grows from opponent-primary to equal four-player boards', () => {
  assert.deepEqual(physicalLayout(observation(2), null).map(s => s.density), ['preview','primary']);
  assert.deepEqual(physicalLayout(observation(3), null).map(s => s.density), ['preview','normal','normal']);
  assert.deepEqual(physicalLayout(observation(4), null).map(s => s.density), ['normal','normal','normal','normal']);
});
it('manual focus accepts any seat and falls back when a seat disappears', () => {
  assert.deepEqual(physicalLayout(observation(4), 'me').map(s => s.density), ['primary','preview','preview','preview']);
  assert.deepEqual(physicalLayout(observation(2), 'gone'), physicalLayout(observation(2), null));
});
