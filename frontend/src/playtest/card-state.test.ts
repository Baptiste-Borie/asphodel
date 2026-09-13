import assert from 'node:assert/strict';
import { it } from 'node:test';
import { statTone } from './card-state.js';

it('compares each observed characteristic independently, including after reloading a modified card', () => {
  const card = JSON.parse('{"power":5,"toughness":2,"basePower":3,"baseToughness":3}');
  assert.equal(statTone(card.power, card.basePower), 'raised');
  assert.equal(statTone(card.toughness, card.baseToughness), 'lowered');
  assert.equal(statTone(3, 3), 'neutral');
  assert.equal(statTone(5, null), 'neutral');
  assert.equal(statTone(5, undefined), 'neutral');
  assert.equal(statTone(null, 3), 'neutral');
});
