import assert from 'node:assert/strict';
import test from 'node:test';
import type { LabCard } from '../../../shared/deck-lab';
import { commanderName, type CommanderCatalogResult, type CommanderFacts } from '../../../shared/commander.mjs';
import type { Sheet } from './deck-model';
import { CommanderCatalog } from './commander-catalog';

const card = (name: string): LabCard => ({ name, type_line: 'Creature', oracle_text: '', mana_cost: null, cmc: 1, power: '1', toughness: '1', loyalty: null, set: 'kept', set_name: 'My art', image: 'kept.png', collector_number: '★42', lang: 'fr', rarity: 'rare', color_identity: ['G'], related: [] });
const sheet = (count = 1): Sheet => ({ name: 'Read-only facts', cuts: [card('Cut')], groups: [{ name: 'Commander', commander: true, entries: [] }, { name: 'Mainboard', entries: Array.from({ length: count }, (_, i) => ({ card: card(`Card ${i}`), quantity: 1 })) }, { name: 'Maybe', maybeboard: true, entries: [{ card: card('Candidate'), quantity: 1 }] }] });
const facts = (name: string): CommanderFacts => ({ requestedName: name, name, oracleId: name, typeLine: 'Creature', oracleText: '', colorIdentity: ['G'], commanderLegal: 'legal', power: '1', toughness: '1' });
const response = (names: string[], snapshotDate = '2026-10-07T00:00:00.000Z'): CommanderCatalogResult => ({ cards: names.map(facts), missing: [], snapshotDate, catalogPrintings: 1 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }

test('opening the analysis starts no lookup; an explicit check excludes candidates/cuts and never alters the sheet', async () => {
  const calls: string[][] = [], catalog = new CommanderCatalog(async names => { calls.push(names); return response(names); }), s = sheet(), before = structuredClone(s);
  assert.equal(catalog.state(s).facts.size, 0); assert.equal(calls.length, 0); await catalog.refresh(s, () => {});
  assert.deepEqual(calls, [['Card 0']]); assert.equal(catalog.state(s).facts.size, 1); assert.deepEqual(s, before); assert.ok(catalog.state(s).checkedAt);
});
test('bounded batches, duplicate names and missing cards are handled with progress and one completed snapshot', async () => {
  const calls: number[] = [], s = sheet(241), progress: number[] = [];
  s.groups[1]!.entries.push({ card: card('Card 0'), quantity: 37 });
  const c = new CommanderCatalog(async names => { calls.push(names.length); return { ...response(names), cards: names.filter(n => n !== 'Card 240').map(facts), missing: names.includes('Card 240') ? ['Card 240'] : [] }; });
  await c.refresh(s, () => { progress.push(c.state(s).done); });
  assert.deepEqual(calls, [120, 120, 1]); assert.equal(c.state(s).facts.size, 240); assert.deepEqual(c.state(s).missing, ['Card 240']); assert.equal(progress.at(-1), 241);
});
test('a failed second batch retains the previous completed result, error is cleared by a successful retry', async () => {
  let fail = false, batch = 0; const s = sheet(121), c = new CommanderCatalog(async names => { if (fail && ++batch === 2) throw new Error('Catalogue indisponible'); return response(names); });
  await c.refresh(s, () => {}); const old = c.state(s).facts, stamp = c.state(s).checkedAt;
  fail = true; await c.refresh(s, () => {}); assert.equal(c.state(s).facts, old); assert.equal(c.state(s).checkedAt, stamp); assert.match(c.state(s).error, /indisponible/);
  fail = false; await c.refresh(s, () => {}); assert.equal(c.state(s).error, ''); assert.equal(c.state(s).facts.size, 121);
});
test('catalog changes, unrequested cards, incomplete data and malformed metadata reject the entire refresh', async () => {
  for (const kind of ['changed', 'extra', 'missing', 'malformed', 'bad-cost']) {
    let calls = 0; const s = sheet(121), c = new CommanderCatalog(async names => {
      const r = response(names); calls++;
      if (kind === 'changed' && calls === 2) r.snapshotDate = '2026-10-08T00:00:00.000Z';
      if (kind === 'extra') r.cards.push(facts('Unrequested'));
      if (kind === 'missing') r.cards.pop();
      if (kind === 'malformed') r.cards[0]!.power = undefined as unknown as null;
      if (kind === 'bad-cost') r.cards[0]!.manaCost = 42 as unknown as string;
      return r;
    });
    await c.refresh(s, () => {}); assert.equal(c.state(s).facts.size, 0); assert.ok(c.state(s).error); assert.equal(c.state(s).busy, false);
  }
});
test('one in-flight request per sheet; closing/retiring aborts pending work without publishing a stale response', async () => {
  const pending = deferred<CommanderCatalogResult>(), s = sheet(); let calls = 0, signal!: AbortSignal;
  const c = new CommanderCatalog(async (_names, current) => { calls++; signal = current; return pending.promise; });
  const started = c.refresh(s, () => {}); await c.refresh(s, () => {}); assert.equal(calls, 1); c.retire(); assert.equal(signal.aborted, true);
  pending.resolve(response(['Card 0'])); await started; assert.equal(c.state(s).facts.size, 0); assert.equal(c.state(s).busy, false); await c.refresh(s, () => {}); assert.equal(calls, 1);
});
test('per-deck results remain independent; metadata does not overwrite a user edit arriving during lookup', async () => {
  const pending = deferred<CommanderCatalogResult>(), a = sheet(), b = sheet(); const c = new CommanderCatalog(async () => pending.promise);
  const started = c.refresh(a, () => {}); a.groups[1]!.entries[0]!.card.image = 'new-user-choice.png'; a.groups[1]!.entries[0]!.quantity = 2;
  pending.resolve(response(['Card 0'])); await started;
  assert.equal(c.state(a).facts.get(commanderName('Card 0'))!.commanderLegal, 'legal'); assert.equal(c.state(b).facts.size, 0);
  assert.equal(a.groups[1]!.entries[0]!.card.image, 'new-user-choice.png'); assert.equal(a.groups[1]!.entries[0]!.quantity, 2);
});
