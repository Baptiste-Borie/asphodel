import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectHistory, historyShortcut } from './project-history';
import { prepareProject, ProjectPersistence, loadDrafts, type Storage } from './project-persistence';
import { assignZone, createZone, fitZones, reconcileWorkspace, setRowMembership } from './deck-workspace';
import { deckStatistics, type Sheet } from './deck-model';
import type { LabCard } from '../../../shared/deck-lab';

const card = (name: string, oracle_text = 'Portable card metadata'): LabCard => ({name,type_line:'Creature',cmc:3,mana_cost:null,oracle_text,power:null,toughness:null,loyalty:null,set:'tla',set_name:'Avatar',collector_number:'★12',rarity:'rare',lang:'en',color_identity:['G'],image:'https://cards.scryfall.io/chosen.png',related:[],faces:[{name:'Front',image:'front.png'},{name:'Back',image:'back.png'}]});
const sheet = (): Sheet => ({name:'Aang table',cuts:[],groups:[{name:'Commander',commander:true,entries:[{card:card('Aang'),quantity:1},{card:card('Appa'),quantity:1}]},{name:'Lands',entries:[{card:card('Forest'),quantity:37}]}]});
function mutate(h: ProjectHistory, label: string, action: () => void) { h.begin(label); action(); h.commit(); }
function storage(): Storage {
  const values=new Map<string,string>();return {get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);},removeItem:k=>{values.delete(k);}};
}
const project = (s: Sheet) => prepareProject(s);

