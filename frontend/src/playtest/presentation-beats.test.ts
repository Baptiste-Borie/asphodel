import assert from 'node:assert/strict';
import { it } from 'node:test';
import { newlyVisibleSpells } from './presentation-beats.js';
import type { AgentObservation } from './types.js';

it('reveals only newly observed public stack identities, including nonpermanent spells', () => {
  const previous: AgentObservation = { gameRef: 'g', selfPlayerId: 'me', game: {turn: 1, phase: 'main1', activePlayerId: 'ai', priorityPlayerId: 'ai'}, players: [], stack: [] };
  const spell = { stackRef: 's1', position: 0, sourceCardRef: 'c1', sourceCardName: 'Lightning Bolt', controllerId: 'ai', description: null, hidden: false, faceDown: false };
  const next = { ...previous, stack: [spell] };
  assert.deepEqual(newlyVisibleSpells(previous, next).map(card => card.name), ['Lightning Bolt']);
  assert.deepEqual(newlyVisibleSpells(next, next), []);
  assert.deepEqual(newlyVisibleSpells(null, next), []);
  assert.deepEqual(newlyVisibleSpells(previous, {...next, stack: [{...spell, hidden:true}]}), []);
  assert.deepEqual(newlyVisibleSpells(previous, {...next, stack: [{...spell, faceDown:true}]}), []);
});
