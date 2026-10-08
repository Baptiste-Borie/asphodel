import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { createTestDatabase, FakeCardProvider } from './test-helpers.js';
import { DeckService } from './decks/deck-service.js';
import { LibraryBackupService } from './decks/library-backup-service.js';
import { parseBuilderProject, type BuilderProject } from '../../shared/builder-project.mjs';

const card = {name:'Forest',type_line:'Basic Land',cmc:0,mana_cost:null,oracle_text:null,power:null,toughness:null,loyalty:null,set:'tla',set_name:'Avatar',collector_number:'1',rarity:'common',lang:'en',color_identity:['G'],image:'chosen.jpg',related:[]};
function project(): BuilderProject {
  const base:BuilderProject={version:1,projectId:'versioned-deck',name:'Current',groups:[{id:'cmd',name:'Commander',commander:true,entries:[]},{id:'mana',name:'Mana',entries:[{id:'forest',card,quantity:37}]}],cuts:[],workspace:{version:1,cards:[],zones:[],notes:[{id:'note',text:'Current note',color:'sage',x:20,y:30}],camera:{x:0,y:0,zoom:1}}};
  const {version:_v,projectId:_id,...state}=structuredClone(base);
  state.name='Previous deck name'; state.groups[1]!.entries[0]!.quantity=40;
  state.groups[1]!.entries.push({id:'old-card',card:{...card,name:'Only in the old version'},quantity:2});
  state.workspace.notes![0]!.text='Old note';
  base.versions=[{id:'base-version',name:'Base',createdAt:'2026-10-07T15:00:00.000Z',state}]; return base;
}

test('named versions persist across API/SQLite reopen without leaking saved cards into the playable deck',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'asphodel-versions-')),url=`file:${join(dir,'decks.sqlite')}`;
  let db=await createDatabase(url),app=await buildApp({database:db,cardProvider:new FakeCardProvider()});
  try {
    const p=project(),saved=await app.inject({method:'POST',url:'/decks/projects',payload:p});assert.equal(saved.statusCode,201);
    const id=saved.json().id;assert.equal(saved.json().totalCards,37);assert.equal(saved.json().cards.length,1);
    await app.close();db.close();db=await createDatabase(url);app=await buildApp({database:db,cardProvider:new FakeCardProvider()});
    const reopened=(await app.inject({method:'GET',url:`/decks/${id}`})).json();assert.deepEqual(reopened.project,p);assert.equal(reopened.cards.length,1);
    for(const mutate of [
      (x:any)=>x.versions[0].state.groups[1].entries[0].quantity=0,
      (x:any)=>x.versions[0].state.versions=x.versions,
      (x:any)=>x.versions[0].state.workspace.notes[0].cardId='missing',
      (x:any)=>x.versions[0].createdAt='not-a-date',
      (x:any)=>x.versions.push({...x.versions[0],id:'other'}),
    ]){
      const bad=structuredClone(p);mutate(bad);
      // Recursive data cannot be serialized; the prohibited key is enough to exercise the API boundary.
      if((bad.versions![0]!.state as any).versions) (bad.versions![0]!.state as any).versions=[];
      const response=await app.inject({method:'PUT',url:`/decks/${id}/project`,payload:bad});assert.equal(response.statusCode,400,response.body);
      assert.deepEqual((await app.inject({method:'GET',url:`/decks/${id}`})).json().project,p);
    }
  } finally {await app.close();db.close();await rm(dir,{recursive:true,force:true});}
});

test('portable backups preserve old cards and annotations in versions while validating every snapshot before restoring',async()=>{
  const source=await createTestDatabase(),target=await createTestDatabase();
  try {
    const p=project(),deck=await new DeckService(source.db,new FakeCardProvider()).saveProject(p);
    const archive=await new LibraryBackupService(source.db).snapshot();
    await new LibraryBackupService(target.db).restore(archive);
    const reopened=await new DeckService(target.db,new FakeCardProvider()).getDeck(deck.id);
    assert.deepEqual(reopened.project,p);assert.equal(reopened.totalCards,37);assert.equal(reopened.cards.length,1);
    const bad=structuredClone(archive);bad.projects[0]!.state.versions![0]!.state.groups[1]!.entries[0]!.quantity=-1;
    await assert.rejects(new LibraryBackupService(target.db).restore(bad));
    assert.deepEqual((await new DeckService(target.db,new FakeCardProvider()).getDeck(deck.id)).project,p);
  } finally {source.close();target.close();}
});

test('legacy projects remain readable and the total snapshot size limit includes named versions',()=>{
  const p=project();delete p.versions;assert.equal(parseBuilderProject(p),p);
  p.versions=Array.from({length:20},(_,i)=>({id:`v-${i}`,name:`Version ${i}`,createdAt:'2026-10-07T15:00:00.000Z',state:{name:'Large',groups:p.groups,cuts:Array.from({length:15},(_,j)=>({...card,name:`Cut ${j}`,oracle_text:'x'.repeat(20_000)})),workspace:p.workspace}}));
  assert.throws(()=>parseBuilderProject(p),/volumineux/);
});
