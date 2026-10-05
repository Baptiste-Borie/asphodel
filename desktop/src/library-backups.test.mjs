import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryBackups, atomicWrite, readBackup } from './library-backups.mjs';

// Real archive validation is exercised by backend/library-backup.test.ts. Here the
// codec seam keeps the native file/lifecycle tests independent of TypeScript tooling.
const codec={MAX_BACKUP_BYTES:1024*1024,parseBackupStorage:x=>x,parseLibraryBackup:x=>{
  if(x.format!=='asphodel-library'||x.version!==1)throw new Error('Invalid archive');return x;
}};
const library=name=>({decks:[{id:1,name}],cards:[],entries:[],projects:[]});
async function fixture(options={}) {
  const dir=await mkdtemp(join(tmpdir(),'asphodel-native-backup-'));let current=library('Before');let mode={fullscreen:false};
  const input=join(dir,'input.json'),output=join(dir,'saved.json');
  const archive={format:'asphodel-library',version:1,appVersion:'0.1.3',createdAt:new Date().toISOString(),library:library('After'),storage:{'asphodel.deck-lab.selection.v1':'archived selection'},display:{fullscreen:true}};
  await atomicWrite(input,archive);
  const config={userData:dir,version:'0.1.3',codec,api:{snapshot:async()=>structuredClone(current),restore:async x=>{current=structuredClone(x);}},
    getDisplay:()=>mode,setDisplay:x=>{mode=x;},dialogs:{save:async()=>output,open:async()=>input,confirm:async()=>true},...options};
  return {dir,input,output,archive,config,controller:new LibraryBackups(config),get current(){return current;},get mode(){return mode;},cleanup:()=>rm(dir,{recursive:true,force:true})};
}
test('save and native-dialog cancellation never truncate an existing backup',async()=>{
  const f=await fixture();try {
    await f.controller.save({'asphodel.deck-lab.selection.v1':'current pool'});
    const saved=await readBackup(f.output,codec);assert.equal(saved.library.decks[0].name,'Before');assert.equal(saved.storage['asphodel.deck-lab.selection.v1'],'current pool');
    f.config.dialogs.save=async()=>null;
    const before=await readFile(f.output);assert.deepEqual(await f.controller.save({}),{canceled:true});assert.deepEqual(await readFile(f.output),before);
    assert.deepEqual((await readdir(f.dir)).filter(n=>n.endsWith('.tmp')),[]);
    await atomicWrite(join(f.dir,'Deck $literal.txt'),'Commander\n1 Aang\n',true);assert.equal(await readFile(join(f.dir,'Deck $literal.txt'),'utf8'),'Commander\n1 Aang\n');
  } finally {await f.cleanup();}
});
test('restore writes an exact safety copy before replacement and resumes after process restart until acknowledged',async()=>{
  const f=await fixture();try {
    const preview=await f.controller.choose();assert.deepEqual(preview.decks,['After']);
    await f.controller.restore({'asphodel.builder-draft.v1.pending':'original draft'});
    const rescueFiles=await readdir(join(f.dir,'backups'));assert.equal(rescueFiles.length,1);
    const rescue=await readBackup(join(f.dir,'backups',rescueFiles[0]),codec);assert.equal(rescue.library.decks[0].name,'Before');assert.equal(rescue.storage['asphodel.builder-draft.v1.pending'],'original draft');
    assert.equal(f.current.decks[0].name,'After');
    const restarted=new LibraryBackups(f.config);await restarted.resume();assert.deepEqual(await restarted.restoredStorage(),f.archive.storage);assert.deepEqual(f.mode,{fullscreen:true});
    assert.ok(await restarted.pending(),'intent kept until storage acknowledgement');await restarted.acknowledge();assert.equal(await restarted.pending(),null);
  } finally {await f.cleanup();}
});
test('definite transaction failure preserves current library; a lost acknowledgement keeps a retryable intent',async()=>{
  const f=await fixture();try {
    await f.controller.choose();const original=f.config.api.restore;
    f.config.api.restore=async()=>{throw Object.assign(new Error('disk full'),{definite:true});};
    await assert.rejects(f.controller.restore({}),/disk full/);assert.equal(f.current.decks[0].name,'Before');assert.equal(await f.controller.pending(),null);
    f.config.api.restore=async x=>{await original(x);throw new Error('response lost');};
    assert.deepEqual(await f.controller.restore({}),{canceled:false,restartRequired:true});assert.ok(await f.controller.pending());
    f.config.api.restore=original;const restarted=new LibraryBackups(f.config);await restarted.resume();assert.deepEqual(await restarted.restoredStorage(),f.archive.storage);
  } finally {await f.cleanup();}
});
test('restore cancellation and failed safety-copy writes leave the library intact; concurrent operations are refused',async()=>{
  const f=await fixture();try {
    await f.controller.choose();f.config.dialogs.confirm=async()=>false;
    assert.deepEqual(await f.controller.restore({}),{canceled:true});assert.equal(await f.controller.pending(),null);
    f.config.dialogs.confirm=async()=>true;await writeFile(join(f.dir,'backups'),'blocks directory creation');
    await assert.rejects(f.controller.restore({}));assert.equal(f.current.decks[0].name,'Before');assert.equal(await f.controller.pending(),null);
    let release;f.config.dialogs.open=()=>new Promise(resolve=>{release=resolve;});const choosing=f.controller.choose();
    await assert.rejects(f.controller.save({}),/déjà en cours/);release(null);await choosing;assert.equal(f.controller.busy,false);
  } finally {await f.cleanup();}
});
test('file selection rejects unreadable, future-version and over-limit archives before restoring anything',async()=>{
  const f=await fixture();try {
    for(const content of ['not json','{"format":"asphodel-library","version":2}','x'.repeat(codec.MAX_BACKUP_BYTES+1)]) {
      await writeFile(f.input,content);await assert.rejects(f.controller.choose());assert.equal(f.controller.chosen,undefined);assert.equal(f.current.decks[0].name,'Before');
    }
  } finally {await f.cleanup();}
});
