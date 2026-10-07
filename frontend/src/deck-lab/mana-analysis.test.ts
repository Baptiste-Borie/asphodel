import assert from 'node:assert/strict';
import test from 'node:test';
import type { LabCard } from '../../../shared/deck-lab';
import { commanderName, type CommanderFacts } from '../../../shared/commander.mjs';
import type { Sheet } from './deck-model';
import { analyzeMana, parseManaCost } from './mana-analysis';
import { manaSummary } from './mana-view';

const card = (name: string, extra: Partial<LabCard> = {}): LabCard => ({ name, type_line: 'Sorcery', mana_cost: '{G}', cmc: 1, oracle_text: '', power: null, toughness: null, loyalty: null, set: 'kept', set_name: 'Chosen art', collector_number: '42', rarity: 'rare', lang: 'en', color_identity: ['G'], image: 'kept.png', related: [], ...extra });
const land = (name: string, type = 'Land', oracle = '') => card(name, { type_line: type, oracle_text: oracle, mana_cost: null, cmc: 0, color_identity: [] });
const entry = (card: LabCard, quantity = 1) => ({ card, quantity });
const sheet = (entries: ReturnType<typeof entry>[] = [], commanders: LabCard[] = []): Sheet => ({ name: 'Mana lab', cuts: [], groups: [{ name: 'Commander', commander: true, entries: commanders.map(c => entry(c)) }, { name: 'Mainboard', entries }] });
const row = (s: Sheet, type: string) => analyzeMana(s).rows.find(r => r.type === type)!;
const lookup = { facts: new Map<string, CommanderFacts>(), busy: false, done: 0, total: 0, error: '', missing: [] };

