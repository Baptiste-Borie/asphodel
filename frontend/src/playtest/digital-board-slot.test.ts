import assert from 'node:assert/strict';
import { it } from 'node:test';
import { digitalPlaymatAsset } from './digital-board-slot.js';

it('assigns a different playmat asset to each seat position', () => {
  const asphodel = digitalPlaymatAsset('asphodel');
  const human = digitalPlaymatAsset('human');
  assert.notEqual(asphodel, human);
  assert.ok(asphodel.length > 0);
  assert.ok(human.length > 0);
});
