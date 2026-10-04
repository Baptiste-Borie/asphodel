import test from 'node:test';
import assert from 'node:assert/strict';
import { deckStatistics, type Sheet } from './deck-model';
import { assignZone, createZone, fitZones, initializeZones, zoneAt, ZONE_MIN_WIDTH, ZONE_MIN_HEIGHT, emptyWorkspace, parseWorkspace, reconcileWorkspace, setRowMembership, screenToWorld, zoomAt } from './deck-workspace';
import type { LabCard } from '../../../shared/deck-lab';
const card = (name: string, type='Creature', cmc=3): LabCard => ({name,type_line:type,cmc,mana_cost:null,oracle_text:null,power:null,toughness:null,loyalty:null,set:'',set_name:'',collector_number:'',rarity:'',lang:'en',color_identity:['G'],image:'',related:[]});
const sheet = (): Sheet => ({name:'Test',cuts:[],groups:[{name:'Commander',commander:true,entries:[{card:card('Commander'),quantity:1}]},{name:'Lands',entries:[{card:card('Forest','Basic Land',0),quantity:37}]}]});
test('cut/restore preserves quantity, original role, position and statistics across reload',()=>{
  const deck=sheet(), workspace=emptyWorkspace();
  let rows=reconcileWorkspace(deck,workspace); const commander=rows[0]!;
  commander.placement.x=-900; commander.placement.y=650;
  setRowMembership(deck,commander,false);
  assert.equal(deckStatistics(deck.groups).total,37);
  const restored=parseWorkspace(JSON.stringify(workspace));
  rows=reconcileWorkspace(JSON.parse(JSON.stringify(deck)),restored);
  const cut=rows.find(r=>r.entry.card.name==='Commander')!;
  assert.equal(cut.placement.x,-900);assert.ok(cut.group.maybeboard);
  setRowMembership(deck,commander,true);
  assert.equal(deckStatistics(deck.groups).total,38);assert.ok(commander.group.commander);
  const lands=reconcileWorkspace(deck,workspace).find(r=>r.entry.card.name==='Forest')!;
  setRowMembership(deck,lands,false);assert.equal(deckStatistics(deck.groups).total,1);
  setRowMembership(deck,lands,true);assert.equal(lands.entry.quantity,37);assert.equal(lands.group.name,'Lands');
});
test('spatial changes and overlapping zones never change structured roles or totals',()=>{
  const deck=sheet(), before=JSON.stringify(deck), w=emptyWorkspace();
  const rows=reconcileWorkspace(deck,w);rows[1]!.placement.x=100000;
  w.zones.push({id:'z',name:'Draw',x:0,y:0,width:500,height:300});
  assert.equal(JSON.stringify(deck),before);assert.equal(deckStatistics(deck.groups).total,38);
  assert.equal(deckStatistics(deck.groups).average,3);assert.deepEqual(deckStatistics(deck.groups).curve,[0,0,0,1,0,0,0,0]);
});
test('V1 category changes retain placements; identical names in different categories match exactly first',()=>{
  const deck=sheet(), w=emptyWorkspace();reconcileWorkspace(deck,w)[1]!.placement.x=777;
  deck.groups[1]!.name='Mana';assert.equal(reconcileWorkspace(deck,w)[1]!.placement.x,777);
  deck.groups.push({name:'Other',entries:[{card:card('Forest','Basic Land',0),quantity:2}]});
  const rows=reconcileWorkspace(deck,w);rows[2]!.placement.x=123;
  deck.groups.reverse();const reordered=reconcileWorkspace(deck,w);
  assert.equal(reordered.find(r=>r.group.name==='Other')!.placement.x,123);
  assert.equal(reordered.find(r=>r.group.name==='Mana')!.placement.x,777);
});
test('zoom is anchored under the pointer and clamped',()=>{
  const c={x:-70,y:100,zoom:.7}, p={x:500,y:200};const before=screenToWorld(p,c);
  zoomAt(c,p,1.5);assert.ok(Math.abs(screenToWorld(p,c).x-before.x)<1e-8);
  zoomAt(c,p,100);assert.equal(c.zoom,2.5);zoomAt(c,p,0);assert.equal(c.zoom,.08);
});
test('workspace parser rejects invalid persisted transforms',()=>{
  assert.throws(()=>parseWorkspace('{broken'));
  assert.throws(()=>parseWorkspace(JSON.stringify({...emptyWorkspace(),camera:{x:0,y:0,zoom:-1}})));
  assert.deepEqual(parseWorkspace(null),emptyWorkspace());
});

