import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DeckService } from './decks/deck-service.js';
import { createDatabase } from './db/client.js';
import { buildApp } from './app.js';
import { createTestDatabase, FakeCardProvider } from './test-helpers.js';
import { parseBuilderProject, type BuilderProject } from '../../shared/builder-project.mjs';
const project = (): BuilderProject => ({version:1,projectId:'test-project',name:'Empty exploration',groups:[{id:'commander',name:'Commander',commander:true,entries:[]},{id:'empty-role',name:'Ramp',entries:[]}],cuts:[],workspace:{version:1,cards:[],zones:[{id:'zone',name:'To try',x:-40,y:600,width:250,height:314}],camera:{x:-30,y:100,zoom:.35}}});
const card = {name:'Forest',type_line:'Basic Land',cmc:0,mana_cost:null,oracle_text:null,power:null,toughness:null,loyalty:null,set:'',set_name:'',collector_number:'',rarity:'',lang:'en',color_identity:['G'],image:'',related:[]};

test('multiple manual tags persist through API, SQLite reopen and invalid writes without altering gameplay rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'asphodel-tags-')), url = `file:${join(dir, 'library.sqlite')}`;
  let db = await createDatabase(url), app = await buildApp({ database: db, cardProvider: new FakeCardProvider() });
  try {
    const p = project(); p.groups[1]!.entries = [{ id: 'forest', card, quantity: 37 }];
    p.cuts = [{ ...card, name: 'Cut idea' }];
    p.tags = { definitions: [{ id: 'ramp', name: 'Ramp', description: 'Ressources de mana', target: 0 }, { id: 'draw', name: 'Pioche', description: 'Renouvelle la main', target: 9 }], cards: [{ name: 'Forest', tagIds: ['ramp', 'draw'] }, { name: 'Cut idea', tagIds: ['draw'] }] };
    const saved = await app.inject({ method: 'POST', url: '/decks/projects', payload: p });
    assert.equal(saved.statusCode, 201); const id = saved.json().id;
    assert.equal(saved.json().totalCards, 37); assert.deepEqual(saved.json().project.tags, p.tags);
    await app.close(); db.close(); db = await createDatabase(url); app = await buildApp({ database: db, cardProvider: new FakeCardProvider() });
    const reopened = await app.inject({ method: 'GET', url: `/decks/${id}` });
    assert.deepEqual(reopened.json().project, p); assert.equal(reopened.json().cards.length, 1); assert.equal(reopened.json().cards[0].quantity, 37);
    for (const mutate of [
      (x: BuilderProject) => { x.tags!.cards[0]!.tagIds = ['missing']; },
      (x: BuilderProject) => { x.tags!.definitions[1]!.name = 'RAMP'; },
      (x: BuilderProject) => { x.tags!.definitions[0]!.target = 1.5; },
      (x: BuilderProject) => { x.tags!.cards[0]!.name = 'Absent'; },
    ]) {
      const bad = structuredClone(p); mutate(bad);
      assert.equal((await app.inject({ method: 'PUT', url: `/decks/${id}/project`, payload: bad })).statusCode, 400);
      assert.deepEqual((await app.inject({ method: 'GET', url: `/decks/${id}` })).json().project, p);
    }
  } finally { await app.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('empty project creation is idempotent and survives database close/migration/reopen',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'asphodel-project-'));const url=`file:${join(dir,'library.sqlite')}`;let db=await createDatabase(url);
  try {
    let service=new DeckService(db.db,new FakeCardProvider());const p=project();const deck=await service.saveProject(p);
    assert.equal(deck.totalCards,0);assert.equal((await service.saveProject(p)).id,deck.id);assert.equal((await service.listDecks()).length,1);
    db.close();db=await createDatabase(url);service=new DeckService(db.db,new FakeCardProvider());
    assert.deepEqual((await service.getDeck(deck.id)).project,p);
  } finally {db.close();await rm(dir,{recursive:true,force:true});}
});
test('complete snapshot round-trips quantities, commanders/candidates/cuts and stable positions with game totals unchanged',async()=>{
  const db=await createTestDatabase();try {
    const service=new DeckService(db.db,new FakeCardProvider());const p=project();
    p.groups[0]!.entries=[{id:'entry-command',card:{...card,name:'Aang'},quantity:1}];
    p.groups[1]!.entries=[{id:'entry-land',card,quantity:37}];
    p.groups.push({id:'candidates',name:'Candidates',maybeboard:true,entries:[{id:'entry-candidate',card:{...card,name:'Idea'},quantity:2}]});p.cuts=[{...card,name:'Cut idea'}];
    p.workspace.cards=[{id:'entry-land',name:'Forest',category:'Ramp',section:'mainboard',x:750,y:-80,z:3,zoneId:'zone'}];
    const deck=await service.saveProject(p);assert.equal(deck.totalCards,38);assert.deepEqual(deck.project,p);
    p.groups[1]!.name='Mana';p.workspace.cards[0]!.category='Mana';const saved=await service.saveProject(p,deck.id);
    assert.equal(saved.id,deck.id);assert.equal(saved.project!.workspace.cards[0]!.x,750);assert.equal(saved.project!.groups[1]!.entries[0]!.id,'entry-land');
    await service.deleteDeck(deck.id);assert.equal((await db.client.execute('select * from deck_projects')).rows.length,0);
  } finally {db.close();}
});
test('failed SQLite project write rolls back deck name/cards and prior workspace together',async()=>{
  const db=await createTestDatabase();try {
    const service=new DeckService(db.db,new FakeCardProvider());const p=project();p.groups[1]!.entries=[{id:'entry',card,quantity:37}];
    const before=await service.saveProject(p);await db.client.execute("CREATE TRIGGER reject_project BEFORE UPDATE ON deck_projects BEGIN SELECT RAISE(ABORT, 'test disk failure'); END;");
    p.name='Should not replace';p.groups[1]!.entries[0]!.quantity=12;p.workspace.camera.x=900;
    await assert.rejects(service.saveProject(p,before.id));assert.deepEqual(await service.getDeck(before.id),before);
  } finally {db.close();}
});
test('API rejects invalid snapshots; legacy imports migrate without changing id or cards',async()=>{
  const db=await createTestDatabase();const app=await buildApp({database:db,cardProvider:new FakeCardProvider()});try {
    const bad=project();bad.workspace.camera.zoom=-1;
    assert.equal((await app.inject({method:'POST',url:'/decks/projects',payload:bad})).statusCode,400);
    const service=new DeckService(db.db,new FakeCardProvider());const old=await service.createDeck('Legacy','Mainboard\n37x Forest');
    const p=project();p.projectId=`deck-${old.id}`;p.name=old.name;p.groups[1]!.entries=[{id:'entry',card,quantity:37}];
    const response=await app.inject({method:'PUT',url:`/decks/${old.id}/project`,payload:p});assert.equal(response.statusCode,200);assert.equal(response.json().id,old.id);assert.equal(response.json().totalCards,37);
    await service.updateDeckCards(old.id,[{name:'Mainboard',section:'mainboard',entries:[{name:'Forest',quantity:20}]}]);
    assert.equal((await service.getDeck(old.id)).project,null,'legacy card writes cannot leave a stale builder snapshot');
    assert.throws(()=>parseBuilderProject({...p,groups:[...p.groups,p.groups[0]]}));
  } finally {await app.close();db.close();}
});

