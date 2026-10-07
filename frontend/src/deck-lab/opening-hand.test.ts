import assert from 'node:assert/strict';
import test from 'node:test';
import { OpeningHandTrial, trialSnapshot } from './opening-hand';
import type { LabCard } from '../../../shared/deck-lab';
import type { Sheet } from './deck-model';
const card = (name: string): LabCard => ({ name, mana_cost: '{G}', cmc: 1, type_line: 'Creature', oracle_text: '', power: null, toughness: null, loyalty: null, set: 'kept', set_name: 'Chosen art', collector_number: '42', lang: 'en', rarity: 'rare', color_identity: ['G'], image: 'chosen-art.png', related: [] });
const sheet = (size = 99): Sheet => ({ name: 'Trial', cuts: [card('Cut')], groups: [{ name: 'Commander', commander: true, entries: [{ card: card('Leader'), quantity: 1 }] }, { name: 'Mainboard', entries: Array.from({ length: size }, (_, i) => ({ card: card(`Card ${i}`), quantity: 1 })) }, { name: 'Candidates', maybeboard: true, entries: [{ card: card('Maybe'), quantity: 99 }] }] });
const ids = (t: OpeningHandTrial) => [...t.hand, ...t.library].map(c => c.id).sort();
test('snapshot excludes all commanders, candidates/cuts and preserves copies, saved faces/art and roles independently of the deck', () => {
  const s = sheet(2); s.groups[1]!.entries[0]!.quantity = 37; s.groups[1]!.entries[0]!.card.faces = [{ name: 'Back', image: 'back.png' }];
  s.tags = { definitions: [{ id: 'draw', name: 'Pioche', description: '' }], cards: [{ name: 'Card 0', tagIds: ['draw'] }] };
  const before = structuredClone(s), snap = trialSnapshot(s); assert.equal(snap.cards.length, 38); assert.equal(new Set(snap.cards.map(c => c.id)).size, 38); assert.ok(snap.cards.every(c => !['Leader', 'Maybe', 'Cut'].includes(c.card.name))); assert.equal(snap.cards[0]!.card.faces![0]!.image, 'back.png'); assert.deepEqual(snap.cards[0]!.roles, ['Pioche']);
  snap.cards[0]!.card.image = 'changed'; snap.cards[0]!.roles.push('Other'); assert.deepEqual(s, before); assert.equal(snap.cards[1]!.card.image, 'chosen-art.png');
});
test('same seed/actions replay the entire shuffle sequence; another seed changes it', () => {
  const a = new OpeningHandTrial(sheet(), 'seed'), b = new OpeningHandTrial(sheet(), 'seed'), c = new OpeningHandTrial(sheet(), 'other');
  assert.deepEqual(a.hand, b.hand); assert.deepEqual(a.library, b.library); assert.notDeepEqual(a.hand.map(c => c.id), c.hand.map(c => c.id));
  a.newHand(); b.newHand(); assert.deepEqual(a.hand, b.hand); a.mulligan(); b.mulligan(); assert.deepEqual(a.hand, b.hand);
});
test('multiplayer first mulligan is free; next mulligan requires one chosen bottom card before keep', () => {
  const t = new OpeningHandTrial(sheet(), 'multi'); assert.equal(t.penalty, 0); assert.equal(t.mulligan(), true); assert.equal(t.penalty, 0); t.mulligan(); assert.equal(t.penalty, 1); assert.equal(t.keep(), false); assert.equal(t.draw(), false);
  const bottom = t.hand[0]!; t.toggleBottom(bottom.id); assert.equal(t.keep(), true); assert.equal(t.hand.length, 6); assert.equal(t.library.at(-1)!.id, bottom.id); assert.equal(t.mulligan(), false); assert.equal(t.keep(), false);
});
test('duel mulligans have no free one; ordered bottom selection and toggling retain the chosen order', () => {
  const t = new OpeningHandTrial(sheet(), 'duel', false); t.mulligan(); t.mulligan(); assert.equal(t.penalty, 2); const [a, b, c] = t.hand;
  t.toggleBottom(a!.id); t.toggleBottom(b!.id); t.toggleBottom(c!.id); assert.deepEqual(t.bottom, [a!.id, b!.id]); t.toggleBottom(a!.id); t.toggleBottom(c!.id); assert.deepEqual(t.bottom, [b!.id, c!.id]); assert.equal(t.keep(), true); assert.deepEqual(t.library.slice(-2).map(c => c.id), [b!.id, c!.id]);
});
test('every reshuffle restores the full original deck, conserves all copies and never mutates the source sheet', () => {
  const s = sheet(), before = structuredClone(s), t = new OpeningHandTrial(s, 'conservation'); const original = ids(t);
  for (let i = 0; i < 7; i++) { assert.deepEqual(ids(t), original); t.mulligan(); }
  for (const c of t.hand.slice(0, t.penalty)) t.toggleBottom(c.id); t.keep(); assert.deepEqual(ids(t), original);
  while (t.draw()) assert.deepEqual(ids(t), original); assert.equal(t.library.length, 0); assert.equal(t.draw(), false); t.newHand(); assert.equal(t.mulligans, 0); assert.equal(t.hand.length, 7); assert.deepEqual(ids(t), original); assert.deepEqual(s, before);
});
test('draws follow the retained library order after keep; no cards are invented at exhaustion', () => {
  const t = new OpeningHandTrial(sheet(10), 'draw'); const next = t.library[0]!.id; assert.equal(t.draw(), false); t.keep(); assert.equal(t.draw(), true); assert.equal(t.hand.at(-1)!.id, next); assert.equal(t.drawn, 1); while (t.draw()) {} assert.equal(t.hand.length, 10); assert.equal(t.drawn, 3);
});
test('incomplete small decks work explicitly; zero-card hand is possible but further mulligans stop', () => {
  const t = new OpeningHandTrial(sheet(3), 'small', false); assert.equal(t.hand.length, 3); assert.equal(t.library.length, 0); t.mulligan(); t.mulligan(); t.mulligan(); assert.equal(t.penalty, 3); assert.equal(t.mulligan(), false); for (const c of t.hand) t.toggleBottom(c.id); assert.equal(t.keep(), true); assert.equal(t.hand.length, 0); assert.equal(t.library.length, 3);
});
test('invalid quantities, empty/oversized decks and invalid seeds are bounded before expanding copies', () => {
  assert.throws(() => new OpeningHandTrial(sheet(0), 'empty'), /bibliothèque/); for (const quantity of [0, -1, 1.5, 5001, NaN]) { const s = sheet(1); s.groups[1]!.entries[0]!.quantity = quantity; assert.throws(() => trialSnapshot(s)); }
  for (const seed of ['', ' ', 'x'.repeat(81)]) assert.throws(() => new OpeningHandTrial(sheet(), seed), /graine/);
});
test('edits made after starting a trial do not rewrite the snapshot or future cards', () => {
  const s = sheet(), t = new OpeningHandTrial(s, 'frozen'); s.groups[1]!.entries.splice(0); s.name = 'Edited'; t.newHand(); assert.equal(t.snapshot.cards.length, 99); assert.equal(t.snapshot.name, 'Trial'); assert.equal(t.hand.length, 7);
});
