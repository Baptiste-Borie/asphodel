import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBuilderProject, MAX_PROJECT_VERSIONS } from '../../../shared/builder-project.mjs';
import { addProjectVersion, applyVersionState, compareProjectVersions, forkProjectVersion, planVersionRestore, versionSnapshot } from './project-versions';
import { ProjectHistory } from './project-history';
import { prepareProject, ProjectPersistence, loadDrafts, sheetFromProject, type Storage } from './project-persistence';
import type { Sheet } from './deck-model';

const card = (name: string) => ({name,type_line:'Basic Land',cmc:0,mana_cost:null,oracle_text:null,power:null,toughness:null,loyalty:null,set:'tla',set_name:'Avatar',collector_number:'1',rarity:'common',lang:'en',color_identity:['G'],image:'chosen.jpg',related:[],faces:[{name:'Front',image:'front.jpg'},{name:'Back',image:'back.jpg'}]});
const sheet = (): Sheet => ({name:'My build',backendId:7,cuts:[card('Cut')],groups:[{name:'Commander',commander:true,entries:[{card:card('Leader'),quantity:1}]},{name:'Mana',entries:[{card:card('Forest'),quantity:37}]},{name:'Maybe',maybeboard:true,entries:[{card:card('Idea'),quantity:2}]}],tags:{definitions:[{id:'draw',name:'Draw',description:'Manual',target:8}],cards:[{name:'Idea',tagIds:['draw']}]}});

