import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBuilderProject } from '../../../shared/builder-project.mjs';
import type { LabCard } from '../../../shared/deck-lab';
import { deckStatistics, type Sheet } from './deck-model';
import { addToPile, arrangePile, arrangeZone, createPile, detachPileCards, dissolvePile, pileBounds, pileRows, resizeZone, visibleInPile } from './deck-piles';
import { assignZone, createZone, fitZones, parseWorkspace, reconcileWorkspace } from './deck-workspace';
import { ProjectHistory } from './project-history';
import { prepareProject, sheetFromProject } from './project-persistence';
const card=(name:string):LabCard=>({name,type_line:'Creature',cmc:3,mana_cost:null,oracle_text:'Printing metadata',power:null,toughness:null,loyalty:null,set:'tla',set_name:'Avatar',collector_number:'12',rarity:'rare',lang:'en',color_identity:['G'],image:'chosen.png',related:[],faces:[{name:'Front',image:'front.png'},{name:'Back',image:'back.png'}]});
const sheet=():Sheet=>({name:'Pile table',cuts:[],groups:[{name:'Commander',commander:true,entries:[{card:card('Aang'),quantity:1}]},{name:'Lands',entries:[{card:card('Forest'),quantity:37},{card:card('Draw'),quantity:1}]},{name:'Candidates',maybeboard:true,entries:[{card:card('Idea'),quantity:2}]}]});
const setup=()=>{const s=sheet(),h=new ProjectHistory(s),w=s.workspace!,rows=reconcileWorkspace(s,w);return {s,h,w,rows};};
function edit(h:ProjectHistory,label:string,action:()=>void){h.begin(label);action();h.commit();}

