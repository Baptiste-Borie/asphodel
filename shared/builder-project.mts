import type { LabCard } from './deck-lab.js';
import { validProjectTags, type ProjectTags } from './deck-tags.mjs';

export type ProjectPoint = { x: number; y: number };
export type ProjectPlacement = ProjectPoint & { id: string; name: string; category: string; section: string; z: number; zoneId?: string; origin?: { category: string; commander: boolean; groupId?: string }; cut?: boolean };
export type ProjectZone = ProjectPoint & { id: string; name: string; width: number; height: number; sizing?: 'auto' | 'manual'; locked?: boolean };
export type ProjectPile = ProjectPoint & { id: string; name: string; expanded: boolean; cardIds: string[] };
export type ProjectNote = ProjectPoint & { id: string; text: string; color: 'sand' | 'sage' | 'lavender'; cardId?: string };
export type ProjectWorkspace = { version: 1; zonesInitialized?: boolean; cards: ProjectPlacement[]; zones: ProjectZone[]; piles?: ProjectPile[]; notes?: ProjectNote[]; camera: ProjectPoint & { zoom: number } };
export type ProjectGroup = { id?: string; name: string; entries: { id?: string; card: LabCard; quantity: number }[]; commander?: boolean; maybeboard?: boolean };
export type ProjectSnapshot = { name: string; groups: ProjectGroup[]; cuts: LabCard[]; workspace: ProjectWorkspace; tags?: ProjectTags };
export type NamedProjectVersion = { id: string; name: string; createdAt: string; state: ProjectSnapshot };
export type BuilderProject = ProjectSnapshot & { version: 1; projectId: string; versions?: NamedProjectVersion[] };
export const MAX_PROJECT_VERSIONS = 20;
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const identifier = (v: unknown): v is string => text(v, 100) && /^[a-zA-Z0-9_-]+$/.test(v);
/** Additive workspace fields: old projects stay readable without rearranging cards. */
export function validWorkspaceExtras(w: ProjectWorkspace): boolean {
  if (!w.zones.every(z => (z.sizing === undefined || ['auto','manual'].includes(z.sizing)) && (z.locked === undefined || typeof z.locked === 'boolean'))) return false;
  if (w.notes !== undefined && (!Array.isArray(w.notes) || w.notes.length > 500
    || !w.notes.every(n => n && identifier(n.id) && text(n.text,4000) && finite(n.x) && finite(n.y)
      && ['sand','sage','lavender'].includes(n.color) && (n.cardId === undefined || (identifier(n.cardId) && w.cards.some(c => c.id === n.cardId))))
    || new Set(w.notes.map(n => n.id)).size !== w.notes.length)) return false;
  if (w.piles === undefined) return true;
  if (!Array.isArray(w.piles) || w.piles.length > 1000) return false;
  const placements = new Set(w.cards.map(c => c.id));
  const ids = new Set<string>();
  for (const p of w.piles) {
    if (!p || !identifier(p.id) || !text(p.name,60) || !p.name.trim() || !finite(p.x) || !finite(p.y) || typeof p.expanded !== 'boolean'
      || !Array.isArray(p.cardIds) || p.cardIds.length < 1 || p.cardIds.length > 18000) return false;
    for (const id of p.cardIds) { if (!identifier(id) || !placements.has(id) || ids.has(id)) return false; ids.add(id); }
  }
  return new Set(w.piles.map(p => p.id)).size === w.piles.length;
}
const faces = (v: any): boolean => v === undefined || (Array.isArray(v) && v.length <= 16 && v.every(f => f && text(f.name) && text(f.image,4000)));
const printing = (v: any): boolean => v && ['set_name','set','collector_number','rarity','lang'].every(k => text(v[k],1000)) && text(v.image,4000) && faces(v.faces);
const card = (v: any): boolean => v && text(v.name) && !!v.name.trim() && text(v.type_line, 1000) && finite(v.cmc)
  && text(v.image, 4000) && Array.isArray(v.color_identity) && v.color_identity.every((s: unknown) => text(s, 10))
  && Array.isArray(v.related) && v.related.every((s: unknown) => text(s))
  && ['mana_cost', 'oracle_text', 'power', 'toughness', 'loyalty'].every(k => v[k] === null || text(v[k], 20000))
  && ['set_name', 'set', 'collector_number', 'rarity', 'lang'].every(k => text(v[k], 1000)) && faces(v.faces)
  && (v.otherPrintings === undefined || (Array.isArray(v.otherPrintings) && v.otherPrintings.length <= 64 && v.otherPrintings.every(printing)))
  && (v.commander_legal === undefined || text(v.commander_legal,100));

/** Validate both API snapshots and recovery journals before rendering or updating SQLite. */
export function parseBuilderProject(value: unknown): BuilderProject {
  const p = parseProjectCore(value);
  if (p.versions !== undefined) {
    if (!Array.isArray(p.versions) || p.versions.length > MAX_PROJECT_VERSIONS) throw new Error('Versions de projet invalides (20 maximum).');
    const ids = new Set<string>(), names = new Set<string>();
    for (const v of p.versions) {
      const key = typeof v?.name === 'string' ? v.name.trim().normalize('NFKC').toLowerCase() : '';
      if (!v || !identifier(v.id) || ids.has(v.id) || !text(v.name, 80) || !key || names.has(key)
        || !text(v.createdAt, 40) || !Number.isFinite(Date.parse(v.createdAt)) || new Date(v.createdAt).toISOString() !== v.createdAt
        || !v.state || typeof v.state !== 'object' || Array.isArray(v.state)
        || Object.keys(v.state).some(k => !['name','groups','cuts','workspace','tags'].includes(k))) throw new Error('Versions de projet invalides.');
      parseProjectCore({ ...v.state, version: 1, projectId: p.projectId });
      ids.add(v.id); names.add(key);
    }
  }
  return p;
}

function parseProjectCore(value: unknown): BuilderProject {
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
    || (w.zonesInitialized !== undefined && typeof w.zonesInitialized !== 'boolean') || !validWorkspaceExtras(w)) throw new Error('Projet de construction invalide.');
  const entries = new Set(p.groups.flatMap(g => g.entries.map(e => e.id)));
  if (p.tags !== undefined && !validProjectTags(p.tags, new Set([...p.groups.flatMap(g => g.entries.map(e => e.card.name)), ...p.cuts.map(c => c.name)]))) throw new Error('Tags de projet invalides.');
  if (w.notes?.some(note => note.cardId !== undefined && !entries.has(note.cardId))) throw new Error('Une note référence une carte absente de la table.');
  if (w.piles?.some(pile => pile.cardIds.some(id => !entries.has(id)))) throw new Error('Une pile référence une carte absente de la table.');
  for (const ids of [p.groups.map(g => g.id), p.groups.flatMap(g => g.entries.map(e => e.id)), w.cards.map(c => c.id), w.zones.map(z => z.id)]) {
    if (new Set(ids).size !== ids.length) throw new Error('Identifiants de projet dupliqués.');
  }
  if (JSON.stringify(p).length > 4_000_000) throw new Error('Projet trop volumineux.');
  return p;
}
