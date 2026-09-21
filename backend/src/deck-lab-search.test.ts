import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Fastify from 'fastify';
import { DeckLabSearch } from './cards/deck-lab-search.js';
import { registerDeckLabRoutes } from './cards/deck-lab-routes.js';
import { compileRawQuery } from './cards/deck-lab-query.js';
const card = (id: string, name: string, set: string, extra = {}) => ({
  id,oracle_id:name,name,set,set_name:set.toUpperCase(),collector_number:id,lang:'en',rarity:'rare',cmc:3,
  type_line:'Legendary Creature — Avatar',oracle_text:'Put a counter on target land.',colors:['G'],color_identity:['G'],
  image_uris:{normal:'https://cards.scryfall.io/test.jpg'},legalities:{commander:'legal'},...extra,
});
const fixture = [
  card('1','Aang','tla'),card('2','Aang','tle'),card('3','Katara','tla',{colors:['U'],color_identity:['U'],cmc:2}),
  card('4','Toph','tle',{cmc:4}),card('5','Other','neo'),
  card('6','Two faces','tle',{oracle_text:undefined,image_uris:undefined,card_faces:[{name:'Front',oracle_text:'Flying',image_uris:{normal:'https://cards.scryfall.io/front.jpg'}},{name:'Back',oracle_text:'Earthbend 4'}]}),
];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(),'deck-lab-'));
  const bulkPath = join(dir,'cards.gz'); const indexPath = join(dir,'search.sqlite');
  await writeFile(bulkPath,gzipSync(fixture.map(c=>JSON.stringify(c)).join('\n')));
  return {dir,bulkPath,indexPath,service:new DeckLabSearch({bulkPath,indexPath})};
}
test('set union, unique cards vs printings, pagination and two-face search', async () => {
  const f = await setup();
  try {
    const [catalog, first] = await Promise.all([f.service.getCatalog(), f.service.search({sets:['tla','tle'],limit:2})]);
    assert.equal(catalog.printings,6); assert.equal(first.total,4); assert.equal(first.nextOffset,2);
    const second = await f.service.search({sets:['tla','tle'],offset:2,limit:2});
    assert.equal(second.nextOffset,null); assert.equal(new Set([...first.cards,...second.cards].map(c=>c.name)).size,4);
    assert.equal((await f.service.search({sets:['tla','tle'],unique:'prints'})).total,5);
    assert.equal((await f.service.search({sets:['tle'],name:'Aang'})).cards[0]?.set,'tle');
    const faces = await f.service.search({oracle:'earthbend'});
    assert.equal(faces.cards[0]?.image,'https://cards.scryfall.io/front.jpg');
    assert.deepEqual(faces.cards[0]?.related,['Front','Back']);
    assert.equal((await f.service.search({query:"' OR 1=1 --"})).total,0);
  } finally { await f.service.close(); await rm(f.dir,{recursive:true,force:true}); }
});
test('structured filters, boolean raw syntax and explicit unsupported syntax errors', async () => {
  const f = await setup();
  try {
    const result = await f.service.search({raw:'(set:tla OR set:tle) t:creature id:g mv>=3 -name:"Two faces"'});
    assert.deepEqual(result.cards.map(c=>c.name),['Aang','Toph']);
    assert.equal((await f.service.search({types:['Legendary','Creature'],sets:['tla'],identity:'<=UG',manaValue:'<=2',rarity:'rare',language:'en'})).total,1);
    assert.equal((await f.service.search({colors:'=G',sets:['tla']})).total,1);
    assert.equal((await f.service.search({colors:'C'})).total,0);
    await assert.rejects(()=>f.service.search({manaValue:'nonsense'}),/Mana value/);
    for (const raw of ['set:tla OR','(set:tla','o:"unclosed','is:commander','foo:bar']) assert.throws(()=>compileRawQuery(raw));
  } finally { await f.service.close(); await rm(f.dir,{recursive:true,force:true}); }
});
test('derived index reopens and rebuilds after snapshot changes', async () => {
  const f = await setup();
  try {
    await f.service.search({}); await f.service.close();
    let service = new DeckLabSearch({bulkPath:f.bulkPath,indexPath:f.indexPath});
    assert.equal((await service.search({})).total,5); await service.close();
    await writeFile(f.bulkPath,gzipSync(JSON.stringify(card('7','New arrival','tla'))+'\n'));
    service = new DeckLabSearch({bulkPath:f.bulkPath,indexPath:f.indexPath});
    assert.equal((await service.search({})).total,1); await service.close();
  } finally { await f.service.close(); await rm(f.dir,{recursive:true,force:true}); }
});
test('routes bound request size/page size and serve the catalog', async () => {
  const f = await setup(); const app = Fastify(); registerDeckLabRoutes(app,f.service);
  try {
    assert.equal((await app.inject({method:'POST',url:'/cards/search',payload:{limit:121}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/cards/search',payload:{offset:-1}})).statusCode,400);
    const response = await app.inject({method:'POST',url:'/cards/search',payload:{sets:['tla','tle']}});
    assert.equal(response.statusCode,200); assert.equal(response.json().total,4);
    assert.equal((await app.inject('/cards/search/catalog')).json().sets.length,3);
  } finally { await app.close(); await rm(f.dir,{recursive:true,force:true}); }
});
test('missing snapshot produces an actionable service-unavailable error', async () => {
  const service = new DeckLabSearch({bulkPath:'/does-not-exist/deck-lab.gz',indexPath:':memory:'});
  await assert.rejects(()=>service.search({}),error=>error instanceof Error && 'statusCode' in error && error.statusCode === 503);
  await service.close();
});