test('named piles preserve roles, quantities, printing metadata and ids; undo removes the additive field',()=>{
  const {s,h,w,rows}=setup(),before=prepareProject(s);
  edit(h,'Create pile',()=>{createPile(w,rows,rows.map(r=>r.placement.id),'Protection for Aang');});
  const after=prepareProject(s),pile=w.piles![0]!;
  assert.deepEqual(after.groups,before.groups);assert.deepEqual(after.cuts,before.cuts);assert.equal(deckStatistics(s.groups).total,39);
  assert.equal(pile.cardIds.length,4);assert.equal(pileRows(pile,rows).reduce((n,r)=>n+r.entry.quantity,0),41);
  h.undo();assert.deepEqual(prepareProject(s),before);assert.equal(w.piles,undefined);
  h.redo();assert.deepEqual(prepareProject(s),after);assert.equal(w.piles![0]!.id,pile.id);
});
test('a 200-card table expands only the requested pile; visibility and zone bounds include its header',()=>{
  const {s,h,w}=setup();for(let i=0;i<196;i++)s.groups[2]!.entries.push({card:card(`Candidate ${i}`),quantity:1});
  const rows=reconcileWorkspace(s,w),untouched={...rows[0]!.placement};
  edit(h,'Create pile',()=>{createPile(w,rows,rows.slice(1).map(r=>r.placement.id),'Candidates');});
  const p=w.piles![0]!;assert.equal(rows.filter(r=>visibleInPile(w,r.placement.id)).length,4);
  edit(h,'Expand',()=>{p.expanded=true;arrangePile(w,p,rows);fitZones(w,rows);});
  assert.equal(rows.filter(r=>visibleInPile(w,r.placement.id)).length,200);assert.deepEqual(rows[0]!.placement,untouched);
  const bounds=pileBounds(p,rows),zone=w.zones.find(z=>z.id===rows[1]!.placement.zoneId)!;
  assert.ok(bounds.width<=170+7*42);assert.ok(zone.y<p.y);assert.ok(bounds.height>238);
  const expanded=prepareProject(s);edit(h,'Collapse',()=>{p.expanded=false;arrangePile(w,p,rows);fitZones(w,rows);});
  h.undo();assert.deepEqual(prepareProject(s),expanded);
});
test('adding, extracting, cancellation and dissolution are reversible without changing the deck',()=>{
  const {s,h,w,rows}=setup();edit(h,'Pile',()=>{createPile(w,rows,rows.slice(0,2).map(r=>r.placement.id),'Mana');});
  const p=w.piles![0]!,baseline=prepareProject(s);
  edit(h,'Add',()=>{addToPile(w,p,rows,new Set([rows[2]!.placement.id,rows[0]!.placement.id]));});
  assert.equal(p.cardIds.length,3);const added=prepareProject(s);
  h.begin('Extract');detachPileCards(w,[rows[0]!.placement.id]);rows[0]!.placement.x=999;h.cancel();assert.deepEqual(prepareProject(s),added);
  edit(h,'Extract',()=>{detachPileCards(w,[rows[0]!.placement.id]);});assert.equal(w.piles![0]!.cardIds.length,2);h.undo();assert.deepEqual(prepareProject(s),added);
  edit(h,'Dissolve',()=>{dissolvePile(w,w.piles![0]!,reconcileWorkspace(s,w));});assert.equal(w.piles!.length,0);assert.equal(deckStatistics(s.groups).total,39);h.undo();assert.deepEqual(prepareProject(s),added);
  h.undo();assert.deepEqual(prepareProject(s),baseline);
});
test('V1 cuts prune removed pile members without moving survivors; undo restores all 37 copies',()=>{
  const {s,h,w,rows}=setup();edit(h,'Pile',()=>{createPile(w,rows,rows.map(r=>r.placement.id),'Ideas');});
  const before=prepareProject(s),id=w.piles![0]!.id,removed=rows[1]!.placement.id;
  edit(h,'Cut',()=>{const entry=s.groups[1]!.entries.shift()!;s.cuts.push(...Array.from({length:entry.quantity},()=>entry.card));});
  assert.equal(w.piles![0]!.id,id);assert.ok(!w.piles![0]!.cardIds.includes(removed));assert.equal(s.cuts.length,37);
  assert.deepEqual(w.cards.filter(c=>c.id!==removed),before.workspace.cards.filter(c=>c.id!==removed));h.undo();assert.deepEqual(prepareProject(s),before);
});
test('manual/locked zone frames survive fit/reload and leave cards free; unlock retains manual sizing',()=>{
  const {s,h,w,rows}=setup(),z=w.zones[1]!,positions=JSON.stringify(w.cards);
  edit(h,'Resize',()=>{resizeZone(z,700,600);});fitZones(w,rows);assert.equal(z.width,700);assert.equal(z.sizing,'manual');assert.equal(JSON.stringify(w.cards),positions);
  edit(h,'Lock',()=>{z.locked=true;});const locked=prepareProject(s);resizeZone(z,900,900);arrangeZone(w,z,rows);fitZones(w,rows);assert.deepEqual(prepareProject(s),locked);
  const loaded=sheetFromProject(locked);assert.deepEqual(parseWorkspace(JSON.stringify(loaded.workspace)),w);
  edit(h,'Unlock',()=>{z.locked=false;});fitZones(w,rows);assert.equal(z.width,700);assert.equal(z.sizing,'manual');
  edit(h,'Auto fit',()=>{z.sizing='auto';fitZones(w,rows);});assert.notEqual(z.width,700);h.undo();assert.equal(w.zones[1]!.width,700);
});
test('explicit zone arrangement moves piles as units and leaves other zones alone',()=>{
  const {s,h,w,rows}=setup();edit(h,'Pile',()=>{createPile(w,rows,rows.slice(1,3).map(r=>r.placement.id),'Mana');});
  const p=w.piles![0]!,z=createZone('Target',{x:700,y:800});w.zones.push(z);assignZone(pileRows(p,rows),z.id);assignZone([rows[3]!],z.id);
  const free={...rows[0]!.placement},relative=pileRows(p,rows).map(r=>({x:r.placement.x-p.x,y:r.placement.y-p.y})),before=prepareProject(s);
  edit(h,'Arrange',()=>{arrangeZone(w,z,rows);fitZones(w,rows);});
  assert.deepEqual(rows[0]!.placement,free);assert.deepEqual(pileRows(p,rows).map(r=>({x:r.placement.x-p.x,y:r.placement.y-p.y})),relative);assert.equal(deckStatistics(s.groups).total,39);
  h.undo();assert.deepEqual(prepareProject(s),before);
});
test('validation rejects malformed piles, duplicate membership, dangling ids and invalid zone modes; old projects still load',()=>{
  const {s,h,w,rows}=setup();edit(h,'Pile',()=>{createPile(w,rows,rows.map(r=>r.placement.id),'Ideas');});const p=prepareProject(s);
  for(const mutate of [
    (v:typeof p)=>{v.workspace.piles![0]!.expanded='yes' as any;},
    (v:typeof p)=>{v.workspace.piles![0]!.cardIds.push(v.workspace.piles![0]!.cardIds[0]!);},
    (v:typeof p)=>{v.workspace.piles!.push({...v.workspace.piles![0]!,id:'other'});},
    (v:typeof p)=>{v.workspace.piles![0]!.cardIds=['absent'];},
    (v:typeof p)=>{v.workspace.zones[0]!.locked='yes' as any;},
    (v:typeof p)=>{v.workspace.zones[0]!.sizing='unexpected' as any;},
    (v:typeof p)=>{v.workspace.piles=null as any;},
  ]){const bad=structuredClone(p);mutate(bad);assert.throws(()=>parseBuilderProject(bad));assert.throws(()=>parseWorkspace(JSON.stringify(bad.workspace)));}
  const missing=structuredClone(p);missing.groups[1]!.entries=[];assert.throws(()=>parseBuilderProject(missing));
  const old=structuredClone(p);delete old.workspace.piles;assert.deepEqual(parseBuilderProject(old),old);
});