test('named checkpoints are independent complete states with no nested checkpoints or database identity',()=>{
  const s=sheet(); prepareProject(s); s.workspace!.notes=[{id:'note',text:'Try this',color:'sage',x:10,y:20}];
  const v=addProjectVersion(s,'Base'), copy=structuredClone(v);
  s.groups[1]!.entries[0]!.quantity=30; s.workspace!.notes[0]!.text='New thought'; s.tags!.definitions[0]!.target=10; addProjectVersion(s,'More draw');
  assert.deepEqual(v,copy); assert.equal(s.versions!.length,2); assert.equal('versions' in v.state,false); assert.equal('backendId' in v.state,false); assert.equal('projectId' in v.state,false);
  assert.equal(v.state.groups[1]!.entries[0]!.card.faces![1]!.image,'back.jpg'); assert.equal(v.state.cuts[0]!.name,'Cut');
  assert.deepEqual(sheetFromProject(prepareProject(s),7).versions,s.versions);
});
test('names, bounded count, invalid snapshots and recursive payloads are rejected before replacing work',()=>{
  const s=sheet(); addProjectVersion(s,'Base');
  for (const name of ['','  ','BASE','Ｂａｓｅ','x'.repeat(81)]) assert.throws(()=>addProjectVersion(s,name));
  const p=prepareProject(s);
  for (const mutate of [
    (p:any)=>p.versions[0].state.groups[1].entries[0].quantity=0,
    (p:any)=>p.versions[0].state.versions=[],
    (p:any)=>p.versions[0].createdAt='yesterday',
    (p:any)=>p.versions.push(structuredClone(p.versions[0])),
    (p:any)=>p.versions[0].state.tags.cards[0].name='Missing',
  ]) { const bad=structuredClone(p); mutate(bad); assert.throws(()=>parseBuilderProject(bad)); }
  for(let i=1;i<MAX_PROJECT_VERSIONS;i++) addProjectVersion(s,'Trial '+i);
  const before=structuredClone(s); assert.throws(()=>addProjectVersion(s,'Overflow'),/20/); assert.deepEqual(s,before);
});
test('comparison uses real quantities, separates commanders/candidates/cuts, ignores category moves and table coordinates',()=>{
  const s=sheet(), before=versionSnapshot(s), after=structuredClone(before);
  after.groups[1]!.entries[0]!.quantity=34;
  after.groups.push({id:'draw',name:'Draw',entries:[{id:'new',card:card('Draw card'),quantity:2}]});
  after.groups[0]!.entries[0]!.card=card('New leader');
  after.groups[2]!.entries[0]!.quantity=1; after.cuts.push(card('Cut'));
  const diff=compareProjectVersions(before,after);
  assert.equal(diff.added,3); assert.equal(diff.removed,4); assert.equal(diff.after.total,37);
  assert.equal(diff.changes.find(c=>c.name==='Forest')!.delta,-3); assert.equal(diff.changes.find(c=>c.section==='maybeboard')!.delta,-1); assert.equal(diff.changes.find(c=>c.section==='cuts')!.delta,1);
  const moved=structuredClone(before); moved.groups.push({id:'second',name:'Different',entries:moved.groups[1]!.entries.splice(0)}); moved.workspace.camera.x=900;
  assert.deepEqual(compareProjectVersions(before,moved).changes,[]); assert.equal(compareProjectVersions(before,moved).tableChanged,true);
  assert.equal(compareProjectVersions(before,moved).printingChanged,false,'category order never creates a printing change');
  moved.groups.at(-1)!.entries[0]!.card.faces![1]!.image='different-back.jpg';
  assert.equal(compareProjectVersions(before,moved).printingChanged,true);
});
test('inclusion changes show the candidate removal and played addition; split copies aggregate without false duplicates',()=>{
  const before=versionSnapshot(sheet()), after=structuredClone(before);
  after.groups[1]!.entries.push(...after.groups[2]!.entries.splice(0));
  const diff=compareProjectVersions(before,after); assert.equal(diff.added,2); assert.equal(diff.removed,0);
  assert.deepEqual(diff.changes.filter(c=>c.name==='Idea').map(c=>[c.section,c.delta]),[['mainboard',2],['maybeboard',-2]]);
  const split=structuredClone(before); split.groups[1]!.entries[0]!.quantity=20; split.groups.push({id:'lands2',name:'Other lands',entries:[{id:'forest2',card:card('Forest'),quantity:17}]});
  assert.deepEqual(compareProjectVersions(before,split).changes,[]);
});
test('restore protects current work, keeps ids and workspace identity, and construction undo never erases checkpoints',()=>{
  const s=sheet(), h=new ProjectHistory(s), v=addProjectVersion(s,'Base'), originalId=s.projectId, w=s.workspace!;
  h.begin('Change quantity'); s.groups[1]!.entries[0]!.quantity=20; h.commit(); const work=versionSnapshot(s);
  const plan=planVersionRestore(s,v.id); assert.equal(s.versions!.length,1); assert.deepEqual(plan.versions.at(-1)!.state,work);
  h.begin('Restore'); s.versions=plan.versions; applyVersionState(s,plan.state); h.commit();
  assert.equal(s.workspace,w); assert.equal(s.backendId,7); assert.equal(s.projectId,originalId); assert.equal(s.groups[1]!.entries[0]!.quantity,37);
  const retained=structuredClone(s.versions); h.undo(); assert.equal(s.groups[1]!.entries[0]!.quantity,20); assert.deepEqual(s.versions,retained);
  h.redo(); assert.equal(s.groups[1]!.entries[0]!.quantity,37); assert.deepEqual(s.versions,retained);
});
test('a full version shelf blocks an unprotected restore, but reuses an existing identical checkpoint',()=>{
  const s=sheet(), v=addProjectVersion(s,'Base'); for(let i=1;i<20;i++)addProjectVersion(s,'Version '+i);
  assert.equal(planVersionRestore(s,v.id).versions.length,20);
  s.groups[1]!.entries[0]!.quantity=18; const before=structuredClone(s);
  assert.throws(()=>planVersionRestore(s,v.id),/20/); assert.deepEqual(s,before);
});
test('fork makes a separate editable deck with a new identity and no inherited history or checkpoints',()=>{
  const s=sheet(), v=addProjectVersion(s,'Variant'), fork=forkProjectVersion(s,v.id);
  assert.notEqual(fork.projectId,s.projectId); assert.equal(fork.backendId,undefined); assert.equal(fork.versions,undefined); assert.equal(fork.name,'My build · Variant');
  fork.groups[1]!.entries[0]!.quantity=4; assert.equal(v.state.groups[1]!.entries[0]!.quantity,37); assert.equal(s.groups[1]!.entries[0]!.quantity,37);
  assert.throws(()=>forkProjectVersion(s,'missing'));
});
test('checkpoint creation during an in-flight write is journaled and acknowledged without losing the current deck or versions',async()=>{
  const values=new Map<string,string>(), storage:Storage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);},removeItem:k=>{values.delete(k);}};
  const s=sheet(), writes:any[]=[], waiters:(()=>void)[]=[];
  const persistence=new ProjectPersistence(storage,async p=>{writes.push(structuredClone(p));await new Promise<void>(resolve=>waiters.push(resolve));return{id:7};},()=>{},60_000);
  persistence.changed(s);const flushed=persistence.flush();addProjectVersion(s,'Base');persistence.changed(s);
  const draft=loadDrafts(storage).drafts[0]!;assert.equal(draft.project.versions!.length,1);
  waiters.shift()!();await new Promise(resolve=>setImmediate(resolve));assert.equal(writes.length,2);waiters.shift()!();assert.equal(await flushed,true);
  assert.equal(writes[0].versions,undefined);assert.equal(writes[1].versions.length,1);assert.equal(values.size,0);
});
