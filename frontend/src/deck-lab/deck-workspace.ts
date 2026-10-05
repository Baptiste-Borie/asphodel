import type { Group, Sheet } from './deck-model';

import type { ProjectPoint, ProjectPlacement, ProjectZone, ProjectWorkspace } from '../../../shared/builder-project.mjs';
export type Point = ProjectPoint;
export type Placement = ProjectPlacement;
export type Zone = ProjectZone;
export type Workspace = ProjectWorkspace;
export type Row = { group: Group; entry: Group['entries'][number]; placement: Placement };
export const sectionOf = (g: Group) => g.commander ? 'commander' : g.maybeboard ? 'maybeboard' : 'mainboard';
export const emptyWorkspace = (): Workspace => ({ version: 1, cards: [], zones: [], camera: { x: 50, y: 65, zoom: .65 } });
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Untrusted local storage is validated before it can affect transforms or reconciliation. */
export function parseWorkspace(raw: string | null): Workspace {
  if (!raw) return emptyWorkspace();
  const value = JSON.parse(raw) as Workspace;
  if (value.version !== 1 || !Array.isArray(value.cards) || !Array.isArray(value.zones)
    || !value.camera || !finite(value.camera.x) || !finite(value.camera.y) || !finite(value.camera.zoom)
    || value.camera.zoom < .08 || value.camera.zoom > 2.5
    || !value.cards.every(c => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.category === 'string' && typeof c.section === 'string' && finite(c.x) && finite(c.y) && finite(c.z) && (c.zoneId === undefined || typeof c.zoneId === 'string') && (!c.origin || (typeof c.origin.category === 'string' && typeof c.origin.commander === 'boolean')))
    || !value.zones.every(z => z && typeof z.id === 'string' && typeof z.name === 'string' && finite(z.x) && finite(z.y) && finite(z.width) && finite(z.height) && z.width > 0 && z.height > 0)
    || (value.zonesInitialized !== undefined && typeof value.zonesInitialized !== 'boolean')
    || new Set(value.zones.map(z => z.id)).size !== value.zones.length
    || new Set(value.cards.map(c => c.id)).size !== value.cards.length) throw new Error('Invalid workspace');
  return value;
}

/** Match exact deck rows first, then retain positions across category/section changes in V1. */
export function reconcileWorkspace(sheet: Sheet, workspace: Workspace): Row[] {
  const pending = sheet.groups.flatMap(group => group.entries.map(entry => ({ group, entry })));
  const available = new Set(workspace.cards);
  const matches = new Map<typeof pending[number], Placement>();
  for (const row of pending) {
    const match = [...available].find(p => p.id === row.entry.id);
    if (match) { matches.set(row, match); available.delete(match); }
  }
  const assigned = new Set(pending.map(r => r.entry.id).filter(Boolean));
  for (const row of pending.filter(r => !matches.has(r))) {
    const match = [...available].find(p => !assigned.has(p.id) && p.name === row.entry.card.name && p.category === row.group.name && p.section === sectionOf(row.group));
    if (match) { matches.set(row, match); available.delete(match); }
  }
  return pending.map(row => {
    let placement = matches.get(row) ?? [...available].find(p => !assigned.has(p.id) && p.name === row.entry.card.name);
    if (placement) available.delete(placement);
    else {
      const i = workspace.cards.length;
      placement = { id: row.entry.id ?? crypto.randomUUID(), name: row.entry.card.name, category: row.group.name, section: sectionOf(row.group), x: (i % 10) * 190, y: Math.floor(i / 10) * 275, z: i };
      workspace.cards.push(placement);
    }
    placement.category = row.group.name;
    placement.section = sectionOf(row.group);
    return { ...row, placement };
  });
}

/** Exclusion is a deck command, never a geometric test. Preserve quantities and commander role. */
export function setRowMembership(sheet: Sheet, row: Row, included: boolean) {
  if (included === !row.group.maybeboard) return;
  const { placement, entry, group } = row;
  if (!included) placement.origin = { category: group.name, commander: !!group.commander, ...(group.id ? { groupId: group.id } : {}) };
  const name = included ? placement.origin?.category ?? 'Unsorted' : group.name;
  const commander = included && !!placement.origin?.commander;
  let destination = sheet.groups.find(g => included && placement.origin?.groupId ? g.id === placement.origin.groupId && !g.maybeboard : g.name === name && !!g.commander === commander && !!g.maybeboard === !included);
  if (!destination) {
    destination = { name, commander, maybeboard: !included, entries: [] };
    sheet.groups.push(destination);
  }
  const index = group.entries.indexOf(entry);
  if (index < 0) return;
  group.entries.splice(index, 1);
  destination.entries.push(entry);
  placement.category = destination.name;
  placement.section = sectionOf(destination);
  placement.cut = !included;
  row.group = destination;
}