test('fresh table starts with two fitted zones, without changing deck data',()=>{
  const deck=sheet(), before=JSON.stringify(deck), w=emptyWorkspace();
  const rows=reconcileWorkspace(deck,w); initializeZones(w,rows,true);
  assert.deepEqual(w.zones.map(z=>z.name),['Commandant','À trier']);
  assert.equal(rows[0]!.placement.zoneId,w.zones[0]!.id);
  assert.equal(rows[1]!.placement.zoneId,w.zones[1]!.id);
  assert.equal(JSON.stringify(deck),before);
  initializeZones(w,rows,true);assert.equal(w.zones.length,2);
  assert.ok(rows[1]!.placement.x > rows[0]!.placement.x + 170);
});
test('zone fits actual card bounds, shrinks after removal, and keeps a minimum when empty',()=>{
  const w=emptyWorkspace(),rows=reconcileWorkspace(sheet(),w),z=createZone('Draw',{x:0,y:0});w.zones.push(z);
  rows[0]!.placement.x=-100;rows[0]!.placement.y=-200;
  rows[1]!.placement.x=1200;rows[1]!.placement.y=700;
  const positions=rows.map(r=>({x:r.placement.x,y:r.placement.y}));
  assignZone(rows,z.id);fitZones(w,rows);
  assert.equal(z.x,-124);assert.equal(z.y,-252);assert.equal(z.width,1518);assert.equal(z.height,1214);
  assignZone([rows[1]!],undefined);fitZones(w,rows);
  assert.equal(z.width,ZONE_MIN_WIDTH);assert.equal(z.height,ZONE_MIN_HEIGHT);
  assignZone(rows,undefined);fitZones(w,rows);
  assert.equal(z.width,ZONE_MIN_WIDTH);assert.equal(z.height,ZONE_MIN_HEIGHT);
  assert.deepEqual(rows.map(r=>({x:r.placement.x,y:r.placement.y})),positions);
});
test('zone target handles overlap deterministically, and outside drop leaves cards free',()=>{
  const w=emptyWorkspace(),rows=reconcileWorkspace(sheet(),w);
  const large={...createZone('Large',{x:0,y:0}),width:1000,height:1000};
  const small=createZone('Small',{x:100,y:100});w.zones.push(large,small);
  assert.equal(zoneAt(w,{x:150,y:150})?.id,small.id);
  assert.equal(zoneAt(w,{x:900,y:900})?.id,large.id);
  assert.equal(zoneAt(w,{x:-1,y:-1}),undefined);
  const deckBefore=JSON.stringify(rows.map(r=>r.group));assignZone(rows,small.id);
  assignZone(rows,zoneAt(w,{x:-1,y:-1})?.id);assert.ok(rows.every(r=>r.placement.zoneId===undefined));
  assert.equal(JSON.stringify(rows.map(r=>r.group)),deckBefore);
});
test('old workspace migration preserves positions/camera and infers existing zone membership once',()=>{
  const w=emptyWorkspace(),rows=reconcileWorkspace(sheet(),w);
  const zone={...createZone('Existing',{x:-20,y:-20}),width:200,height:300};w.zones.push(zone);
  const before=rows.map(r=>({x:r.placement.x,y:r.placement.y})),camera={...w.camera};
  initializeZones(w,rows,false);assert.equal(rows[0]!.placement.zoneId,zone.id);
  assert.deepEqual(rows.map(r=>({x:r.placement.x,y:r.placement.y})),before);assert.deepEqual(w.camera,camera);
  const restored=parseWorkspace(JSON.stringify(w));initializeZones(restored,reconcileWorkspace(sheet(),restored),false);
  assert.equal(restored.zones.length,3);assert.equal(restored.cards[0]!.zoneId,zone.id);
  restored.zones=[];initializeZones(restored,reconcileWorkspace(sheet(),restored),false);assert.equal(restored.zones.length,0);
});
