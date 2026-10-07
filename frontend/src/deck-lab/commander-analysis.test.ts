import assert from 'node:assert/strict';
import test from 'node:test';
import type { LabCard } from '../../../shared/deck-lab';
import { commanderName, type CommanderFacts } from '../../../shared/commander.mjs';
import type { Sheet } from './deck-model';
import { analyzeCommander } from './commander-analysis';
import { commanderSummary } from './commander-view';

const card = (name: string, extra: Partial<LabCard> = {}): LabCard => ({ name, type_line: 'Creature — Elf', mana_cost: '{G}', cmc: 1, oracle_text: '', power: '1', toughness: '1', loyalty: null, set: 'tla', set_name: 'Chosen art', collector_number: '42', rarity: 'rare', lang: 'en', color_identity: ['G'], image: 'chosen-art.png', related: [], commander_legal: 'legal', ...extra });
const leader = (name = 'Commander', extra: Partial<LabCard> = {}) => card(name, { type_line: 'Legendary Creature — Elf', ...extra });
const sheet = (commanders: LabCard[] = [leader()], entries: { card: LabCard; quantity: number }[] = []): Sheet => ({ name: 'Commander checks', cuts: [], groups: [{ name: 'Commander', commander: true, entries: commanders.map(card => ({ card, quantity: 1 })) }, { name: 'Mainboard', entries }] });
const check = (s: Sheet, id: string) => analyzeCommander(s).checks.find(c => c.id === id)!;
const facts = (c: LabCard, extra: Partial<CommanderFacts> = {}): CommanderFacts => ({ requestedName: c.name, name: c.name, oracleId: c.name, typeLine: c.type_line, oracleText: c.oracle_text, colorIdentity: c.color_identity, commanderLegal: c.commander_legal, power: c.power, toughness: c.toughness, ...extra });

