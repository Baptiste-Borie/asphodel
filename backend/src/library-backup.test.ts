import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from './db/client.js';
import { createTestDatabase, FakeCardProvider } from './test-helpers.js';
import { DeckService } from './decks/deck-service.js';
import { LibraryBackupService } from './decks/library-backup-service.js';
import { buildApp } from './app.js';
import { parseLibraryBackup, type LibrarySnapshot } from '../../shared/library-backup.mjs';
import type { BuilderProject } from '../../shared/builder-project.mjs';
import type { PlaytestSessionManager } from './human/playtest-session-manager.js';

const card = { name:'Forest',type_line:'Basic Land',cmc:0,mana_cost:null,oracle_text:null,power:null,toughness:null,loyalty:null,set:'tla',set_name:'Avatar',collector_number:'123',rarity:'common',lang:'en',color_identity:['G'],image:'https://cards.scryfall.io/selected.png',related:[] };
const project = (): BuilderProject => ({ version:1,projectId:'portable-project',name:'Portable table',groups:[
  {id:'commanders',name:'Commander',commander:true,entries:[{id:'commander-one',card:{...card,name:'Aang'},quantity:1},{id:'commander-two',card:{...card,name:'Appa'},quantity:1}]},
  {id:'lands',name:'Lands',entries:[{id:'forest',card,quantity:37}]},
  {id:'empty',name:'Draw to find',entries:[]},
  {id:'candidates',name:'Candidates',maybeboard:true,entries:[{id:'idea',card:{...card,name:'Idea'},quantity:2}]},
],cuts:[{...card,name:'Discarded idea'}],workspace:{version:1,zonesInitialized:true,cards:[
  {id:'forest',name:'Forest',category:'Lands',section:'mainboard',x:-340,y:1280,z:9,zoneId:'zone'},
],zones:[{id:'zone',name:'Plan for Aang',x:-500,y:800,width:1000,height:900,sizing:'manual',locked:true}],piles:[{id:'mana-pile',name:'Mana to test',x:-340,y:1228,expanded:false,cardIds:['forest']}],camera:{x:270,y:-110,zoom:.27}} });
function comparable(snapshot: LibrarySnapshot) {
  const names = new Map(snapshot.cards.map(c=>[c.id,c.normalizedName]));
  return {...snapshot,cards:snapshot.cards.map(({id,...c})=>c).sort((a,b)=>a.name.localeCompare(b.name)),
    entries:snapshot.entries.map(e=>({...e,cardId:names.get(e.cardId)})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
}

test('portable backup restores complete projects and legacy decks offline into a fresh profile and survives restart',async()=>{
  const source=await createTestDatabase();const dir=await mkdtemp(join(tmpdir(),'asphodel-backup-'));
  let target=await createDatabase(`file:${join(dir,'restored.sqlite')}`);
  try {
    const decks=new DeckService(source.db,new FakeCardProvider());
    const p=project();const saved=await decks.saveProject(p);
    await decks.saveProject({...project(),projectId:'empty-project',name:'Empty project',groups:[{id:'commander',name:'Commander',commander:true,entries:[]}],cuts:[],workspace:{version:1,cards:[],zones:[],camera:{x:0,y:0,zoom:1}}});
    const legacy=await decks.createDeck('Legacy deck','Commander\n1 Aang\n\nMainboard\n40 Forest');
    const archive=await new LibraryBackupService(source.db).snapshot();
    // Validate the on-disk format, including a pending draft and unmigrated table layout.
    const backup=parseLibraryBackup(JSON.parse(JSON.stringify({format:'asphodel-library',version:1,createdAt:new Date().toISOString(),appVersion:'0.1.3',library:archive,
      display:{fullscreen:false},storage:{[`asphodel.deck-table.v1.${legacy.id}`]:'{"camera":{"x":-8}}','asphodel.builder-draft.v1.unreadable':'damaged journal kept'}})));
    await new LibraryBackupService(target.db).restore(backup.library);
    assert.deepEqual(comparable(await new LibraryBackupService(target.db).snapshot()),comparable(archive));
    target.close();target=await createDatabase(`file:${join(dir,'restored.sqlite')}`);
    const detail=await new DeckService(target.db,new FakeCardProvider()).getDeck(saved.id);
    assert.deepEqual(detail.project,p);assert.equal(detail.totalCards,39);assert.equal(detail.cards.find(c=>c.section==='maybeboard')!.quantity,2);
    assert.equal((await new DeckService(target.db,new FakeCardProvider()).getDeck(legacy.id)).project,null);
  } finally {source.close();target.close();await rm(dir,{recursive:true,force:true});}
});
test('restore validation rejects future formats, duplicated identities, missing cards and mismatched project membership',async()=>{
  const db=await createTestDatabase();try {
    await new DeckService(db.db,new FakeCardProvider()).saveProject(project());const service=new LibraryBackupService(db.db);const before=await service.snapshot();
    for (const mutate of [
      (x:LibrarySnapshot)=>x.decks.push(x.decks[0]!),
      (x:LibrarySnapshot)=>{x.cards=[];},
      (x:LibrarySnapshot)=>{x.projects[0]!.state.groups[1]!.entries[0]!.quantity=5;},
      (x:LibrarySnapshot)=>{x.projects[0]!.state.workspace.camera.zoom=-1;},
    ]) { const bad=structuredClone(before);mutate(bad);await assert.rejects(service.restore(bad));assert.deepEqual(await service.snapshot(),before); }
    assert.throws(()=>parseLibraryBackup({format:'asphodel-library',version:2}));
    const payload={format:'asphodel-library',version:1,createdAt:new Date().toISOString(),appVersion:'0.1.3',library:before,display:{fullscreen:true},storage:{'unrelated.secret':'forbidden'}};
    assert.throws(()=>parseLibraryBackup(payload));
  } finally {db.close();}
});
test('a mid-restore SQLite failure rolls back the old library, timestamps, cards and tables',async()=>{
  const db=await createTestDatabase();try {
    const decks=new DeckService(db.db,new FakeCardProvider());await decks.saveProject(project());const service=new LibraryBackupService(db.db);const before=await service.snapshot();
    const next=structuredClone(before);next.decks[0]!.name='Should roll back';next.projects[0]!.state.name='Should roll back';
    await db.client.execute("CREATE TRIGGER reject_restore BEFORE INSERT ON deck_projects BEGIN SELECT RAISE(ABORT, 'test disk full'); END;");
    await assert.rejects(service.restore(next));assert.deepEqual(await service.snapshot(),before);
  } finally {db.close();}
});
test('backup API is portable and restore rejects active playtests and invalid snapshots',async()=>{
  const db=await createTestDatabase();let active=false;
  const manager={getActiveState:()=>active?{sessionId:'active'}:null,close:async()=>{}} as unknown as PlaytestSessionManager;
  const app=await buildApp({database:db,cardProvider:new FakeCardProvider(),playtestSessionManager:manager});try {
    await new DeckService(db.db,new FakeCardProvider()).saveProject(project());
    const response=await app.inject({method:'GET',url:'/decks/library-backup'});assert.equal(response.statusCode,200);
    const snapshot=response.json();active=true;
    assert.equal((await app.inject({method:'POST',url:'/decks/library-restore',payload:snapshot})).statusCode,409);
    active=false;assert.equal((await app.inject({method:'POST',url:'/decks/library-restore',payload:{decks:[]}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/decks/library-restore',payload:snapshot})).statusCode,200);
    assert.deepEqual(comparable((await app.inject({method:'GET',url:'/decks/library-backup'})).json()),comparable(snapshot));
  } finally {await app.close();db.close();}
});
