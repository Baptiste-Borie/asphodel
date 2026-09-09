import assert from 'node:assert/strict';
import { it } from 'node:test';
import { battlefieldArtUri } from './card-art.js';
import type { CardPresentation } from './types.js';
const presentation = (imageUri: string, artUri?: string) => ({imageUri, artUri}) as CardPresentation;
it('selects art-only Scryfall variant while preserving the printed image for inspection', () => {
  const card = presentation('https://cards.scryfall.io/normal/front/a/b/id.jpg?123');
  assert.equal(battlefieldArtUri(card), 'https://cards.scryfall.io/art_crop/front/a/b/id.jpg?123');
  assert.match(card.imageUri!, /\/normal\//);
});
it('never substitutes an unknown printed image for artwork', () => {
  assert.equal(battlefieldArtUri(presentation('https://other.test/printed.jpg')), null);
  assert.equal(battlefieldArtUri(presentation('invalid')), null);
  assert.equal(battlefieldArtUri(null), null);
  assert.equal(battlefieldArtUri(presentation('printed.jpg','art-only.jpg')), 'art-only.jpg');
});