test('mandatory, generic, colorless, snow and variables remain distinct', () => {
  const d = parseManaCost('{3}{G}{G}{C}{X}{S}');
  assert.equal(d.required.G, 2); assert.equal(d.required.C, 1); assert.equal(d.generic, 3); assert.equal(d.variable, 1); assert.equal(d.snow, 1); assert.equal(d.unknown, false);
});
test('hybrid, monocolored hybrid, Phyrexian and hybrid Phyrexian are optional alternatives, not mandatory pips', () => {
  const d = parseManaCost('{G/U}{2/B}{R/P}{G/U/P}');
  assert.deepEqual(d.required, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }); assert.equal(d.flexible.G, 2); assert.equal(d.flexible.U, 2); assert.equal(d.flexible.B, 1); assert.equal(d.flexible.R, 1); assert.equal(d.generic, 0); assert.equal(d.unknown, false);
});
test('malformed and uncommon costs produce no fabricated partial demand', () => {
  for (const cost of [null, '{G}{HW}', '{G}//{U}', '{W/W}', '{G/P/P}', '{Q}', '{G}garbage', '{}', '{10000000000000000000000}']) {
    const d = parseManaCost(cost); assert.equal(d.unknown, true, String(cost)); assert.equal(d.required.G, 0); assert.equal(d.generic, 0);
  }
  assert.equal(parseManaCost('').unknown, false); assert.equal(parseManaCost('{0}').generic, 0);
});
test('quantity, commanders, candidates and cuts use the real deck membership; analysis never writes the deck', () => {
  const s = sheet([entry(card('Spell', { mana_cost: '{B}{B}' }), 3), entry(land('Forest', 'Basic Land — Forest'), 10)], [card('Leader', { type_line: 'Legendary Creature', mana_cost: '{2}{G}{G}' })]);
  s.groups.push({ name: 'Maybe', maybeboard: true, entries: [entry(land('Island', 'Basic Land — Island'), 90), entry(card('Candidate', { mana_cost: '{R}' }), 10)] }); s.cuts = [card('Cut', { mana_cost: '{R}' })];
  const before = structuredClone(s), r = analyzeMana(s); assert.equal(r.total, 14); assert.equal(r.lands, 10); assert.equal(row(s, 'B').required, 6); assert.equal(row(s, 'G').commanderRequired, 2); assert.equal(row(s, 'R').required, 0); assert.equal(row(s, 'U').lands, 0); assert.deepEqual(s, before);
});
test('mana demand is the printed cost, not color identity, devotion or rules text', () => {
  const s = sheet([entry(card('Green identity', { mana_cost: '{2}', color_identity: ['G'], oracle_text: '{G}: Draw a card.' }))]);
  assert.equal(row(s, 'G').required, 0); assert.equal(analyzeMana(s).library.generic, 2); assert.equal(analyzeMana(s).sources.length, 0);
});
test('basic subtypes and Snow basics provide their colors; Wastes uses Oracle colorless production', () => {
  const s = sheet([entry(land('Forest', 'Basic Land — Forest'), 5), entry(land('Snow Island', 'Basic Snow Land — Island'), 3), entry(land('Wastes', 'Basic Land', '({T}: Add {C}.)'), 2)]);
  assert.equal(row(s, 'G').lands, 5); assert.equal(row(s, 'U').lands, 3);
  // Wastes has no basic land type: its reminder text is the only production text.
  assert.equal(row(s, 'C').lands, 2);
});
test('two-color lands, rainbow lands and Sol Ring count cards, not mana units or sums across colors', () => {
  const s = sheet([entry(land('Dual', 'Land', '{T}: Add {W} or {U}.'), 2), entry(land('Rainbow', 'Land', '{T}: Add one mana of any color.')), entry(card('Sol Ring', { type_line: 'Artifact', mana_cost: '{1}', oracle_text: '{T}: Add {C}{C}.' }))]);
  const r = analyzeMana(s); assert.equal(r.directLands, 3); assert.equal(row(s, 'W').lands, 3); assert.equal(row(s, 'U').lands, 3); assert.equal(row(s, 'G').lands, 1); assert.equal(row(s, 'C').other, 1); assert.equal(r.otherSources, 1);
});
test('commander-color lands respect partner union and never use their printed color identity as production', () => {
  const tower = entry(land('Command Tower', 'Land', "{T}: Add one mana of any color in your commander's color identity."));
  const s = sheet([tower], [card('A', { color_identity: ['G'] }), card('B', { color_identity: ['B'] })]);
  assert.equal(row(s, 'G').lands, 1); assert.equal(row(s, 'B').lands, 1); assert.equal(row(s, 'U').lands, 0);
  const noLeader = analyzeMana(sheet([tower])); assert.equal(noLeader.sources[0]!.unknown, true); assert.equal(noLeader.directLands, 0);
});
test('chosen commander colors stay unknown; a colorless commander grants no color to Command Tower', () => {
  const tower = entry(land('Tower', 'Land', "{T}: Add one mana of any color in your commander's color identity."));
  assert.equal(analyzeMana(sheet([tower], [card('Piper', { color_identity: [], oracle_text: 'Choose a color before the game begins.' })])).sources[0]!.unknown, true);
  const r = analyzeMana(sheet([tower], [card('Colorless', { color_identity: [] })])); assert.equal(r.directLands, 0); assert.equal(r.sources[0]!.unknown, false);
});
test('filters, sacrifice/life costs, limited activation and restricted colored mana are conditional', () => {
  for (const oracle of ['{1}, {T}: Add {G}{U}.', '{T}, Pay 1 life: Add {G}.', '{T}, Sacrifice Test: Add {G}.', '{T}: Add {G}. Activate only if you control five or more lands.', '{T}: Add one mana of any color. Spend this mana only to cast creature spells.']) {
    const s = sheet([entry(land('Test', 'Land', oracle))]); assert.equal(row(s, 'G').lands, 0, oracle); assert.equal(row(s, 'G').conditional, 1, oracle);
  }
});
test('a land can have direct colorless and restricted colored modes without double counting its unique land total', () => {
  const s = sheet([entry(land('Cavern', 'Land', '{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.'))]);
  assert.equal(row(s, 'C').lands, 1); assert.equal(row(s, 'G').conditional, 1); assert.equal(analyzeMana(s).directLands, 1);
});
test('pain lands keep their direct colors but show life consequences', () => {
  const r = analyzeMana(sheet([entry(land('Pain', 'Land', '{T}: Add {G} or {U}. Pain deals 1 damage to you.'))]));
  assert.equal(r.rows.find(r => r.type === 'G')!.lands, 1); assert.match(r.sources[0]!.notes.join(' '), /vie/);
});
test('permanent tap producers are potential sources, while rituals never inflate permanent source totals', () => {
  const r = analyzeMana(sheet([entry(card('Elf', { type_line: 'Creature — Elf', oracle_text: '{T}: Add {G}.' })), entry(card('Ritual', { type_line: 'Instant', oracle_text: 'Add {B}{B}{B}.' }))]));
  assert.equal(r.rows.find(r => r.type === 'G')!.other, 1); assert.equal(r.rows.find(r => r.type === 'B')!.other, 0); assert.equal(r.oneShot, 1); assert.match(r.sources[0]!.notes.join(' '), /invocation/);
});
test('fetchlands, triggered mana, mana tokens and dependent production are explicit review items', () => {
  const r = analyzeMana(sheet([entry(land('Fetch', 'Land', '{T}, Sacrifice Fetch: Search your library for a Forest card, put it onto the battlefield, then shuffle.')), entry(card('Treasure maker', { oracle_text: 'Create a Treasure token.' })), entry(card('Trigger', { type_line: 'Enchantment', oracle_text: 'Whenever you tap a land for mana, add {G}.' })), entry(land('Pool', 'Land', '{T}: Add one mana of any type that a land you control could produce.'))]));
  assert.equal(r.sources.length, 4); assert.equal(r.directLands, 0); assert.equal(r.otherSources, 0); assert.ok(r.sources.every(s => s.unknown)); assert.equal(r.reviews.length, 4);
});
test('granted or quoted mana abilities do not claim that the granting card itself produces those colors', () => {
  const r = analyzeMana(sheet([entry(card('Granter', { type_line: 'Enchantment', oracle_text: 'Other creatures you control have "{T}: Add {G}."' }))]));
  assert.equal(r.rows.find(r => r.type === 'G')!.conditional, 0); assert.equal(r.sources[0]!.unknown, true);
});
test('always tapped, check lands, shock lands and missing texts keep separate entry classifications', () => {
  const s = sheet([entry(land('Tapped', 'Land', 'Tapped enters tapped.\n{T}: Add {G}.')), entry(land('Check', 'Land', 'Check enters tapped unless you control a Forest.\n{T}: Add {G}.')), entry(land('Shock', 'Land — Forest Island', "As Shock enters, you may pay 2 life. If you don't, it enters tapped.")), entry(land('Missing', 'Land', null as unknown as string))]);
  const r = analyzeMana(s); assert.equal(r.tapped, 1); assert.equal(r.conditionalEntry, 2); assert.equal(r.unknownEntry, 1); assert.equal(r.rows.find(r => r.type === 'G')!.lands, 3);
});
test('conditional tapped text before the name is never interpreted as always tapped', () => {
  const r = analyzeMana(sheet([entry(land('Condition', 'Land', 'If you control two lands, Condition enters tapped.\n{T}: Add {G}.'))]));
  assert.equal(r.tapped, 0); assert.equal(r.conditionalEntry, 1);
});
test('multiple-faced spell/land cards and transformation are never counted twice or with both costs summed', () => {
  const s = sheet([entry(card('Spell // Land', { type_line: 'Sorcery // Land', mana_cost: '{2}{G}', oracle_text: 'Draw a card.\n\nLand\n{T}: Add {G}.' })), entry(card('Front // Back', { type_line: 'Creature // Creature', mana_cost: '{G} // {U}', oracle_text: '{T}: Add {G}.\n\nBack\n{T}: Add {U}.' }))]);
  const r = analyzeMana(s); assert.equal(r.total, 2); assert.equal(r.lands, 0); assert.equal(r.directLands, 0); assert.equal(r.missingCosts, 2); assert.equal(row(s, 'G').required, 0); assert.ok(r.sources.every(s => s.unknown));
});
test('empty printed costs do not fabricate mana, missing spell costs are review items', () => {
  const r = analyzeMana(sheet([entry(card('No cost', { mana_cost: '' })), entry(card('Unknown cost', { mana_cost: null }))]));
  assert.equal(r.analyzedSpells, 1); assert.equal(r.missingCosts, 1); assert.equal(r.library.generic, 0); assert.match(r.reviews[0]!.reason, /absent/);
});
test('read-only catalog facts override outdated costs/text while old responses fall back only for omitted cost', () => {
  const c = card('Old', { mana_cost: '{G}', type_line: 'Artifact', oracle_text: '{T}: Add {G}.' }), s = sheet([entry(c)]), before = structuredClone(s);
  const f: CommanderFacts = { name: c.name, requestedName: c.name, oracleId: 'old', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.', colorIdentity: [], power: null, toughness: null, manaCost: '{2}' };
  const cache = new Map([[commanderName(c.name), f]]); const r = analyzeMana(s, cache);
  assert.equal(r.library.required.G, 0); assert.equal(r.library.generic, 2); assert.equal(r.rows.find(r => r.type === 'C')!.other, 1); assert.deepEqual(s, before);
  delete f.manaCost; assert.equal(analyzeMana(s, cache).library.required.G, 1); f.manaCost = null; assert.equal(analyzeMana(s, cache).missingCosts, 1);
});
test('rendering is escaped, preserves inspect links, folds long lists and states overlap/limits without probabilities', () => {
  const s = sheet(Array.from({ length: 20 }, (_, i) => entry(card(`<unsafe ${i}>`, { mana_cost: null, oracle_text: null }))));
  const html = manaSummary(s, lookup); assert.ok(!html.includes('<unsafe')); assert.match(html, /data-commander-inspect="&lt;unsafe/); assert.match(html, /autres éléments/); assert.match(html, /ne calcule pas de probabilité/); assert.match(html, /plusieurs lignes/);
  for (let i = 0; i < 20; i++) assert.ok(html.includes(`&lt;unsafe ${i}&gt;`));
});
test('empty decks remain readable and required colors with no direct source get an advisory, not a legality verdict', () => {
  assert.equal(analyzeMana(sheet()).total, 0); assert.match(manaSummary(sheet(), lookup), /Aucune source reconnue/);
  assert.match(manaSummary(sheet([entry(card('Needs blue', { mana_cost: '{U}' }))]), lookup), /aucune source directe reconnue pour Bleu/);
});
