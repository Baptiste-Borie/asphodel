import assert from 'node:assert/strict';
import { it } from 'node:test';
import { orderDigitalSeats } from './digital-layout.js';
import type { AgentObservation } from './types.js';

const observation = (selfPlayerId: string, otherIds: string[]) => ({
  selfPlayerId,
  players: [selfPlayerId, ...otherIds].map(playerId => ({ playerId })),
}) as AgentObservation;

it('orders [opponent, self] regardless of the observation\'s own player order', () => {
  assert.deepEqual(orderDigitalSeats(observation('me', ['ai'])).map(p => p?.playerId), ['ai', 'me']);
  assert.deepEqual(
    orderDigitalSeats({ selfPlayerId: 'me', players: [{ playerId: 'ai' }, { playerId: 'me' }] } as AgentObservation).map(p => p?.playerId),
    ['ai', 'me'],
  );
});

it('leaves the opponent slot empty when only self is known yet', () => {
  assert.deepEqual(orderDigitalSeats(observation('me', [])).map(p => p?.playerId), [undefined, 'me']);
});
