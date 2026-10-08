import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDatabase} from './db/client.js';
import {createTestDatabase,FakeCardProvider} from './test-helpers.js';
import {PlaytestReviewService} from './human/playtest-review-service.js';
import {LibraryBackupService} from './decks/library-backup-service.js';
import {DeckService} from './decks/deck-service.js';
import {buildApp} from './app.js';
import {parsePlaytestReview,type PlaytestReview} from '../../shared/playtest-review.mjs';
import {resolvePlayedDeck} from './decks/deck-resolver.js';
import {project} from './testing/review-fixture.js';
const review=():PlaytestReview=>({sessionId:'record-one',startedAt:'2026-10-08T09:00:00.000Z',finishedAt:'2026-10-08T09:01:00.000Z',seed:42,playMode:'digital',status:'completed',
  humanDeck:{name:'Before edits',projectId:'deck-project',sourceDeckId:1,cards:[{name:'Krenko',quantity:1,section:'commander'},{name:'Mountain',quantity:99,section:'mainboard'}]},
  opponents:[{name:'Opponent',cards:[{name:'Forest',quantity:100,section:'mainboard'}]}],turns:7,outcome:'human',reason:'AllOpponentsLost',error:null,
  events:[{id:1,turn:2,phase:'main1',text:'A public spell was cast.'}],omittedEvents:0,feedback:{note:'',cards:[]},revision:0});

test('review routes reject foreign cards and stale revisions without changing the frozen list',async()=>{
  const database=await createTestDatabase(),service=new PlaytestReviewService(database.db);await service.create(review());
  const app=await buildApp({database,cardProvider:new FakeCardProvider()});
  try {
    const feedback={note:'More draw <script>',cards:[{name:' MOUNTAIN ',verdict:'cut',note:'Too much mana'}]};
    const saved=await app.inject({method:'PUT',url:'/playtests/reviews/record-one/feedback',payload:{revision:0,feedback}});
    assert.equal(saved.statusCode,200);assert.equal(saved.json().revision,1);assert.equal(saved.json().feedback.cards[0].name,'Mountain');assert.deepEqual(saved.json().humanDeck,review().humanDeck);
    assert.equal((await app.inject({method:'PUT',url:'/playtests/reviews/record-one/feedback',payload:{revision:0,feedback:{note:'Old tab',cards:[]}}})).statusCode,409);
    for(const invalid of [{note:'',cards:[{name:'Not in deck',verdict:'cut',note:''}]},{note:'',cards:[{name:'Mountain',verdict:'cut',note:''},{name:'MOUNTAIN',verdict:'test',note:''}]},{note:'x'.repeat(10001),cards:[]}])
      assert.equal((await app.inject({method:'PUT',url:'/playtests/reviews/record-one/feedback',payload:{revision:1,feedback:invalid}})).statusCode,400);
    assert.equal((await service.get('record-one')).feedback.note,feedback.note);
    const list=await app.inject({method:'GET',url:'/playtests/reviews?projectId=deck-project'});assert.equal(list.json().reviews.length,1);assert.equal(list.json().reviews[0].annotatedCards,1);assert.ok(!JSON.stringify(list.json()).includes('"cards"'));
    assert.equal((await app.inject({method:'GET',url:'/playtests/reviews/missing'})).statusCode,404);
    assert.equal((await app.inject({method:'GET',url:'/playtests/reviews?offset=-1'})).statusCode,400);
  } finally {await app.close();database.close();}
});

