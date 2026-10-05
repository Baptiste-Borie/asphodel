import type { LabCard } from './deck-lab.js';

export type ProjectPoint = { x: number; y: number };
export type ProjectPlacement = ProjectPoint & { id: string; name: string; category: string; section: string; z: number; zoneId?: string; origin?: { category: string; commander: boolean; groupId?: string }; cut?: boolean };
export type ProjectZone = ProjectPoint & { id: string; name: string; width: number; height: number };
export type ProjectWorkspace = { version: 1; zonesInitialized?: boolean; cards: ProjectPlacement[]; zones: ProjectZone[]; camera: ProjectPoint & { zoom: number } };
export type ProjectGroup = { id?: string; name: string; entries: { id?: string; card: LabCard; quantity: number }[]; commander?: boolean; maybeboard?: boolean };
export type BuilderProject = { version: 1; projectId: string; name: string; groups: ProjectGroup[]; cuts: LabCard[]; workspace: ProjectWorkspace };
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const identifier = (v: unknown): v is string => text(v, 100) && /^[a-zA-Z0-9_-]+$/.test(v);
const card = (v: any): boolean => v && text(v.name) && !!v.name.trim() && text(v.type_line, 1000) && finite(v.cmc)
  && text(v.image, 4000) && Array.isArray(v.color_identity) && v.color_identity.every((s: unknown) => text(s, 10))
  && Array.isArray(v.related) && v.related.every((s: unknown) => text(s))
  && ['mana_cost', 'oracle_text', 'power', 'toughness', 'loyalty'].every(k => v[k] === null || text(v[k], 20000))
  && ['set_name', 'set', 'collector_number', 'rarity', 'lang'].every(k => text(v[k], 1000));

/** Validate both API snapshots and recovery journals before rendering or updating SQLite. */
export function parseBuilderProject(value: unknown): BuilderProject {
  const p = value as BuilderProject;
  const w = p?.workspace;
  if (!p || p.version !== 1 || !identifier(p.projectId) || !text(p.name, 120) || !p.name.trim()
    || !Array.isArray(p.groups) || p.groups.length > 60 || p.groups.filter(g => g?.commander).length !== 1 || !Array.isArray(p.cuts) || p.cuts.length > 3000 || !p.cuts.every(card)
    || !p.groups.every(g => g && identifier(g.id) && text(g.name, 60) && !!g.name.trim()
      && (g.commander === undefined || typeof g.commander === 'boolean') && (g.maybeboard === undefined || typeof g.maybeboard === 'boolean')
      && !(g.commander && g.maybeboard) && Array.isArray(g.entries) && g.entries.length <= 300
      && g.entries.every(e => e && identifier(e.id) && card(e.card) && Number.isSafeInteger(e.quantity) && e.quantity >= 1 && e.quantity <= 999))
    || !w || w.version !== 1 || !Array.isArray(w.cards) || w.cards.length > 18000 || !Array.isArray(w.zones) || w.zones.length > 1000
    || !w.camera || !finite(w.camera.x) || !finite(w.camera.y) || !finite(w.camera.zoom) || w.camera.zoom < .08 || w.camera.zoom > 2.5
    || !w.cards.every(c => c && identifier(c.id) && text(c.name) && text(c.category, 60) && ['commander', 'mainboard', 'maybeboard'].includes(c.section)
      && finite(c.x) && finite(c.y) && finite(c.z) && (c.zoneId === undefined || identifier(c.zoneId))
      && (c.cut === undefined || typeof c.cut === 'boolean')
      && (!c.origin || (text(c.origin.category, 60) && typeof c.origin.commander === 'boolean' && (c.origin.groupId === undefined || identifier(c.origin.groupId)))))
    || !w.zones.every(z => z && identifier(z.id) && text(z.name, 60) && finite(z.x) && finite(z.y) && finite(z.width) && finite(z.height) && z.width > 0 && z.height > 0)
    || (w.zonesInitialized !== undefined && typeof w.zonesInitialized !== 'boolean')) throw new Error('Projet de construction invalide.');
  for (const ids of [p.groups.map(g => g.id), p.groups.flatMap(g => g.entries.map(e => e.id)), w.cards.map(c => c.id), w.zones.map(z => z.id)]) {
    if (new Set(ids).size !== ids.length) throw new Error('Identifiants de projet dupliqués.');
  }
  if (JSON.stringify(p).length > 4_000_000) throw new Error('Projet trop volumineux.');
  return p;
}
