import assert from 'node:assert/strict';
import test from 'node:test';
import { DRAFT_PREFIX, loadDrafts, prepareProject, ProjectPersistence, sheetFromProject, type Storage } from './project-persistence';
import { emptyWorkspace, reconcileWorkspace, setRowMembership } from './deck-workspace';
import type { Sheet } from './deck-model';
import type { LabCard } from '../../../shared/deck-lab';

const card = (name: string): LabCard => ({name,type_line:'Creature',cmc:3,mana_cost:null,oracle_text:null,power:null,toughness:null,loyalty:null,set:'',set_name:'',collector_number:'',rarity:'',lang:'en',color_identity:['G'],image:'',related:[]});
const sheet = (): Sheet => ({name:'Aang ideas',cuts:[],groups:[{name:'Commander',commander:true,entries:[]},{name:'Ramp',entries:[{card:card('Forest'),quantity:37}]}]});
function storage(): Storage {
  const map = new Map<string,string>();
  return {getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);},removeItem:k=>{map.delete(k);},key:i=>[...map.keys()][i]??null,get length(){return map.size;}};
}
function deferred<T>() { let resolve!: (v:T)=>void; const promise = new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }

test('journal exists before any deferred write, including empty sheets; immediate close drains it',async()=>{
  const local=storage(),deck=sheet();deck.groups[1]!.entries=[];
  const writes:unknown[]=[];const manager=new ProjectPersistence(local,async p=>{writes.push(p);return{id:42};},()=>{},60_000);
  manager.changed(deck);
  assert.equal(writes.length,0);assert.equal(loadDrafts(local).drafts[0]!.project.groups[1]!.entries.length,0);
  assert.equal(await manager.flush(),true);assert.equal(deck.backendId,42);assert.equal(loadDrafts(local).drafts.length,0);
});
test('older success cannot mark a newer edit saved or replace its journal; creation id attaches to newest snapshot',async()=>{
  const local=storage(),deck=sheet(),first=deferred<{id:number}>(),second=deferred<{id:number}>();
  let calls=0;const sent:unknown[]=[];
  const manager=new ProjectPersistence(local,async(p,id)=>{sent.push({p,id});return ++calls===1?first.promise:second.promise;},()=>{},60_000);
  manager.changed(deck);const close=manager.flush();
  deck.name='Newer name';deck.workspace!.camera.x=999;manager.changed(deck);
  first.resolve({id:7});await new Promise(r=>setImmediate(r));
  assert.equal(manager.status(deck),'pending');const draft=loadDrafts(local).drafts[0]!;
  assert.equal(draft.project.name,'Newer name');assert.equal(draft.project.workspace.camera.x,999);assert.equal(draft.backendId,7);
  assert.equal((sent[1] as any).id,7);second.resolve({id:7});assert.equal(await close,true);
  assert.equal(manager.status(deck),'saved');assert.equal(loadDrafts(local).drafts.length,0);
});
test('failed writes stay recoverable across a new process/controller and succeed on explicit retry',async()=>{
  const local=storage(),deck=sheet();let failing=true;
  const manager=new ProjectPersistence(local,async()=>{if(failing)throw Error('disk failure');return{id:8};},()=>{},60_000);
  manager.changed(deck);assert.equal(await manager.flush(),false);assert.equal(manager.status(deck),'error');
  const recovered=sheetFromProject(loadDrafts(local).drafts[0]!.project);assert.deepEqual(recovered.groups,deck.groups);
  failing=false;await manager.retry(deck);assert.equal(manager.status(deck),'saved');assert.equal(loadDrafts(local).drafts.length,0);
});
test('legacy migration retains positions/camera and old key; stable entry ids survive rename, reorder and exclusion',()=>{
  const local=storage(),deck=sheet();deck.backendId=5;
  const old=emptyWorkspace();const rows=reconcileWorkspace(deck,old);rows[0]!.placement.x=777;old.camera={x:-100,y:345,zoom:.4};
  old.zonesInitialized=true;
  local.setItem('asphodel.deck-table.v1.5',JSON.stringify(old));
  const project=prepareProject(deck,local),id=deck.groups[1]!.entries[0]!.id;
  deck.groups[1]!.name='Mana';deck.groups.reverse();
  const renamed=reconcileWorkspace(deck,deck.workspace!)[0]!;
  assert.equal(renamed.placement.id,id);assert.equal(renamed.placement.x,777);assert.deepEqual(deck.workspace!.camera,old.camera);
  setRowMembership(deck,renamed,false);const origin=deck.groups.find(g=>g.id===renamed.placement.origin!.groupId)!;origin.name='Renamed while excluded';
  setRowMembership(deck,renamed,true);assert.equal(renamed.group.name,'Renamed while excluded');
  assert.ok(local.getItem('asphodel.deck-table.v1.5'));assert.equal(project.projectId,'deck-5');
});
test('corrupt journals remain untouched and are reported; confirmed journals do not become crash recovery',()=>{
  const local=storage();local.setItem(DRAFT_PREFIX+'corrupt','{invalid');
  assert.deepEqual(loadDrafts(local),{drafts:[],unreadable:1});assert.equal(local.getItem(DRAFT_PREFIX+'corrupt'),'{invalid');
});
test('quota failure is surfaced; a successful database write can still make current changes safe',async()=>{
  const local=storage();local.setItem=()=>{throw Error('QuotaExceeded');};const errors:unknown[]=[];
  const manager=new ProjectPersistence(local,async()=>({id:9}),(_s,_status,error)=>{if(error)errors.push(error);},60_000);
  const deck=sheet();manager.changed(deck);assert.equal(manager.status(deck),'error');
  assert.equal(await manager.flush(),true);assert.ok(errors.length);assert.equal(manager.status(deck),'saved');
});

test('invalid edits block close even if an earlier revision was saved',async()=>{
  const local=storage(),deck=sheet(),manager=new ProjectPersistence(local,async()=>({id:3}),()=>{},60_000);
  manager.changed(deck);assert.equal(await manager.flush(),true);
  deck.groups[1]!.entries[0]!.quantity=0;assert.throws(()=>manager.changed(deck));
  assert.equal(manager.status(deck),'error');assert.equal(await manager.flush(),false);
  deck.groups[1]!.entries[0]!.quantity=37;await manager.retry(deck);assert.equal(await manager.flush(),true);
});
test('confirmed journals are removed; a deleted sheet cannot create a new journal on table disposal',async()=>{
  const local=storage(),deck=sheet();let writes=0;
  const manager=new ProjectPersistence(local,async()=>{writes++;return{id:4};},()=>{},60_000);
  manager.changed(deck);await manager.flush();assert.equal(local.length,0);
  await manager.remove(deck);deck.name='Disposed deleted sheet';manager.changed(deck);await manager.flush();
  assert.equal(local.length,0);assert.equal(writes,1);
});
