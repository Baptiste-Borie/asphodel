import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { CatalogLibrary, bulkMetadata, atomicCatalogWrite, installCatalogCommands } from './catalog-library.mjs';
import { selectCatalog, generationPaths } from './catalog-paths.mjs';
const until = async check => { const end = Date.now() + 3000; while (!await check()) { if (Date.now() > end) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 2)); } };
const payload = gzipSync(JSON.stringify({id:'card',name:'Aang',set:'tla'})+'\n');
const metadata = type => ({ type, jsonl_download_uri:`https://data.scryfall.io/${type}.jsonl.gz`, compressed_size:payload.length, updated_at:'2026-10-06T10:00:00Z' });
async function fixture(options={}) {
  const data = await mkdtemp(join(tmpdir(), 'asphodel-catalog-'));
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({url,init});
    if(url.includes('/bulk-data/')) return Response.json(metadata(url.split('/').at(-1)));
    return new Response(payload, {headers:{etag:'"same-snapshot"','content-length':String(payload.length)}});
  };
  const prepare = async (directory, progress) => {
    for(const name of ['scryfall-oracle-cards.jsonl.gz','scryfall-default-cards.jsonl.gz']) gunzipSync(await readFile(join(directory,name)));
    progress('indexing',1);await writeFile(join(directory,'deck-lab-search.sqlite'),'verified index');return {printings:1,sets:[]};
  };
  const errors=[];const library=new CatalogLibrary({data,fetch,prepare,onError:error=>errors.push(error),...options});await library.ready;
  return {data,calls,library,errors,cleanup:async()=>{await library.close();await rm(data,{recursive:true,force:true});}};
}
test('catalog installation is explicit, checks metadata, prepares an isolated index, and activates only on the next launch',async()=>{
 const f=await fixture();try{
  assert.equal(f.calls.length,0);assert.equal((await f.library.state()).installed,false);await f.library.check();assert.equal(f.calls.length,2);
  await f.library.start();await f.library.work;const state=await f.library.state();assert.equal(state.needsRestart,true);assert.equal(state.installed,false);assert.equal(state.job.status,'completed');
  const selection=await selectCatalog(f.data);assert.equal(selection.generation,state.job.generation);assert.equal(selection.info.printings,1);
  const next=new CatalogLibrary({data:f.data,fetch:()=>{throw Error('offline');},prepare:()=>{throw Error('not needed');}});await next.ready;
  assert.equal((await next.state()).installed,true);assert.equal((await next.state()).needsRestart,false);assert.equal((await next.state()).updatedAt,metadata('default_cards').updated_at);await next.close();
 }finally{await f.cleanup();}
});
test('metadata rejects unrelated/unsafe URLs, oversized files and old unsupported formats',()=>{
 for(const value of [ {...metadata('default_cards'),jsonl_download_uri:'http://data.scryfall.io/a.gz'}, {...metadata('default_cards'),jsonl_download_uri:'https://evil.test/a.gz'}, {...metadata('default_cards'),jsonl_download_uri:'https://user@data.scryfall.io/a.gz'}, {...metadata('default_cards'),compressed_size:3*1024**3}, {...metadata('default_cards'),compressed_size:0}, {...metadata('default_cards'),updated_at:'bad'}, {...metadata('default_cards'),jsonl_download_uri:undefined,download_uri:'https://data.scryfall.io/a.json'} ]) assert.throws(()=>bulkMetadata(value,'default_cards'));
});
test('pause keeps partial compressed bytes and ETag; restart resumes with a checked Range without duplicating bytes',async()=>{
 let cut=true,canceled=false,release;const gate=new Promise(r=>release=r);let ranged=false;
 const f=await fixture({fetch:async(url,init)=>{
  if(url.includes('/bulk-data/'))return Response.json(metadata(url.split('/').at(-1)));
  if(cut){cut=false;let pulls=0;return new Response(new ReadableStream({async pull(controller){if(!pulls++){controller.enqueue(payload.subarray(0,8));return;}await gate;if(!canceled){controller.enqueue(payload.subarray(8));controller.close();}},cancel(){canceled=true;}}),{headers:{etag:'"same-snapshot"'}});}
  const offset=Number(init.headers.Range?.match(/\d+/)?.[0]??0);if(offset){ranged=true;assert.equal(offset,8);assert.equal(init.headers['If-Range'],'"same-snapshot"');return new Response(payload.subarray(offset),{status:206,headers:{etag:'"same-snapshot"','content-range':`bytes ${offset}-${payload.length-1}/${payload.length}`}});}
  return new Response(payload,{headers:{etag:'"same-snapshot"'}});
 }});let next;try{
  await f.library.check();await f.library.start();await until(async()=>((await f.library.state()).job.receivedBytes===8));await f.library.control('pause');assert.equal((await f.library.state()).job.status,'paused');release();
  next=new CatalogLibrary({data:f.data,fetch:f.library.fetcher,prepare:f.library.prepare});await next.ready;await next.control('resume');await next.work;
  assert.equal(ranged,true);assert.equal((await next.state()).job.status,'completed');const paths=generationPaths(f.data,next.job.generation);assert.deepEqual(await readFile(paths.oracle),payload);
 }finally{release();await next?.close();await f.cleanup();}
});
test('a server ignoring Range safely restarts that file rather than appending another complete gzip',async()=>{
 const f=await fixture();try{
  await f.library.check();await f.library.start();await f.library.work;const paths=generationPaths(f.data,f.library.job.generation);await rm(paths.oracle);await writeFile(paths.oracle+'.part',payload.subarray(0,8));
  f.library.job.assets[0].etag='"old"';await f.library.download(f.library.job.assets[0],paths.oracle,new AbortController().signal);assert.deepEqual(await readFile(paths.oracle),payload);
 }finally{await f.cleanup();}
});
test('failed metadata, HTTP errors, invalid gzip and failed activation preserve the previous catalog and report a retryable error',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.data,'scryfall-default-cards.jsonl.gz'),'old searchable snapshot');await writeFile(join(f.data,'scryfall-oracle-cards.jsonl.gz'),'old oracle');
  f.library.fetcher=async()=>new Response('offline',{status:503});await assert.rejects(f.library.check(),/503/);assert.match((await f.library.state()).error,/503/);assert.ok((await f.library.state()).lastCheck);
  f.library.latest=['oracle_cards','default_cards'].map(type=>bulkMetadata(metadata(type),type));await f.library.start();await f.library.work;assert.equal((await f.library.state()).job.status,'paused');assert.equal((await selectCatalog(f.data)).generation,null);
  f.library.fetcher=async()=>new Response(payload,{headers:{etag:'"valid"'}});f.library.prepare=async()=>{throw Object.assign(new Error('Corrupt gzip'),{code:'CATALOG_INVALID'});};await f.library.control('resume');await f.library.work;assert.equal((await f.library.state()).job.receivedBytes,0);
  f.library.prepare=async directory=>{await writeFile(join(directory,'deck-lab-search.sqlite'),'index');return {printings:1};};const path=f.library.manifestFile;f.library.manifestFile=join(f.data,'cannot-replace-directory');await mkdir(f.library.manifestFile);
  await f.library.control('resume');await f.library.work;assert.equal((await f.library.state()).job.status,'paused');f.library.manifestFile=path;
  assert.equal(await readFile(join(f.data,'scryfall-default-cards.jsonl.gz'),'utf8'),'old searchable snapshot');assert.equal((await selectCatalog(f.data)).generation,null);
 }finally{await f.cleanup();}
});
test('cancel and close interrupt the verification worker, keep the installed snapshot, and never remove a selected generation',async()=>{
 let aborted=false;const f=await fixture({prepare:(_directory,_progress,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true}))});
 try{await f.library.check();await f.library.start();await until(()=>f.library.job.status==='verifying');const paths=generationPaths(f.data,f.library.job.generation);await f.library.control('cancel');assert.equal(aborted,true);await assert.rejects(stat(paths.directory));assert.equal((await f.library.state()).job.status,'canceled');assert.equal((await selectCatalog(f.data)).generation,null);
  aborted=false;await f.library.start();await until(()=>f.library.job.status==='verifying');await f.library.close();assert.equal(aborted,true);assert.equal((await f.library.state()).job.status,'paused');assert.ok((await stat(generationPaths(f.data,f.library.job.generation).oracle)).size);
 }finally{await f.cleanup();}
});
test('atomic finalization refuses cancel and restart recovery recognizes a committed manifest before job acknowledgement',async()=>{
 const f=await fixture();try{
  await f.library.check();await f.library.start();await f.library.work;f.library.job.status='activating';await f.library.save();await assert.rejects(f.library.control('cancel'),/Attends/);
  const next=new CatalogLibrary({data:f.data,prepare:f.library.prepare});await next.ready;assert.equal((await next.state()).job.status,'completed');assert.equal((await next.state()).installed,true);await next.close();
 }finally{await f.cleanup();}
});
test('bad current manifest falls back to the previous complete generation; cleanup protects active/current/previous and pending data',async()=>{
 const f=await fixture();try{
  await f.library.check();await f.library.start();await f.library.work;const first=f.library.installed.generation;f.library.active=f.library.installed;
  await f.library.start();await f.library.work;const second=f.library.installed.generation;f.library.active=f.library.installed;
  await f.library.start();await f.library.work;const third=f.library.installed.generation;f.library.active=f.library.installed;
  assert.ok((await f.library.state()).reclaimableBytes>0);await f.library.cleanup();await assert.rejects(stat(generationPaths(f.data,first).directory));assert.ok((await stat(generationPaths(f.data,second).index)).size);assert.ok((await stat(generationPaths(f.data,third).index)).size);
  await writeFile(join(f.data,'catalog-current.json'),'broken pointer');const selection=await selectCatalog(f.data);assert.equal(selection.generation,second);assert.ok(selection.recoveryError);
 }finally{await f.cleanup();}
});
test('catalog IPC isolates the main frame and removes handlers without reading the destroyed BrowserWindow',async()=>{
 const f=await fixture();try{
  const handlers=new Map(),ipcMain={handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window=new EventEmitter(),contents={mainFrame:{url:'asphodel://app/'},isDestroyed:()=>false};window.webContents=contents;let restarted=false;
  installCatalogCommands({ipcMain,window,library:f.library,restart:()=>{restarted=true;}});const event={sender:contents,senderFrame:contents.mainFrame};assert.equal((await handlers.get('asphodel:catalog-state')(event)).installed,false);assert.throws(()=>handlers.get('asphodel:catalog-install')({...event,senderFrame:{url:'https://evil.test/'}}),/refused/);
  await handlers.get('asphodel:catalog-restart')(event);assert.equal(restarted,true);Object.defineProperty(window,'webContents',{get(){throw Error('Object destroyed');}});window.emit('closed');assert.equal(handlers.size,0);
 }finally{await f.cleanup();}
});
test('an incoherent resumed range is rejected without changing the partial file or the installed pointer',async()=>{
 const f=await fixture();try{
  await f.library.check();const id='12345678-1234-1234-1234-123456789abc',paths=generationPaths(f.data,id);await mkdir(paths.directory,{recursive:true});await writeFile(paths.oracle+'.part',payload.subarray(0,8));
  const asset={...bulkMetadata(metadata('oracle_cards'),'oracle_cards'),etag:'"same-snapshot"'};
  f.library.fetcher=async()=>new Response(payload.subarray(8),{status:206,headers:{etag:'"changed"','content-range':`bytes 9-${payload.length-1}/${payload.length}`}});
  await assert.rejects(f.library.download(asset,paths.oracle,new AbortController().signal),/incohérente/);assert.deepEqual(await readFile(paths.oracle+'.part'),payload.subarray(0,8));assert.equal((await selectCatalog(f.data)).generation,null);
 }finally{await f.cleanup();}
});
test('a full disk during indexing leaves downloaded files resumable and never activates the candidate',async()=>{
 const f=await fixture({prepare:async()=>{throw Object.assign(new Error('disk full'),{code:'ENOSPC'});}});try{
  await f.library.check();await f.library.start();await f.library.work;const state=await f.library.state();assert.equal(state.job.status,'paused');assert.match(state.job.error,/disque est plein/);assert.equal(state.job.receivedBytes,state.job.totalBytes);assert.equal(state.needsRestart,false);assert.equal((await selectCatalog(f.data)).generation,null);
 }finally{await f.cleanup();}
});
