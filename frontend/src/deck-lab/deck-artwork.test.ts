import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDeckArtwork } from './deck-artwork';
import { prepareProject } from './project-persistence';
import type { Sheet } from './deck-model';
import sample from './cards.json';
const url=(name:string)=>`https://cards.scryfall.io/normal/front/a/b/${name}.jpg`;
const setup=()=>{
  const s:Sheet={name:'Offline Aang',cuts:[{...sample[0]!,name:'Cut',image:url('cut')}],groups:[
    {name:'Commander',commander:true,entries:[{card:{...sample[0]!,name:'Aang // Korra',image:url('front'),faces:[{name:'Aang',image:url('front')},{name:'Korra',image:url('back')}]},quantity:1}]},
    {name:'Lands',entries:[{card:{...sample[0]!,name:'Forest',image:url('forest')+'?old',otherPrintings:[{...sample[0]!,image:url('unused-edition')}]},quantity:37},{card:{...sample[0]!,name:'Another Forest',image:url('forest')+'?new'},quantity:1}]},
    {name:'Ideas',maybeboard:true,entries:[{card:{...sample[0]!,name:'Candidate',image:url('candidate')},quantity:4}]}]};return prepareProject(s);
};
test('prepares only chosen deck images and both faces, with quantities and timestamp variants deduplicated',()=>{
  const p=setup(),before=structuredClone(p),request=collectDeckArtwork(p);
  assert.deepEqual(request.urls,[url('front'),url('back'),url('forest')]);assert.equal(request.id,p.projectId);assert.equal(request.unavailable,0);assert.deepEqual(p,before);
});
test('candidates and cuts are explicitly optional; unsupported/missing pictures are reported without network',()=>{
  const p=setup();assert.deepEqual(collectDeckArtwork(p,true).urls,[url('front'),url('back'),url('forest'),url('candidate'),url('cut')]);
  p.groups[1]!.entries[0]!.card.image='';p.groups[1]!.entries[1]!.card.image='https://other.test/forest.jpg';
  const request=collectDeckArtwork(p);assert.equal(request.unavailable,2);assert.deepEqual(request.urls,[url('front'),url('back')]);
});
test('shared and repeated cut images remain one download, while malformed host/protocol/credentials/ports never reach IPC',()=>{
  const p=setup();p.cuts=[p.groups[1]!.entries[0]!.card,p.groups[1]!.entries[0]!.card];assert.equal(collectDeckArtwork(p,true).urls.length,4);
  for(const image of ['http://cards.scryfall.io/a.jpg','https://cards.scryfall.io:123/a.jpg','https://user@cards.scryfall.io/a.jpg','javascript:alert(1)','https://cards.scryfall.io/a.svg']){
    p.groups[0]!.entries[0]!.card.image=image;delete p.groups[0]!.entries[0]!.card.faces;assert.equal(collectDeckArtwork(p).unavailable,1);
  }
});