export function screenToWorld(point: Point, camera: Workspace['camera']): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}
export function zoomAt(camera: Workspace['camera'], anchor: Point, zoom: number) {
  const world = screenToWorld(anchor, camera);
  camera.zoom = Math.max(.08, Math.min(2.5, zoom));
  camera.x = anchor.x - world.x * camera.zoom;
  camera.y = anchor.y - world.y * camera.zoom;
}


export const CARD_WIDTH = 170;
export const CARD_HEIGHT = 238;
export const ZONE_MIN_WIDTH = 250;
export const ZONE_MIN_HEIGHT = 314;
const ZONE_PADDING = 24;
const ZONE_HEADER = 52;

export function createZone(name: string, point: Point): Zone {
  return { id: crypto.randomUUID(), name, ...point, width: ZONE_MIN_WIDTH, height: ZONE_MIN_HEIGHT };
}

/** Bounds describe only the spatial members. They never pack, snap or move a card. */
export function fitZones(workspace: Workspace, rows: Row[]) {
  for (const zone of workspace.zones) {
    const members = rows.filter(row => row.placement.zoneId === zone.id).map(row => row.placement);
    if (!members.length) {
      zone.width = ZONE_MIN_WIDTH;
      zone.height = ZONE_MIN_HEIGHT;
      continue;
    }
    zone.x = Math.min(...members.map(p => p.x)) - ZONE_PADDING;
    zone.y = Math.min(...members.map(p => p.y)) - ZONE_HEADER;
    zone.width = Math.max(ZONE_MIN_WIDTH, Math.max(...members.map(p => p.x + CARD_WIDTH)) - zone.x + ZONE_PADDING);
    zone.height = Math.max(ZONE_MIN_HEIGHT, Math.max(...members.map(p => p.y + CARD_HEIGHT)) - zone.y + ZONE_PADDING);
  }
}

/** Smallest overlapping zone wins; the latest zone wins ties. Stable until drop. */
export function zoneAt(workspace: Workspace, point: Point): Zone | undefined {
  return [...workspace.zones].reverse()
    .filter(z => point.x >= z.x && point.x <= z.x + z.width && point.y >= z.y && point.y <= z.y + z.height)
    .sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

export function assignZone(rows: Row[], zoneId: string | undefined) {
  for (const row of rows) {
    if (zoneId) row.placement.zoneId = zoneId;
    else delete row.placement.zoneId;
  }
}

/** Upgrade once. Existing workspaces retain every card coordinate and the saved camera. */
export function initializeZones(workspace: Workspace, rows: Row[], fresh: boolean) {
  if (workspace.zonesInitialized) return;
  // Infer membership of earlier hand-sized zones before their first automatic fit.
  for (const row of rows) {
    const p = row.placement;
    p.zoneId = zoneAt(workspace, { x: p.x + CARD_WIDTH / 2, y: p.y + CARD_HEIGHT / 2 })?.id;
  }
  const commander = createZone('Commandant', { x: 0, y: 0 });
  const unsorted = createZone('À trier', { x: 340, y: 0 });
  workspace.zones.unshift(commander, unsorted);
  let commanderIndex = 0, unsortedIndex = 0;
  const columns = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(rows.length * 1.4))));
  for (const row of rows) {
    if (row.placement.zoneId) continue;
    const zone = row.group.commander ? commander : unsorted;
    row.placement.zoneId = zone.id;
    if (fresh) {
      const i = row.group.commander ? commanderIndex++ : unsortedIndex++;
      row.placement.x = zone.x + ZONE_PADDING + (row.group.commander ? 0 : i % columns) * 194;
      row.placement.y = zone.y + ZONE_HEADER + (row.group.commander ? i : Math.floor(i / columns)) * 266;
    }
  }
  workspace.zonesInitialized = true;
  fitZones(workspace, rows);
}
