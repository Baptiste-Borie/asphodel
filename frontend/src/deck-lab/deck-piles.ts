import type { ProjectPile } from '../../../shared/builder-project.mjs';
import { assignZone, zoneAt, CARD_WIDTH, CARD_HEIGHT, PILE_HEADER, ZONE_MIN_WIDTH, ZONE_MIN_HEIGHT, type Row, type Workspace, type Zone } from './deck-workspace';

export type Pile = ProjectPile;
const FAN_STEP = 42;
const FAN_COLUMNS = 8;

export function pileRows(pile: Pile, rows: Row[]): Row[] {
  const byId = new Map(rows.map(row => [row.placement.id, row]));
  return pile.cardIds.map(id => byId.get(id)).filter((row): row is Row => !!row);
}
export function pileFor(workspace: Workspace, id: string): Pile | undefined {
  return workspace.piles?.find(p => p.cardIds.includes(id));
}
export function visibleInPile(workspace: Workspace, id: string): boolean {
  const pile = pileFor(workspace, id);
  return !pile || pile.expanded || pile.cardIds.slice(-3).includes(id);
}
export function pileBounds(pile: Pile, rows: Row[]) {
  const members = pileRows(pile, rows);
  return { x:pile.x, y:pile.y, width:Math.max(CARD_WIDTH + 12, ...members.map(r => r.placement.x + CARD_WIDTH - pile.x)),
    height:Math.max(PILE_HEADER + CARD_HEIGHT, ...members.map(r => r.placement.y + CARD_HEIGHT - pile.y)) };
}
/** Repack only on explicit create/expand/collapse/arrange commands. */
export function arrangePile(workspace: Workspace, pile: Pile, rows: Row[]) {
  let z = Math.max(0,...workspace.cards.map(c => c.z));
  pileRows(pile, rows).forEach((row,i) => Object.assign(row.placement, {
    x:pile.x + (pile.expanded ? i % FAN_COLUMNS * FAN_STEP : Math.min(i,3)*4),
    y:pile.y + PILE_HEADER + (pile.expanded ? Math.floor(i / FAN_COLUMNS)*(CARD_HEIGHT+24) : Math.min(i,3)*3), z:++z,
  }));
}
export function detachPileCards(workspace: Workspace, ids: Iterable<string>) {
  if (!workspace.piles) return;
  const detached = new Set(ids);
  for (const p of workspace.piles) p.cardIds = p.cardIds.filter(id => !detached.has(id));
  workspace.piles = workspace.piles.filter(p => p.cardIds.length > 0);
}
export function createPile(workspace: Workspace, rows: Row[], ids: Iterable<string>, name: string): Pile | undefined {
  const chosen = new Set(ids), members = rows.filter(r => chosen.has(r.placement.id));
  if (members.length < 2) return;
  const pile: Pile = { id:crypto.randomUUID(), name:name.trim().slice(0,60)||'Nouvelle pile', expanded:false,
    x:Math.min(...members.map(r=>r.placement.x)), y:Math.min(...members.map(r=>r.placement.y)), cardIds:members.map(r=>r.placement.id) };
  detachPileCards(workspace,pile.cardIds);(workspace.piles ??= []).push(pile);
  const zone = zoneAt(workspace,{x:pile.x+CARD_WIDTH/2,y:pile.y+PILE_HEADER+CARD_HEIGHT/2});
  arrangePile(workspace,pile,rows);assignZone(members,zone?.id);
  return pile;
}
export function dissolvePile(workspace: Workspace, pile: Pile, rows: Row[]) {
  // Leave a usable fan instead of hidden overlapping cards; no card is removed.
  pile.expanded=true;arrangePile(workspace,pile,rows);
  workspace.piles=workspace.piles?.filter(p=>p.id!==pile.id);
}
export function addToPile(workspace: Workspace, pile: Pile, rows: Row[], ids: Iterable<string>) {
  const chosen = new Set(ids), added = rows.filter(r => chosen.has(r.placement.id) && !pile.cardIds.includes(r.placement.id));
  if (!added.length) return;
  detachPileCards(workspace,added.map(r=>r.placement.id));pile.cardIds.push(...added.map(r=>r.placement.id));
  assignZone(added,pileRows(pile,rows)[0]?.placement.zoneId);arrangePile(workspace,pile,rows);
}
export function resizeZone(zone: Zone, width: number, height: number) {
  if (zone.locked) return;
  zone.sizing='manual';zone.width=Math.max(ZONE_MIN_WIDTH,width);zone.height=Math.max(ZONE_MIN_HEIGHT,height);
}
/** Explicit grid command. Piles are moved as units and stay intact. */
export function arrangeZone(workspace: Workspace, zone: Zone, rows: Row[]) {
  if (zone.locked) return;
  const members=rows.filter(r=>r.placement.zoneId===zone.id), grouped=new Set<string>();
  const units: {point:{x:number;y:number};width:number;height:number;members:Row[]}[]=[];
  for (const p of workspace.piles ?? []) {
    const cards=pileRows(p,rows);
    if (!cards.length || !cards.every(r=>r.placement.zoneId===zone.id))continue;
    const bounds=pileBounds(p,rows);units.push({point:p,width:bounds.width,height:bounds.height,members:cards});
    cards.forEach(r=>grouped.add(r.placement.id));
  }
  for (const r of members.filter(r=>!grouped.has(r.placement.id))) units.push({point:r.placement,width:CARD_WIDTH,height:CARD_HEIGHT,members:[]});
  const columns=Math.max(1,Math.min(5,Math.ceil(Math.sqrt(units.length))));
  const width=Math.max(CARD_WIDTH,...units.map(u=>u.width))+24, height=Math.max(CARD_HEIGHT,...units.map(u=>u.height))+24;
  const start={x:zone.x+24,y:zone.y+60};
  units.forEach((u,i)=>{
    const x=start.x+i%columns*width,y=start.y+Math.floor(i/columns)*height,dx=x-u.point.x,dy=y-u.point.y;
    u.point.x=x;u.point.y=y;for(const r of u.members){r.placement.x+=dx;r.placement.y+=dy;}
  });
}
