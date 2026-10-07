import assert from 'node:assert/strict';
import test from 'node:test';
import { validProjectTags, TAG_TEMPLATES } from '../../../shared/deck-tags.mjs';
import { editableTags, removeTag, roleStatistics, setCardTag, tagBadges } from './deck-tags';
import { deckStatistics, type Sheet } from './deck-model';
import { ProjectHistory } from './project-history';
import { DRAFT_PREFIX, loadDrafts, prepareProject, ProjectPersistence, sheetFromProject, type Storage } from './project-persistence';
import { parseBuilderProject } from '../../../shared/builder-project.mjs';
import cards from './cards.json';

const sheet = (): Sheet => ({ name: 'Roles', groups: [
  { name: 'Commander', commander: true, entries: [{ card: { ...cards[0]!, name: 'Aang' }, quantity: 1 }] },
  { name: 'To try', entries: [{ card: { ...cards[0]!, name: 'Engine' }, quantity: 2 }, { card: { ...cards[0]!, name: 'Forest' }, quantity: 37 }] },
  { name: 'Candidates', maybeboard: true, entries: [{ card: { ...cards[0]!, name: 'Idea' }, quantity: 9 }] },
], cuts: [{ ...cards[0]!, name: 'Cut idea' }] });

test('editing an old deck does not mutate it or the shared manual template', () => {
  const s = sheet(), before = structuredClone(s), tags = editableTags(s);
  tags.definitions[0]!.name = 'Changed'; setCardTag(tags, ['Engine'], 'draw', true);
  assert.deepEqual(s, before); assert.equal(TAG_TEMPLATES[0]!.name, 'Ramp');
  assert.equal(prepareProject(s).tags, undefined);
});
test('multi-role quantities overlap while candidates/cuts remain excluded and deck totals never double', () => {
  const s = sheet(); s.tags = editableTags(s);
  for (const id of ['ramp', 'draw']) setCardTag(s.tags, ['Engine', 'Idea', 'Cut idea'], id, true);
  setCardTag(s.tags, ['Aang'], 'protection', true); s.tags.definitions.find(d => d.id === 'draw')!.target = 10;
  const stats = roleStatistics(s);
  assert.equal(stats.roles.find(r => r.id === 'ramp')!.count, 2); assert.equal(stats.roles.find(r => r.id === 'draw')!.count, 2);
  assert.equal(stats.roles.find(r => r.id === 'draw')!.target, 10); assert.equal(stats.roles.find(r => r.id === 'protection')!.count, 1);
  assert.equal(stats.untagged, 37); assert.equal(deckStatistics(s.groups).total, 40);
});
test('batch edits are idempotent, remove only the selected tag, and tag deletion clears all references', () => {
  const s = sheet(), tags = editableTags(s);
  setCardTag(tags, ['Engine', 'Engine', 'Idea'], 'ramp', true); setCardTag(tags, ['Engine'], 'ramp', true);
  setCardTag(tags, ['Engine'], 'draw', true); setCardTag(tags, ['Engine'], 'ramp', false);
  assert.deepEqual(tags.cards.find(c => c.name === 'Engine')!.tagIds, ['draw']);
  assert.equal(tags.cards.length, 2); removeTag(tags, 'ramp'); assert.equal(tags.cards.length, 1);
  removeTag(tags, 'draw'); assert.deepEqual(tags.cards, []); assert.throws(() => setCardTag(tags, ['Engine'], 'missing', true));
});
test('tags follow category/membership/cut/restore/printing changes and match all named copies', () => {
  const s = sheet(); s.tags = editableTags(s); setCardTag(s.tags, ['Engine'], 'draw', true);
  const entry = s.groups[1]!.entries.shift()!; s.groups[2]!.entries.push(entry);
  assert.equal(roleStatistics(s).roles.find(r => r.id === 'draw')!.count, 0);
  s.groups[2]!.entries.pop(); s.cuts.push(entry.card); assert.doesNotThrow(() => prepareProject(s));
  s.cuts.pop(); entry.card = { ...entry.card, image: 'chosen.jpg', set: 'tla' }; s.groups[1]!.entries.push(entry);
  s.groups[1]!.entries.push({ card: structuredClone(entry.card), quantity: 3 });
  assert.equal(roleStatistics(s).roles.find(r => r.id === 'draw')!.count, 5); assert.doesNotThrow(() => prepareProject(s));
});
test('one tag edit is undoable to the absent legacy field, redo restores definitions, targets and assignments', () => {
  const s = sheet(), h = new ProjectHistory(s), before = prepareProject(s);
  h.begin('Tags'); s.tags = editableTags(s); setCardTag(s.tags, ['Engine', 'Idea'], 'draw', true); s.tags.definitions[0]!.target = 0; h.commit();
  const after = prepareProject(s); s.workspace!.camera.x = 543;
  assert.equal(h.undo(), 'Tags'); assert.equal(s.tags, undefined); assert.deepEqual(s.groups, before.groups); assert.equal(s.workspace!.camera.x, 543);
  assert.equal(h.redo(), 'Tags'); assert.deepEqual(s.tags, after.tags);
  h.begin('Canceled'); removeTag(s.tags!, 'draw'); h.cancel(); assert.deepEqual(s.tags, after.tags);
});
test('invalid tags are rejected: duplicate names/ids, dangling cards/roles, targets and bounded data', () => {
  const s = sheet(); s.tags = editableTags(s); setCardTag(s.tags, ['Engine'], 'draw', true);
  const base = prepareProject(s); assert.doesNotThrow(() => parseBuilderProject(base));
  const mutations = [
    (p: typeof base) => { p.tags!.definitions[1]!.id = 'ramp'; },
    (p: typeof base) => { p.tags!.definitions[1]!.name = 'RAMP'; },
    (p: typeof base) => { p.tags!.definitions[0]!.name = ' '; },
    (p: typeof base) => { p.tags!.definitions[0]!.target = -1; },
    (p: typeof base) => { p.tags!.definitions[0]!.target = 1.5; },
    (p: typeof base) => { p.tags!.definitions[0]!.description = 'x'.repeat(1001); },
    (p: typeof base) => { p.tags!.cards[0]!.tagIds = ['missing']; },
    (p: typeof base) => { p.tags!.cards[0]!.tagIds = ['draw', 'draw']; },
    (p: typeof base) => { p.tags!.cards[0]!.name = 'Absent'; },
    (p: typeof base) => { p.tags!.cards.push(p.tags!.cards[0]!); },
    (p: typeof base) => { p.tags!.definitions = Array.from({ length: 65 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, description: '' })); },
  ];
  for (const mutate of mutations) { const p = structuredClone(base); mutate(p); assert.throws(() => parseBuilderProject(p)); }
  assert.equal(validProjectTags(null, new Set()), false); assert.equal(validProjectTags({ definitions: [], cards: [] }, new Set()), true);
});
test('tag names are escaped in badges, including markup-like custom names', () => {
  const s = sheet(); s.tags = { definitions: [{ id: 'custom', name: '<img onerror="x">', description: '' }], cards: [{ name: 'Engine', tagIds: ['custom'] }] };
  assert.ok(!tagBadges(s, 'Engine').includes('<img')); assert.match(tagBadges(s, 'Engine'), /&lt;img/);
});
test('tags are journaled before an immediate close and survive reload and serialized writes', async () => {
  const map = new Map<string, string>(); const storage: Storage = { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: k => { map.delete(k); } };
  const s = sheet(); s.tags = editableTags(s); setCardTag(s.tags, ['Engine'], 'draw', true);
  const sent: unknown[] = [], p = new ProjectPersistence(storage, async project => { sent.push(project); return { id: 1 }; }, () => {}, 60000);
  p.changed(s); const draft = loadDrafts(storage).drafts[0]!;
  assert.deepEqual(sheetFromProject(draft.project).tags, s.tags); assert.ok(map.has(DRAFT_PREFIX + s.projectId));
  assert.equal(await p.flush(), true); assert.deepEqual((sent[0] as typeof draft.project).tags, s.tags); assert.equal(map.size, 0);
});