test('V1 and V2 edits share exact states, stable ids and card printing metadata while preserving the current camera',()=>{
  const s=sheet(), h=new ProjectHistory(s);const before=project(s),workspace=s.workspace!;
  mutate(h,'Quantity',()=>{s.groups[1]!.entries[0]!.quantity=30;});
  mutate(h,'Rename category',()=>{s.groups[1]!.name='Mana';});
  mutate(h,'Move table card',()=>{workspace.cards.find(p=>p.name==='Forest')!.x=850;});
  const after=project(s);Object.assign(workspace.camera,{x:-700,y:250,zoom:.3});
  assert.equal(h.undo(),'Move table card');assert.equal(h.undo(),'Rename category');assert.equal(h.undo(),'Quantity');assert.equal(h.undo(),null);
  assert.deepEqual(s.groups,before.groups);assert.deepEqual(s.workspace!.cards,before.workspace.cards);assert.equal(s.workspace,workspace);
  assert.deepEqual(s.workspace!.camera,{x:-700,y:250,zoom:.3});
  assert.equal(h.redo(),'Quantity');assert.equal(h.redo(),'Rename category');assert.equal(h.redo(),'Move table card');
  assert.deepEqual(s.groups,after.groups);assert.deepEqual(s.workspace!.cards,after.workspace.cards);assert.equal(h.redo(),null);
});
test('a multi-card/zone gesture creates one action after many pointer updates, including final fitted bounds and z ordering',()=>{
  const s=sheet(),h=new ProjectHistory(s),w=s.workspace!,before=project(s);
  h.begin('Move entire zone');
  for(let frame=0;frame<80;frame++){
    for(const p of w.cards){p.x+=3;p.y-=2;p.z+=1;}
    w.zones[0]!.x+=3;w.zones[0]!.y-=2;h.sync();
  }
  fitZones(w,reconcileWorkspace(s,w));h.commit();const after=project(s);
  assert.equal(h.undo(),'Move entire zone');assert.deepEqual(s.workspace!.cards,before.workspace.cards);assert.deepEqual(s.workspace!.zones,before.workspace.zones);assert.equal(h.undo(),null);
  h.redo();assert.deepEqual(s.workspace!.cards,after.workspace.cards);assert.deepEqual(s.workspace!.zones,after.workspace.zones);
});
test('Escape/pointer cancellation restores positions, zone membership and layer order without consuming an action or losing redo',()=>{
  const s=sheet(),h=new ProjectHistory(s);
  mutate(h,'Quantity',()=>{s.groups[1]!.entries[0]!.quantity=30;});h.undo();const before=project(s);
  h.begin('Unfinished move');s.workspace!.cards[0]!.x=999;s.workspace!.cards[0]!.z=99;delete s.workspace!.cards[0]!.zoneId;
  assert.equal(h.state.canUndo,false);assert.equal(h.cancel(),true);assert.equal(h.cancel(),false);
  assert.deepEqual(project(s),before);assert.equal(h.state.canUndo,false);assert.equal(h.state.canRedo,true);h.redo();assert.equal(s.groups[1]!.entries[0]!.quantity,30);
});
test('batched membership changes preserve partners, quantities, origins and layout through undo/redo',()=>{
  const s=sheet(),h=new ProjectHistory(s),before=project(s);const ids=before.groups.flatMap(g=>g.entries.map(e=>e.id));
  mutate(h,'Exclude selected cards',()=>{for(const row of reconcileWorkspace(s,s.workspace!))setRowMembership(s,row,false);});
  const excluded=project(s);assert.equal(deckStatistics(s.groups).total,0);assert.equal(h.undo(),'Exclude selected cards');assert.equal(deckStatistics(s.groups).total,39);assert.deepEqual(project(s),before);
  h.redo();assert.deepEqual(project(s),excluded);assert.deepEqual(s.groups.flatMap(g=>g.entries.map(e=>e.id)).sort(),ids.sort());
  mutate(h,'Include selected cards',()=>{for(const row of reconcileWorkspace(s,s.workspace!))setRowMembership(s,row,true);});
  assert.equal(deckStatistics(s.groups).total,39);h.undo();assert.equal(deckStatistics(s.groups).total,0);
});
test('zone deletion and cut/restore reverse exactly; no-op edits and view navigation retain the redo branch',()=>{
  const s=sheet(),h=new ProjectHistory(s);const initial=project(s);
  mutate(h,'Create zone',()=>{s.workspace!.zones.push(createZone('Ideas',{x:1400,y:-50}));});
  const zone=s.workspace!.zones.at(-1)!;
  mutate(h,'Delete zone',()=>{assignZone(reconcileWorkspace(s,s.workspace!).filter(r=>r.placement.zoneId===zone.id),undefined);s.workspace!.zones=s.workspace!.zones.filter(z=>z.id!==zone.id);});
  h.undo();assert.equal(s.workspace!.zones.at(-1)!.id,zone.id);h.undo();assert.deepEqual(project(s),initial);
  h.begin('No change');assert.equal(h.commit(),false);s.workspace!.camera.zoom=.2;h.sync();assert.equal(h.state.canRedo,true);
  h.redo();h.redo();const beforeCut=project(s);
  mutate(h,'Cut entire quantity',()=>{const entry=s.groups[1]!.entries.pop()!;s.cuts.push(...Array.from({length:entry.quantity},()=>entry.card));});
  assert.equal(s.cuts.length,37);h.undo();assert.deepEqual(s.groups,beforeCut.groups);assert.deepEqual(s.cuts,beforeCut.cuts);
});
test('a new edit after undo discards redo and metadata snapshots cannot be changed through live card objects',()=>{
  const s=sheet(),h=new ProjectHistory(s);const original=s.groups[1]!.entries[0]!.card.oracle_text;
  mutate(h,'Quantity',()=>{s.groups[1]!.entries[0]!.quantity=30;});h.undo();
  mutate(h,'Printing metadata',()=>{s.groups[1]!.entries[0]!.card.oracle_text='Different metadata';});assert.equal(h.redo(),null);
  h.undo();assert.equal(s.groups[1]!.entries[0]!.card.oracle_text,original);h.redo();assert.equal(s.groups[1]!.entries[0]!.card.oracle_text,'Different metadata');
});
test('history is independent per deck and asynchronous database identity survives every undo',()=>{
  const one=sheet(),two=sheet(),first=new ProjectHistory(one),second=new ProjectHistory(two);
  mutate(first,'Rename',()=>{one.name='Changed';});one.backendId=42;const id=one.projectId;
  first.undo();assert.equal(one.backendId,42);assert.equal(one.projectId,id);assert.equal(second.undo(),null);assert.equal(two.name,'Aang table');
  const reloaded=new ProjectHistory(JSON.parse(JSON.stringify(one)));assert.equal(reloaded.state.canUndo,false);
});
test('entry and memory bounds prune old actions; card metadata is stored once across large-deck movements',()=>{
  const s=sheet();for(let i=0;i<180;i++)s.groups[1]!.entries.push({card:card(`Idea ${i}`,'Long metadata '.repeat(180)),quantity:1});
  const h=new ProjectHistory(s,undefined,3);const baseline=h.estimatedBytes;
  for(let i=0;i<8;i++)mutate(h,`Move ${i}`,()=>{s.workspace!.cards[0]!.x+=50;});
  assert.ok(h.estimatedBytes<baseline*2,'repeated movements share the large metadata payload');
  assert.equal(h.undo(),'Move 7');assert.equal(h.undo(),'Move 6');assert.equal(h.undo(),'Move 5');assert.equal(h.undo(),null);
  const small=sheet(),bounded=new ProjectHistory(small,undefined,100,1);
  mutate(bounded,'Rename',()=>{small.name='Latest state remains usable';});
  assert.equal(bounded.state.canUndo,false);assert.equal(bounded.undo(),null);assert.equal(small.name,'Latest state remains usable');
});
test('invalid intermediate states can be canceled back to a valid project without damaging history',()=>{
  const s=sheet(),h=new ProjectHistory(s),before=project(s);h.begin('Invalid quantity');s.groups[1]!.entries[0]!.quantity=0;
  assert.throws(()=>h.commit());assert.equal(h.cancel(),true);assert.deepEqual(project(s),before);assert.equal(h.state.canUndo,false);
});
test('undo during an older in-flight save journals and writes the newest state without rewinding the backend id',async()=>{
  const s=sheet(),local=storage(),h=new ProjectHistory(s),before=project(s);
  let finish!: (value:{id:number})=>void;const older=new Promise<{id:number}>(resolve=>{finish=resolve;});
  const sent:{p:unknown;id?:number}[]=[];
  const persistence=new ProjectPersistence(local,async(p,id)=>{sent.push({p,id});return sent.length===1?older:{id:44};},()=>{},60000);
  mutate(h,'Quantity',()=>{s.groups[1]!.entries[0]!.quantity=30;});persistence.changed(s);const draining=persistence.flush();
  h.undo();persistence.changed(s);assert.deepEqual(loadDrafts(local).drafts[0]!.project,before);
  finish({id:44});assert.equal(await draining,true);assert.equal(sent.length,2);assert.equal(sent[1]!.id,44);assert.deepEqual(sent[1]!.p,before);assert.equal(s.backendId,44);
  h.redo();persistence.changed(s);assert.equal(await persistence.flush(),true);assert.equal((sent[2]!.p as any).groups[1].entries[0].quantity,30);
});
test('keyboard shortcuts support Ctrl/Cmd+Z, Shift+Z and Ctrl+Y while leaving text editing, composition and dialogs alone',()=>{
  const key={key:'z',ctrlKey:true,metaKey:false,shiftKey:false,altKey:false,repeat:false,isComposing:false};
  assert.equal(historyShortcut(key,false,false),'undo');assert.equal(historyShortcut({...key,shiftKey:true},false,false),'redo');assert.equal(historyShortcut({...key,key:'y'},false,false),'redo');
  assert.equal(historyShortcut({...key,ctrlKey:false,metaKey:true},false,false),'undo');
  for(const event of [{...key,repeat:true},{...key,altKey:true},{...key,isComposing:true},{...key,ctrlKey:false}])assert.equal(historyShortcut(event,false,false),null);
  assert.equal(historyShortcut(key,true,false),null);assert.equal(historyShortcut(key,false,true),null);
});
