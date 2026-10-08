import assert from 'node:assert/strict';
import test from 'node:test';
import {applyPlaytestFeedback} from './playtest-feedback';
import {ProjectHistory} from './project-history';
import {prepareProject} from './project-persistence';
import sampleCards from './cards.json';
import type {Sheet} from './deck-model';
import type {PlaytestReview} from '../../../shared/playtest-review.mjs';
const sheet=():Sheet=>({projectId:'project',name:'Deck now',groups:[{name:'Main',entries:[{id:'entry',card:structuredClone(sampleCards[0]!),quantity:3}]},{name:'Commander',commander:true,entries:[]}],cuts:[]});
const review=(s:Sheet):PlaytestReview=>({sessionId:'trial',startedAt:'2026-10-08T09:00:00.000Z',finishedAt:'2026-10-08T10:00:00.000Z',seed:42,playMode:'digital',status:'ended_by_human',
  humanDeck:{name:'Old deck',projectId:'project',sourceDeckId:1,versionName:'Base',cards:[{name:s.groups[0]!.entries[0]!.card.name,quantity:1,section:'mainboard'},{name:'Removed card',quantity:1,section:'mainboard'}]},
  opponents:[{name:'AI',cards:[]}],turns:3,outcome:null,reason:null,error:null,events:[],omittedEvents:0,revision:0,
  feedback:{note:'More draw',cards:[{name:s.groups[0]!.entries[0]!.card.name,verdict:'cut',note:'Too slow'},{name:'Removed card',verdict:'test',note:'Try again'}]}});

test('explicit feedback import links existing cards, retains absent-card notes and leaves deck membership intact; undo/redo works',()=>{
  const s=sheet();prepareProject(s);const groups=structuredClone(s.groups),r=review(s),history=new ProjectHistory(s);
  history.begin('Review');assert.equal(applyPlaytestFeedback(s,r),3);history.commit();assert.deepEqual(s.groups,groups);
  assert.equal(s.workspace!.notes!.find(n=>n.text.includes('Too slow'))!.cardId,'entry');assert.equal(s.workspace!.notes!.find(n=>n.text.includes('Try again'))!.cardId,undefined);
  history.undo();assert.equal(s.workspace!.notes,undefined);history.redo();assert.equal(s.workspace!.notes!.length,3);
  applyPlaytestFeedback(s,r);assert.equal(s.workspace!.notes!.length,3);
  r.feedback.cards=r.feedback.cards.slice(0,1);r.feedback.cards[0]!.verdict='keep';applyPlaytestFeedback(s,r);assert.equal(s.workspace!.notes!.length,2);assert.ok(s.workspace!.notes!.some(n=>n.text.startsWith('À garder')));
});
test('wrong project and full tables reject import; construction history rolls back failed changes',()=>{
  const s=sheet(),r=review(s);r.humanDeck.projectId='other';assert.throws(()=>applyPlaytestFeedback(s,r));prepareProject(s);r.humanDeck.projectId='project';
  s.workspace!.notes=Array.from({length:500},(_,i)=>({id:'n'+i,text:'Keep',color:'sand',x:0,y:0}));const history=new ProjectHistory(s),before=prepareProject(s);
  history.begin('Review');assert.throws(()=>applyPlaytestFeedback(s,r));history.cancel();assert.deepEqual(prepareProject(s),before);
});
