import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { prepareCatalog, validateCatalogBulk } from './cards/catalog-validation.js';
import { DeckLabSearch } from './cards/deck-lab-search.js';
import { ScryfallCardProvider } from './cards/scryfall-provider.js';
const card=(id:string,name:string,set='tla',extra={})=>({id,oracle_id:name,name,set,set_name:'Avatar',collector_number:id,lang:'en',rarity:'rare',cmc:3,type_line:'Creature',color_identity:['G'],colors:['G'],image_uris:{normal:`https://cards.scryfall.io/front/${id}.png`},...extra});
const dump=(cards:object[])=>gzipSync(cards.map(c=>JSON.stringify(c)).join('\n')+'\n');
async function setup(){const directory=await mkdtemp(join(tmpdir(),'asphodel-index-candidate-'));return {directory,oracle:join(directory,'scryfall-oracle-cards.jsonl.gz'),printing:join(directory,'scryfall-default-cards.jsonl.gz'),cleanup:()=>rm(directory,{recursive:true,force:true})};}
test('real bulk verification prepares a reopenable index while old search remains usable, even if a later candidate fails',async()=>{
 const f=await setup();let old:DeckLabSearch|undefined,next:DeckLabSearch|undefined;try{
  const bulk=join(f.directory,'installed.gz');await writeFile(bulk,dump([card('old','Old card')]));old=new DeckLabSearch({bulkPath:bulk,indexPath:join(f.directory,'installed.sqlite')});assert.equal((await old.search({})).cards[0]?.name,'Old card');
  await writeFile(f.oracle,dump([card('new','Nouvelle arrivée')]));await writeFile(f.printing,dump([card('new','Nouvelle arrivée'),card('second','Second printing','neo')]));const phases:string[]=[];assert.equal((await prepareCatalog(f.directory,phase=>phases.push(phase))).printings,2);assert.ok(phases.includes('verifying-printings'));assert.equal((await old.search({})).total,1);
  next=new DeckLabSearch({bulkPath:f.printing,indexPath:join(f.directory,'deck-lab-search.sqlite')});assert.equal((await next.search({name:'Nouvelle'})).total,1);
  await writeFile(f.printing,gzipSync('not JSON'));await assert.rejects(prepareCatalog(f.directory));assert.equal((await old.search({})).cards[0]?.name,'Old card');assert.equal((await next.search({})).total,2);
 }finally{await old?.close();await next?.close();await f.cleanup();}
});
test('truncated gzip, empty bulk, malformed cards and oversized lines fail before indexing',async()=>{
 const f=await setup();try{
  const good=dump([card('a','Aang')]);for(const bytes of [good.subarray(0,good.length-5),gzipSync(''),gzipSync('{bad json}\n'),dump([{id:'a',name:'Aang'}]),dump([card('bad','Aang','tla',{type_line:123})]),dump([card('bad','Aang','tla',{image_uris:{normal:42}})]),gzipSync('x'.repeat(2_000_001))]){await writeFile(f.printing,bytes);await assert.rejects(validateCatalogBulk(f.printing,true),error=>error instanceof Error&&'code' in error&&error.code==='CATALOG_INVALID');}
  await writeFile(f.printing,good);assert.equal(await validateCatalogBulk(f.printing,true),1);
 }finally{await f.cleanup();}
});
test('extension preparation includes every printing and both faces, ignores other sets and deduplicates shared art offline',async()=>{
 const f=await setup();let search:DeckLabSearch|undefined;try{
  const front='https://cards.scryfall.io/front/a.png',back='https://cards.scryfall.io/back/a.png';await writeFile(f.printing,dump([card('one','Aang','tla',{image_uris:undefined,card_faces:[{name:'Aang',image_uris:{normal:front}},{name:'Korra',image_uris:{normal:back}}]}),card('two','Aang','tla'),card('same-art','Forest','tla',{image_uris:{normal:front+'?stamp'}}),card('missing','No image','tla',{image_uris:undefined}),card('bad','Invalid image','tla',{image_uris:{normal:'http://other.test/a.png'}}),card('outside','Other extension','neo')]));
  search=new DeckLabSearch({bulkPath:f.printing,indexPath:':memory:'});const request=await search.artworkForSet('tla');assert.equal(request.id,'extension-tla');assert.equal(request.unavailable,2);assert.deepEqual(new Set(request.urls),new Set([front,back,'https://cards.scryfall.io/front/two.png']));assert.equal(request.urls.some(url=>url.includes('outside')),false);await assert.rejects(search.artworkForSet('../bad'));await assert.rejects(search.artworkForSet('unknown'));
 }finally{await search?.close();await f.cleanup();}
});
test('desktop providers report a missing catalog without starting an implicit bulk download',async()=>{
 const f=await setup();try{
  let downloads=0;const provider=new ScryfallCardProvider({bulkPath:f.oracle,printingBulkPath:f.printing,allowDownload:false,fetch:async()=>{downloads++;throw Error('not authorized');}});await assert.rejects(provider.findByExactName('Unknown'),/Installe le catalogue/);await assert.rejects(provider.findBySetAndCollector('tla','1'),/Installe le catalogue/);assert.equal(downloads,0);
  await writeFile(f.oracle,dump([card('one','Aang')]));assert.equal((await new ScryfallCardProvider({bulkPath:f.oracle,allowDownload:false}).findByExactName('Aang'))?.name,'Aang');
 }finally{await f.cleanup();}
});