test('100 cards, a legal commander, unlimited basics and singletons pass without altering any deck state', () => {
  const s = sheet([leader()], [{ card: card('Forest', { type_line: 'Basic Land — Forest' }), quantity: 37 }, ...Array.from({ length: 62 }, (_, i) => ({ card: card(`Spell ${i}`), quantity: 1 }))]);
  const before = structuredClone(s), result = analyzeCommander(s);
  assert.equal(result.total, 100); assert.equal(result.errors, 0); assert.equal(result.unknown, 0); assert.ok(result.checks.every(c => c.status === 'ok')); assert.deepEqual(s, before);
});
test('size includes commanders and quantities but excludes every candidate, cut, zone, pile and tag', () => {
  const s = sheet([leader(), leader('Second', { oracle_text: 'Partner' })], [{ card: card('Forest', { type_line: 'Basic Land — Forest' }), quantity: 98 }]);
  s.groups[0]!.entries[0]!.card.oracle_text = 'Partner'; s.groups.push({ name: 'Ideas', maybeboard: true, entries: [{ card: card('Banned candidate', { commander_legal: 'banned', color_identity: ['R'] }), quantity: 30 }] }); s.cuts = [card('Cut', { commander_legal: 'banned' })];
  s.tags = { definitions: [{ id: 'draw', name: 'Draw', description: '' }], cards: [{ name: 'Forest', tagIds: ['draw'] }] };
  assert.equal(analyzeCommander(s).total, 100); assert.equal(check(s, 'legality').status, 'ok'); assert.equal(check(s, 'colors').status, 'ok'); assert.equal(check(s, 'size').status, 'ok');
  s.groups[1]!.entries[0]!.quantity = 99; assert.match(check(s, 'size').issues[0]!.message, /Retire 1/);
});
test('missing, three, or repeated copies of commanders are reported explicitly', () => {
  assert.equal(check(sheet([]), 'commanders').status, 'error'); assert.equal(check(sheet([leader('A'), leader('B'), leader('C')]), 'commanders').status, 'error');
  const s = sheet(); s.groups[0]!.entries[0]!.quantity = 2; assert.equal(check(s, 'commanders').status, 'error');
});
test('ordinary planeswalkers fail, explicit commander text succeeds, legendary Vehicles succeed, Spacecraft need power/toughness', () => {
  assert.equal(check(sheet([leader('Walker', { type_line: 'Legendary Planeswalker — Test' })]), 'commanders').status, 'error');
  assert.equal(check(sheet([leader('Walker', { type_line: 'Legendary Planeswalker — Test', oracle_text: 'Walker can be your commander.' })]), 'commanders').status, 'ok');
  assert.equal(check(sheet([leader('Ship', { type_line: 'Legendary Artifact — Vehicle' })]), 'commanders').status, 'ok');
  assert.equal(check(sheet([leader('Ship', { type_line: 'Legendary Artifact — Spacecraft' })]), 'commanders').status, 'ok');
  assert.equal(check(sheet([leader('Ship', { type_line: 'Legendary Artifact — Spacecraft', power: null, toughness: null })]), 'commanders').status, 'unknown');
});
test('Grist is eligible outside the battlefield; unknown exceptional text remains a review item', () => {
  const grist = leader('Grist, the Hunger Tide', { type_line: 'Legendary Planeswalker — Grist', oracle_text: "As long as Grist, the Hunger Tide isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types." });
  assert.equal(check(sheet([grist]), 'commanders').status, 'ok');
  assert.equal(check(sheet([leader('Other', { type_line: 'Legendary Planeswalker', oracle_text: null })]), 'commanders').status, 'unknown');
});
test('plain partners combine identities; mismatched partner variants never combine', () => {
  const a = leader('A', { oracle_text: 'Partner (You can have two commanders.)', color_identity: ['G'] }), b = leader('B', { oracle_text: 'Partner', color_identity: ['B'] });
  const s = sheet([a, b], [{ card: card('BG spell', { color_identity: ['B', 'G'] }), quantity: 1 }]);
  assert.equal(check(s, 'commanders').status, 'ok'); assert.equal(check(s, 'colors').status, 'ok');
  b.oracle_text = 'Partner—Friends forever'; assert.equal(check(s, 'commanders').status, 'error');
});
test('matching supported variants work, legacy Friends forever works, unknown variants are incomplete', () => {
  for (const variant of ['Character select', 'Father & son', 'Friends forever', 'Survivors']) assert.equal(check(sheet([leader('A', { oracle_text: `Partner—${variant}` }), leader('B', { oracle_text: `Partner—${variant}` })]), 'commanders').status, 'ok');
  assert.equal(check(sheet([leader('A', { oracle_text: 'Friends forever' }), leader('B', { oracle_text: 'Partner—Friends forever' })]), 'commanders').status, 'ok');
  assert.equal(check(sheet([leader('A', { oracle_text: 'Partner—Unknown variant' }), leader('B', { oracle_text: 'Partner—Unknown variant' })]), 'commanders').status, 'unknown');
});
test('named partners must name one another; incidental mentions or granting partner do not count', () => {
  const a = leader('A', { oracle_text: 'Partner with B (Search for B.)' }), b = leader('B', { oracle_text: 'Partner with A' });
  assert.equal(check(sheet([a, b]), 'commanders').status, 'ok'); b.oracle_text = 'Partner with C'; assert.equal(check(sheet([a, b]), 'commanders').status, 'error');
  a.oracle_text = 'Other creatures you control have partner.'; b.oracle_text = 'Partner'; assert.equal(check(sheet([a, b]), 'commanders').status, 'error');
});
test('Background requires a choosing commander and a legendary enchantment Background; it is not eligible alone', () => {
  const chooser = leader('Chooser', { oracle_text: 'Choose a Background' }), background = card('Background', { type_line: 'Legendary Enchantment — Background' });
  assert.equal(check(sheet([chooser, background]), 'commanders').status, 'ok'); assert.equal(check(sheet([background]), 'commanders').status, 'error');
  chooser.oracle_text = ''; assert.equal(check(sheet([chooser, background]), 'commanders').status, 'error');
  chooser.oracle_text = null; assert.equal(check(sheet([chooser, background]), 'commanders').status, 'unknown');
});
test('Doctor’s companion pairs only with a Time Lord Doctor having no other creature types', () => {
  const companion = leader('Companion', { oracle_text: 'Doctor’s companion' }), doctor = leader('Doctor', { type_line: 'Legendary Creature — Time Lord Doctor' });
  assert.equal(check(sheet([companion, doctor]), 'commanders').status, 'ok');
  doctor.type_line = 'Legendary Creature — Time Lord Doctor Human'; assert.equal(check(sheet([companion, doctor]), 'commanders').status, 'error');
  doctor.type_line = 'Legendary Creature — Shapeshifter'; doctor.oracle_text = 'Changeling'; assert.equal(check(sheet([companion, doctor]), 'commanders').status, 'error');
});
test('two unrelated legendary creatures are not valid partners', () => assert.equal(check(sheet([leader('A'), leader('B')]), 'commanders').status, 'error'));
test('commander eligibility uses the front, while color identity includes both faces and hybrid/Phyrexian symbols', () => {
  const c = leader('Front // Back', { type_line: 'Creature — Human // Legendary Creature — God', oracle_text: 'Front\nFlying\n\nBack\nPartner', color_identity: ['G', 'R'] });
  assert.equal(check(sheet([c]), 'commanders').status, 'error');
  c.type_line = 'Legendary Creature — Human // Creature — God';
  const s = sheet([c], [{ card: card('Hybrid', { mana_cost: '{R/G}', color_identity: ['R', 'G'] }), quantity: 1 }, { card: card('Phyrexian', { mana_cost: '{B/P}', color_identity: ['B'] }), quantity: 1 }]);
  assert.equal(check(s, 'commanders').status, 'ok'); assert.deepEqual(check(s, 'colors').issues.flatMap(i => i.cards), ['Phyrexian']);
});
test('back-face partner or commander permission never grants front-face eligibility', () => {
  const c = leader('Front // Back', { type_line: 'Legendary Planeswalker // Legendary Creature', oracle_text: 'Front\nDraw a card.\n\nBack\nFront can be your commander.\nPartner' });
  assert.equal(check(sheet([c]), 'commanders').status, 'error');
  c.type_line = 'Legendary Creature // Legendary Creature'; assert.equal(check(sheet([c, leader('Other', { oracle_text: 'Partner' })]), 'commanders').status, 'error');
});
test('basic land types impose colors even when a legacy card has an empty identity array; colorless basics pass', () => {
  const s = sheet([leader()], [{ card: card('Old Island', { type_line: 'Land — Island', color_identity: [] }), quantity: 1 }, { card: card('Wastes', { type_line: 'Basic Land', color_identity: [] }), quantity: 37 }]);
  assert.deepEqual(check(s, 'colors').issues.flatMap(i => i.cards), ['Old Island']); assert.equal(check(s, 'copies').status, 'ok');
});
test('missing commanders, malformed identity and chosen pregame colors remain incomplete instead of imposing colorless', () => {
  assert.equal(check(sheet([], [{ card: card('Green'), quantity: 1 }]), 'colors').status, 'unknown');
  assert.equal(check(sheet([leader('Piper', { color_identity: [], oracle_text: 'If Piper is your commander, choose a color before the game begins.' })]), 'colors').status, 'unknown');
  assert.equal(check(sheet([leader('Bad', { color_identity: ['?'] })]), 'colors').status, 'unknown');
});
test('global duplicates aggregate quantities across groups, including commander/mainboard copies', () => {
  const s = sheet([leader('Leader')], [{ card: card('Spell'), quantity: 1 }]); s.groups.push({ name: 'Other category', entries: [{ card: card('Spell', { image: 'different.png' }), quantity: 1 }, { card: leader('Leader'), quantity: 1 }] });
  assert.equal(check(s, 'copies').issues.length, 2); assert.match(check(s, 'copies').issues[0]!.message, /2 copies/);
});
test('unlimited named-copy clauses allow Rats, basic snow lands and Dragon’s Approach', () => {
  for (const name of ['Rat Colony', 'Relentless Rats', "Dragon's Approach"]) assert.equal(check(sheet([leader()], [{ card: card(name, { oracle_text: `A deck can have any number of cards named ${name}.` }), quantity: 45 }]), 'copies').status, 'ok');
  assert.equal(check(sheet([leader()], [{ card: card('Snow-Covered Forest', { type_line: 'Basic Snow Land — Forest' }), quantity: 45 }]), 'copies').status, 'ok');
});
test('Nazgûl and Seven Dwarves enforce nine and seven total copies; numeric limits work too', () => {
  for (const [name, word, number] of [['Nazgûl', 'nine', 9], ['Seven Dwarves', 'seven', 7], ['Synthetic', '4', 4]] as const) {
    const s = sheet([leader()], [{ card: card(name, { oracle_text: `A deck can have up to ${word} cards named ${name}.` }), quantity: number }]);
    assert.equal(check(s, 'copies').status, 'ok'); s.groups[1]!.entries[0]!.quantity++; assert.equal(check(s, 'copies').status, 'error');
  }
});
test('copy exceptions need matching names; missing Oracle or unfamiliar deck construction clauses remain unknown', () => {
  for (const oracle_text of [null, 'A deck can have any number of cards named Other.', 'A deck can have up to thirty cards named Engine.']) assert.equal(check(sheet([leader()], [{ card: card('Engine', { oracle_text }), quantity: 3 }]), 'copies').status, 'unknown');
  assert.equal(check(sheet([leader()], [{ card: card('Engine', { oracle_text: 'Draw a card.' }), quantity: 3 }]), 'copies').status, 'error');
});
test('catalog facts override rule metadata read-only, group identical Oracle ids and never alter chosen printings', () => {
  const a = card('Alias A'), b = card('Alias B'), s = sheet([leader()], [{ card: a, quantity: 1 }, { card: b, quantity: 1 }]), before = structuredClone(s);
  const cache = new Map([[commanderName(a.name), facts(a, { oracleId: 'same' })], [commanderName(b.name), facts(b, { oracleId: 'same', commanderLegal: 'banned' })]]);
  const r = analyzeCommander(s, cache); assert.equal(r.checks.find(c => c.id === 'copies')!.status, 'error'); assert.equal(r.checks.find(c => c.id === 'legality')!.status, 'error'); assert.deepEqual(s, before);
});
test('legal, banned, not_legal and absent/unrecognized status are distinguished and candidates stay excluded', () => {
  const s = sheet([leader()], [{ card: card('Banned', { commander_legal: 'banned' }), quantity: 1 }, { card: card('Invalid', { commander_legal: 'not_legal' }), quantity: 1 }, { card: card('Unknown', { commander_legal: undefined }), quantity: 1 }]);
  assert.deepEqual(check(s, 'legality').issues.map(i => i.status), ['error', 'error', 'unknown']);
});
test('rendered diagnosis escapes card names and status text, uses explicit incomplete labels and provides inspect buttons', () => {
  const s = sheet([leader()], [{ card: card('<img onerror=x>', { color_identity: ['R'], commander_legal: undefined }), quantity: 2 }]);
  const html = commanderSummary(s, { facts: new Map(), busy: false, done: 0, total: 0, error: '<b>offline</b>', missing: [] });
  assert.ok(!html.includes('<img onerror')); assert.ok(!html.includes('<b>offline')); assert.match(html, /data-commander-inspect="&lt;img/); assert.match(html, /À vérifier/);
});
test('long groups of unknown statuses remain readable while every card remains inspectable', () => {
  const s = sheet([leader()], Array.from({ length: 20 }, (_, i) => ({ card: card(`Unknown ${i}`, { commander_legal: undefined }), quantity: 1 })));
  const html = commanderSummary(s, { facts: new Map(), busy: false, done: 0, total: 0, error: '', missing: [] });
  assert.match(html, /16 autres cartes/);
  for (let i = 0; i < 20; i++) assert.ok(html.includes(`data-commander-inspect="Unknown ${i}"`));
});