test('history survives deck deletion, backup/restore and database restart; invalid archive leaves it intact',async()=>{
  const source=await createTestDatabase(),dir=await mkdtemp(join(tmpdir(),'asphodel-reviews-'));let target=await createDatabase(`file:${join(dir,'data.sqlite')}`);
  try {
    const decks=new DeckService(source.db,new FakeCardProvider()),deck=await decks.createDeck('Before edits','Commander\n1 Krenko\n\nMainboard\n99 Mountain');
    const r=review();r.humanDeck.sourceDeckId=deck.id;const service=new PlaytestReviewService(source.db);await service.create(r);
    await decks.deleteDeck(deck.id);assert.deepEqual(await service.get(r.sessionId),r);
    const archive=await new LibraryBackupService(source.db).snapshot();await new LibraryBackupService(target.db).restore(archive);
    target.close();target=await createDatabase(`file:${join(dir,'data.sqlite')}`);assert.deepEqual(await new PlaytestReviewService(target.db).get(r.sessionId),r);
    const invalid=structuredClone(archive);invalid.reviews![0]!.feedback.cards=[{name:'Not played',verdict:'test',note:''}];
    await assert.rejects(new LibraryBackupService(target.db).restore(invalid));assert.deepEqual(await new PlaytestReviewService(target.db).get(r.sessionId),r);
    const old={...archive};delete old.reviews;await new LibraryBackupService(target.db).restore(old);assert.equal((await new PlaytestReviewService(target.db).list()).reviews.length,0);
  } finally {source.close();target.close();await rm(dir,{recursive:true,force:true});}
});

test('running trials recover as interrupted after restoration or application restart',async()=>{
  const db=await createTestDatabase();try {
    const service=new PlaytestReviewService(db.db),r=review();r.status='running';r.finishedAt=null;r.outcome=null;await service.create(r);
    await assert.rejects(service.feedback(r.sessionId,0,{note:'premature',cards:[]}));
    const archive=await new LibraryBackupService(db.db).snapshot();await new LibraryBackupService(db.db).restore(archive);assert.equal((await service.get(r.sessionId)).status,'interrupted');
    r.sessionId='other-run';await service.create(r);await service.interruptRunning();assert.equal((await service.get(r.sessionId)).status,'interrupted');
  } finally {db.close();}
});

test('same-read resolution plays a saved reference without restoring the working deck or including candidates/cuts',async()=>{
  const database=await createTestDatabase();try {
    const service=new DeckService(database.db,new FakeCardProvider()),p=project(),saved=await service.saveProject(p);
    const resolved=await resolvePlayedDeck({type:'library',value:String(saved.id),projectId:p.projectId,versionId:'base'},{name:'Unused',cards:[]},service);
    assert.equal(resolved.played.versionName,'Base');assert.equal(resolved.deck.cards.find(c=>c.name==='Mountain')!.quantity,99);
    assert.equal(resolved.deck.cards.some(c=>c.name==='Candidate'||c.name==='Cut'),false);
    assert.equal((await service.getDeck(saved.id)).cards.find(c=>c.name==='Mountain')!.quantity,98);
    await assert.rejects(resolvePlayedDeck({type:'library',value:String(saved.id),projectId:'wrong'},{name:'Unused',cards:[]},service));
    await assert.rejects(resolvePlayedDeck({type:'library',value:String(saved.id),versionId:'missing'},{name:'Unused',cards:[]},service));
    assert.ok(!JSON.stringify(parsePlaytestReview({...review(),rawObservation:{hand:['private']},result:{players:[{hand:['private']}]}})).includes('private'));
  } finally {database.close();}
});

test('history pagination includes older trials exactly once',async()=>{
  const database=await createTestDatabase();try {
    const service=new PlaytestReviewService(database.db);for(let i=0;i<52;i++){const r=review();r.sessionId='trial-'+String(i).padStart(3,'0');await service.create(r);}
    const first=await service.list('deck-project');assert.equal(first.reviews.length,50);assert.equal(first.nextOffset,50);
    const next=await service.list('deck-project',first.nextOffset!);assert.equal(next.reviews.length,2);assert.equal(next.nextOffset,null);
    assert.equal(new Set([...first.reviews,...next.reviews].map(r=>r.sessionId)).size,52);
  } finally {database.close();}
});
