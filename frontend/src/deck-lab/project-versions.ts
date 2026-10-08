import { MAX_PROJECT_VERSIONS, parseBuilderProject, type NamedProjectVersion, type ProjectSnapshot } from '../../../shared/builder-project.mjs';
import { prepareProject } from './project-persistence';
import { deckStatistics, type Sheet } from './deck-model';

const nameKey = (name: string) => name.trim().normalize('NFKC').toLowerCase();
export function versionSnapshot(sheet: Sheet): ProjectSnapshot {
  const { version: _schema, projectId: _id, versions: _versions, ...state } = prepareProject(sheet);
  return state;
}
export function addProjectVersion(sheet: Sheet, name: string): NamedProjectVersion {
  const label = name.trim();
  if (!label || label.length > 80) throw new Error('Choisis un nom de version de 1 à 80 caractères.');
  if (sheet.versions?.some(v => nameKey(v.name) === nameKey(label))) throw new Error('Ce nom de version existe déjà.');
  if ((sheet.versions?.length ?? 0) >= MAX_PROJECT_VERSIONS) throw new Error('20 versions maximum. Supprime une version pour en enregistrer une nouvelle.');
  const v: NamedProjectVersion = { id: crypto.randomUUID(), name: label, createdAt: new Date().toISOString(), state: versionSnapshot(sheet) };
  const versions = [...(sheet.versions ?? []), v];
  // Validate the whole future project before changing the live sheet (including size limits).
  parseBuilderProject({ ...prepareProject(sheet), versions });
  sheet.versions = versions; return v;
}
export function findProjectVersion(sheet: Sheet, id: string): NamedProjectVersion {
  const v = sheet.versions?.find(v => v.id === id);
  if (!v) throw new Error('Version introuvable.');
  return v;
}
/** Prepare a restore without changing the live deck. A retained checkpoint protects the current work. */
export function planVersionRestore(sheet: Sheet, id: string) {
  const v = findProjectVersion(sheet, id), before = versionSnapshot(sheet);
  const scratch: Sheet = structuredClone(sheet);
  let backup = scratch.versions?.find(candidate => JSON.stringify(candidate.state) === JSON.stringify(before));
  if (!backup) {
    let suffix = 1;
    while (scratch.versions?.some(candidate => nameKey(candidate.name) === nameKey(`Avant restauration ${suffix}`))) suffix++;
    backup = addProjectVersion(scratch, `Avant restauration ${suffix}`);
  }
  return { state: structuredClone(v.state), versions: scratch.versions!, backupName: backup.name };
}
/** Preserve the workspace object held by a mounted table. Saved cameras are restored here. */
export function applyVersionState(sheet: Sheet, state: ProjectSnapshot) {
  const next = structuredClone(state);
  sheet.name = next.name; sheet.groups = next.groups; sheet.cuts = next.cuts;
  if (next.tags === undefined) delete sheet.tags; else sheet.tags = next.tags;
  if (sheet.workspace) { for (const key of Object.keys(sheet.workspace)) delete (sheet.workspace as any)[key]; Object.assign(sheet.workspace, next.workspace); }
  else sheet.workspace = next.workspace;
}
export function forkProjectVersion(sheet: Sheet, id: string): Sheet {
  const v = findProjectVersion(sheet, id);
  return { ...structuredClone(v.state), projectId: crypto.randomUUID(), name: `${v.state.name} · ${v.name}`.slice(0, 120) };
}

export type ComparisonSection = 'commander' | 'mainboard' | 'maybeboard' | 'cuts';
export type VersionCardChange = { name: string; section: ComparisonSection; before: number; after: number; delta: number };
function quantities(state: ProjectSnapshot) {
  const map = new Map<string, { name: string; section: ComparisonSection; quantity: number }>();
  const add = (name: string, section: ComparisonSection, quantity: number) => {
    const key = JSON.stringify([nameKey(name), section]), old = map.get(key);
    map.set(key, { name: old?.name ?? name, section, quantity: (old?.quantity ?? 0) + quantity });
  };
  for (const g of state.groups) for (const e of g.entries) add(e.card.name, g.commander ? 'commander' : g.maybeboard ? 'maybeboard' : 'mainboard', e.quantity);
  for (const c of state.cuts) add(c.name, 'cuts', 1);
  return map;
}
export function compareProjectVersions(before: ProjectSnapshot, after: ProjectSnapshot) {
  const a = quantities(before), b = quantities(after);
  const changes: VersionCardChange[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(key), next = b.get(key), delta = (next?.quantity ?? 0) - (old?.quantity ?? 0);
    if (delta) changes.push({ name: (next ?? old)!.name, section: (next ?? old)!.section, before: old?.quantity ?? 0, after: next?.quantity ?? 0, delta });
  }
  changes.sort((a,b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
  const summary = (s: ProjectSnapshot) => {
    const stats = deckStatistics(s.groups);
    return { total: stats.total, lands: stats.types.find(t => t.name === 'Land')!.count, average: stats.average, spells: stats.spells };
  };
  const played = changes.filter(c => c.section === 'mainboard' || c.section === 'commander');
  const printings = (s: ProjectSnapshot) => {
    const map = new Map<string, Set<string>>();
    for (const e of s.groups.flatMap(g=>g.entries)) {
      const key = nameKey(e.card.name), set = map.get(key) ?? new Set<string>();
      set.add(JSON.stringify([e.card.set,e.card.collector_number,e.card.lang,e.card.image,e.card.faces])); map.set(key,set);
    }
    return new Map([...map].map(([name,values])=>[name,JSON.stringify([...values].sort())]));
  };
  const imagesBefore = printings(before), imagesAfter = printings(after);
  return { changes, added: played.filter(c => c.delta > 0).reduce((n,c) => n+c.delta,0), removed: played.filter(c => c.delta < 0).reduce((n,c) => n-c.delta,0), before: summary(before), after: summary(after),
    tagsChanged: JSON.stringify(before.tags) !== JSON.stringify(after.tags),
    tableChanged: JSON.stringify(before.workspace) !== JSON.stringify(after.workspace),
    categoriesChanged: JSON.stringify(before.groups.map(g => [g.name, g.commander, g.maybeboard, g.entries.map(e=>[nameKey(e.card.name),e.quantity])])) !== JSON.stringify(after.groups.map(g => [g.name, g.commander, g.maybeboard, g.entries.map(e=>[nameKey(e.card.name),e.quantity])])),
    printingChanged: [...imagesBefore].some(([name,value])=>imagesAfter.has(name)&&imagesAfter.get(name)!==value),
  };
}
