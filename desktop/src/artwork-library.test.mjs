import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { ArtCache, artKey } from './art-cache.mjs';
import { ArtworkLibrary, artworkRequest, installArtworkCommands, MIN_ART_LIMIT } from './artwork-library.mjs';
const url=n=>`https://cards.scryfall.io/normal/front/a/b/${n}.png`;
const request=(urls,id='deck-one')=>({id,name:id,urls,unavailable:0});
const fixture=async(fetch=async()=>new Response('PNG bytes',{headers:{'content-type':'image/png'}}))=>{
  const root=await mkdtemp(join(tmpdir(),'asphodel-offline-deck-')),directory=join(root,'art'),seed=join(root,'seed'),file=join(root,'artwork-library.json');
  const cache=new ArtCache(directory,seed,fetch),errors=[],manager=new ArtworkLibrary(cache,file,{intervalMs:0,onError:e=>errors.push(e)});await manager.ready;
  return {root,directory,seed,file,cache,manager,errors,cleanup:()=>rm(root,{recursive:true,force:true})};
};
const until=async check=>{const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw Error('Timed out waiting for download');await new Promise(r=>setImmediate(r));}};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('URLs are validated/deduplicated and estimates skip cached and bundled pictures without network',async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;return new Response('image',{headers:{'content-type':'image/png'}});});
  try {await f.cache.get(url('a'));await mkdir(f.seed);await writeFile(join(f.seed,artKey(url('b'))),'seed');
    const restarted=new ArtworkLibrary(new ArtCache(f.directory,f.seed,()=>{throw Error('offline');}),f.file,{intervalMs:0});await restarted.ready;
    const plan=await restarted.plan(request([url('a')+'?old',url('a')+'?new',url('b'),url('c')]));assert.equal(plan.total,3);assert.equal(plan.cached,2);assert.equal(plan.missing,1);assert.equal(calls,1);
    for(const bad of ['https://elsewhere.test/image.png','http://cards.scryfall.io/image.png','https://cards.scryfall.io:123/image.png'])assert.throws(()=>artworkRequest(request([bad])));
    assert.throws(()=>artworkRequest({...request([]),id:'../bad'}));
  } finally {await f.cleanup();}
});
test('two bounded downloads share the visible-image cache; both faces and metadata survive offline restart',async()=>{
  let calls=0,active=0,peak=0;const f=await fixture(async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,3));active--;return new Response('image',{headers:{'content-type':'image/png'}});});
  try {const urls=[url('front'),url('back'),url('third'),url('fourth')];await f.manager.prepare(request(urls));await f.cache.get(urls[0]);await f.manager.work;
    const state=await f.manager.state();assert.equal(state.job.status,'completed');assert.equal(state.job.cached,4);assert.equal(calls,4);assert.ok(peak<=2);
    const cache=new ArtCache(f.directory,f.seed,()=>{throw Error('offline');}),next=new ArtworkLibrary(cache,f.file,{intervalMs:0});await next.ready;
    assert.equal((await next.state()).decks[0].cached,4);for(const image of urls)assert.equal((await cache.get(image)).toString(),'image');
    await next.purge();assert.equal((await next.state()).decks[0].cached,4);
  } finally {await f.cleanup();}
});
test('pause/cancel stop new work, keep completed files, and restart resumes only missing pictures',async()=>{
  const first=deferred(),second=deferred(),lastGate=deferred();let calls=0,next;const f=await fixture(async()=>{const n=++calls;if(n===1)await first.promise;if(n===2)await second.promise;return new Response('image',{headers:{'content-type':'image/png'}});});
  try {await f.manager.prepare(request([url(1),url(2),url(3),url(4)]));await until(()=>calls===2);assert.equal(calls,2);await f.manager.control('pause');first.resolve();second.resolve();await f.manager.work;
    assert.equal(calls,2);assert.equal((await f.manager.state()).job.status,'paused');assert.equal((await f.manager.state()).job.cached,2);
    const cache=new ArtCache(f.directory,f.seed,async()=>{calls++;if(calls>=5)await lastGate.promise;return new Response('image',{headers:{'content-type':'image/png'}});});next=new ArtworkLibrary(cache,f.file,{intervalMs:0});await next.ready;
    await next.control('resume');await next.work;assert.equal(calls,4);assert.equal((await next.state()).job.status,'completed');
    await next.prepare(request([url(5),url(6),url(7)]));await next.control('cancel');lastGate.resolve();await next.work;assert.equal((await next.state()).job.status,'canceled');assert.ok((await next.state()).job.cached<=2);
  } finally {first.resolve();second.resolve();lastGate.resolve();await f.manager.work;await next?.work;await f.cleanup();}
});
test('failed images stay partial, explicit retry skips successes and new deck data updates retention',async()=>{
  let fail=true,calls=0;const f=await fixture(async image=>{calls++;if(image===url('bad')&&fail)return new Response('offline',{status:503});return new Response('image',{headers:{'content-type':'image/png'}});});
  try {await f.manager.prepare(request([url('ok'),url('bad')]));await f.manager.work;assert.equal((await f.manager.state()).job.status,'partial');assert.equal((await f.manager.state()).job.cached,1);
    fail=false;await f.manager.control('resume');await f.manager.work;assert.equal(calls,3);assert.equal((await f.manager.state()).job.status,'completed');
    await f.manager.prepare(request([url('new')]));await f.manager.work;await f.manager.purge();assert.equal((await f.manager.state()).cachedImages,1);assert.equal((await f.cache.get(url('new'))).toString(),'image');
  } finally {await f.cleanup();}
});
test('serialized quota accounting evicts oldest unprotected files, then pauses rather than deleting protected art',async()=>{
  const f=await fixture();
  try {f.manager.limitBytes=18;await f.cache.get(url('old'));await f.cache.get(url('recent'));await f.cache.get(url('new'));assert.equal(f.manager.entries.has(artKey(url('old'))),false);assert.ok((await f.manager.state()).usedBytes<=18);
    await f.manager.prepare(request([url('recent'),url('new'),url('overflow')]));await f.manager.work;
    const state=await f.manager.state();assert.equal(state.job.status,'paused');assert.match(state.job.error,/cache est plein/);assert.equal(state.job.cached,2);
    await f.manager.setKeep('deck-one',false);await f.manager.purge();assert.equal((await f.manager.state()).usedBytes,0);
  } finally {await f.cleanup();}
});
test('a failed job-state write leaves an incomplete preparation retryable without starting downloads',async()=>{
  let fail=true,calls=0;const f=await fixture(async()=>{calls++;return fail?new Response('offline',{status:503}):new Response('image',{headers:{'content-type':'image/png'}});});
  try {
    await f.manager.prepare(request([url('retry')]));await f.manager.work;
    const before=(await f.manager.state()).job,save=f.manager.save.bind(f.manager);
    f.manager.save=async()=>{throw Object.assign(new Error('Disk full'),{code:'ENOSPC'});};
    await assert.rejects(f.manager.control('resume'),/Disk full/);
    assert.deepEqual((await f.manager.state()).job,before);assert.equal(calls,1);
    f.manager.save=save;fail=false;await f.manager.control('resume');await f.manager.work;
    assert.equal((await f.manager.state()).job.status,'completed');assert.equal(calls,2);
  } finally {await f.cleanup();}
});
test('lowering the limit cannot delete protected decks; unprotecting permits cleanup and preserves the read-only seed',async()=>{
  const f=await fixture();
  try {await mkdir(f.directory,{recursive:true});const bytes=Buffer.alloc(2*1024*1024,1),urls=[];
    for(let i=0;i<26;i++){urls.push(url(i));await writeFile(join(f.directory,artKey(url(i))),bytes);}
    await mkdir(f.seed);await writeFile(join(f.seed,artKey(url('seed'))),'seed');
    const next=new ArtworkLibrary(new ArtCache(f.directory,f.seed),f.file,{intervalMs:0});await next.ready;await next.prepare(request(urls));await next.work;
    await assert.rejects(next.setLimit(MIN_ART_LIMIT),/protégées/);assert.equal((await next.state()).decks[0].cached,26);
    await next.setKeep('deck-one',false);await next.setLimit(MIN_ART_LIMIT);assert.ok((await next.state()).usedBytes<=MIN_ART_LIMIT);await next.purge();assert.equal((await next.state()).usedBytes,0);assert.equal(await readFile(join(f.seed,artKey(url('seed'))),'utf8'),'seed');
    for(const limit of [0,MIN_ART_LIMIT-1,NaN,Infinity,12*1024**3])await assert.rejects(next.setLimit(limit));
  } finally {await f.cleanup();}
});
test('closing persists a resumable pause without waiting for slow network; complete files survive close/reopen',async()=>{
  const gate=deferred();const f=await fixture(async()=>{await gate.promise;return new Response('image',{headers:{'content-type':'image/png'}});});
  try {await f.manager.prepare(request([url(1),url(2),url(3)]));await f.manager.close();assert.equal(JSON.parse(await readFile(f.file,'utf8')).job.status,'paused');gate.resolve();await f.manager.work;
    assert.equal((await f.manager.state()).job.cached,2);assert.equal((await f.manager.state()).job.status,'paused');await assert.rejects(f.manager.control('resume'),/fermeture/);
  } finally {gate.resolve();await f.cleanup();}
});
test('corrupt metadata preserves all files and blocks purge; explicit reset keeps a rescue copy',async()=>{
  const f=await fixture();
  try {await f.cache.get(url('a'));await writeFile(f.file,'broken metadata');const next=new ArtworkLibrary(new ArtCache(f.directory),f.file,{onError:()=>{}});await next.ready;
    assert.ok((await next.state()).recoveryError);await assert.rejects(next.purge());assert.equal((await next.state()).usedBytes,9);
    await next.resetSettings();assert.equal((await next.state()).recoveryError,null);assert.equal((await next.state()).cachedImages,1);assert.ok((await readdir(f.root)).some(name=>name.includes('.damaged-')));
  } finally {await f.cleanup();}
});
test('artwork IPC accepts only the primary trusted frame and cleans handlers after native destruction',async()=>{
  const f=await fixture();
  try {const handles=new Map(),ipcMain={handle:(name,fn)=>handles.set(name,fn),removeHandler:name=>handles.delete(name)},window=new EventEmitter();
    const contents={mainFrame:{url:'asphodel://app/'},isDestroyed:()=>false};window.webContents=contents;installArtworkCommands({ipcMain,window,library:f.manager});
    const trusted={sender:contents,senderFrame:contents.mainFrame};assert.equal((await handles.get('asphodel:art-state')(trusted)).usedBytes,0);
    assert.throws(()=>handles.get('asphodel:art-state')({...trusted,senderFrame:{url:'asphodel://app/'}}),/refused/);
    Object.defineProperty(window,'webContents',{get(){throw Error('Object has been destroyed');}});window.emit('closed');assert.equal(handles.size,0);
  } finally {await f.cleanup();}
});
test('oversized/empty/non-image responses never enter the cache and interrupted temp files are ignored/cleaned',async()=>{
  const f=await fixture(async()=>new Response(new Uint8Array(5_000_001),{headers:{'content-type':'image/png'}}));
  try {await assert.rejects(f.cache.get(url('huge')),/exceeds/);assert.equal((await f.manager.state()).usedBytes,0);
    await mkdir(f.directory,{recursive:true});await writeFile(join(f.directory,artKey(url('a'))+'.tmp'),'interrupted');
    const next=new ArtworkLibrary(new ArtCache(f.directory),f.file);await next.ready;assert.ok(!(await readdir(f.directory)).some(name=>name.endsWith('.tmp')));
    for(const response of [new Response('',{headers:{'content-type':'image/png'}}),new Response('html',{headers:{'content-type':'text/html'}})]){const cache=new ArtCache(f.directory,null,async()=>response);await assert.rejects(cache.get(url('invalid')));}
  } finally {await f.cleanup();}
});
test('extension-size preparations accept more than 4000 distinct images while keeping a bounded maximum',async()=>{
 const f=await fixture();try{
  const images=Array.from({length:4001},(_,i)=>url('set-'+i));const plan=await f.manager.plan(request(images,'extension-tla'));assert.equal(plan.total,4001);assert.equal(plan.missing,4001);
  assert.throws(()=>artworkRequest(request(Array.from({length:40001},()=>url('same')))),/invalide/);
 }finally{await f.cleanup();}
});