test('pile order, manual frames and locks persist across SQLite reopen without changing gameplay quantities',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'asphodel-piles-')),url=`file:${join(dir,'library.sqlite')}`;let db=await createDatabase(url);
  try {
    let service=new DeckService(db.db,new FakeCardProvider());const p=project();
    p.groups[1]!.entries=[{id:'forest',card,quantity:37},{id:'draw',card:{...card,name:'Draw idea'},quantity:1}];
    p.workspace.zones[0]!.sizing='manual';p.workspace.zones[0]!.locked=true;
    p.workspace.cards=[{id:'forest',name:'Forest',category:'Ramp',section:'mainboard',x:750,y:500,z:3,zoneId:'zone'},{id:'draw',name:'Draw idea',category:'Ramp',section:'mainboard',x:792,y:500,z:4,zoneId:'zone'}];
    p.workspace.piles=[{id:'pile',name:'Mana and draw',x:750,y:448,expanded:true,cardIds:['forest','draw']}];
    const saved=await service.saveProject(p);assert.equal(saved.totalCards,38);assert.deepEqual(saved.project,p);
    db.close();db=await createDatabase(url);service=new DeckService(db.db,new FakeCardProvider());
    assert.deepEqual((await service.getDeck(saved.id)).project,p);
    p.workspace.piles[0]!.expanded=false;p.workspace.zones[0]!.width=900;
    await service.saveProject(p,saved.id);assert.deepEqual((await service.getDeck(saved.id)).project,p);
    const bad=structuredClone(p);bad.workspace.piles![0]!.cardIds=['not-in-project'];
    await assert.rejects(service.saveProject(bad,saved.id));assert.deepEqual((await service.getDeck(saved.id)).project,p);
  } finally {db.close();await rm(dir,{recursive:true,force:true});}
});

test('linked/free notes and chosen double-sided art survive SQLite reopen; invalid notes leave saved state intact',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'asphodel-notes-')),url=`file:${join(dir,'library.sqlite')}`;let db=await createDatabase(url);
  try {
    let service=new DeckService(db.db,new FakeCardProvider());const p=project();
    const chosen={...card,set:'tla',set_name:'Avatar',collector_number:'42',lang:'fr',image:'https://cards.scryfall.io/front.jpg',faces:[{name:'Front',image:'https://cards.scryfall.io/front.jpg'},{name:'Back',image:'https://cards.scryfall.io/back.jpg'}]};
    p.groups[1]!.entries=[{id:'forest',card:chosen,quantity:37}];p.workspace.cards=[{id:'forest',name:'Forest',category:'Ramp',section:'mainboard',x:700,y:-30,z:1}];
    p.workspace.notes=[{id:'free-note',text:'Find protection',color:'sand',x:-100,y:300},{id:'linked-note',text:'Try next\nKeep the selected art',color:'sage',x:190,y:0,cardId:'forest'}];
    const saved=await service.saveProject(p);assert.equal(saved.totalCards,37);
    db.close();db=await createDatabase(url);service=new DeckService(db.db,new FakeCardProvider());assert.deepEqual((await service.getDeck(saved.id)).project,p);
    for(const mutate of [(x:BuilderProject)=>{x.workspace.notes![1]!.cardId='missing';},(x:BuilderProject)=>{x.workspace.notes![0]!.text='x'.repeat(4001);}]){
      const bad=structuredClone(p);mutate(bad);await assert.rejects(service.saveProject(bad,saved.id));assert.deepEqual((await service.getDeck(saved.id)).project,p);
    }
  } finally {db.close();await rm(dir,{recursive:true,force:true});}
});
