import assert from 'node:assert/strict';
import { it } from 'node:test';
import { digitalPlayerOrder } from './digital-layout.js';
import type { AgentObservation } from './types.js';

const observation = (selfPlayerId: string, otherIds: string[]) => ({
  selfPlayerId,
  players: [selfPlayerId, ...otherIds].map(playerId => ({ playerId })),
}) as AgentObservation;

it('orders [opponent, self] regardless of the observation\'s own player order', () => {
  assert.deepEqual(digitalPlayerOrder(observation('me', ['ai'])).map(p => p.playerId), ['ai', 'me']);
  assert.deepEqual(
    digitalPlayerOrder({ selfPlayerId: 'me', players: [{ playerId: 'ai' }, { playerId: 'me' }] } as AgentObservation).map(p => p.playerId),
    ['ai', 'me'],
  );
});

it('returns only the players actually known yet — no fixed-length holes', () => {
  assert.deepEqual(digitalPlayerOrder(observation('me', [])).map(p => p.playerId), ['me']);
});

it('is ready for more than two players without any change to its own logic', () => {
  assert.deepEqual(digitalPlayerOrder(observation('me', ['ai1', 'ai2', 'ai3'])).map(p => p.playerId), ['ai1', 'ai2', 'ai3', 'me']);
});
