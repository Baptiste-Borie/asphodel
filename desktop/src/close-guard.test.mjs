import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { installCloseGuard } from './close-guard.mjs';
function fixture(options = {}) {
  const app=new EventEmitter(),ipcMain=new EventEmitter(),window=new EventEmitter();
  let destroyed=false;
  const sent=[],contents=Object.assign(new EventEmitter(),{mainFrame:{url:'asphodel://app/'},isDestroyed:()=>destroyed,send:(...args)=>sent.push(args)});
  // Electron's BrowserWindow.webContents getter throws once the native window is destroyed.
  Object.defineProperty(window,'webContents',{get(){if(destroyed)throw new TypeError('Object has been destroyed');return contents;}});
  window.isDestroyed=()=>destroyed;
  window.destroy=()=>{destroyed=true;window.emit('closed');};
  const trusted={sender:contents,senderFrame:contents.mainFrame};
  let stopped=0,confirmed=0;
  const guard=installCloseGuard({app,ipcMain,window,shutdown:async()=>{stopped++;},confirmFailure:async()=>{confirmed++;return false;},timeoutMs:2000,...options});
  ipcMain.emit('asphodel:save-ready',trusted);
  return {app,ipcMain,window,contents,sent,trusted,guard,get stopped(){return stopped;},get confirmed(){return confirmed;}};
}
test('native close and app quit share one save request; backend stays alive until trusted acknowledgement',async()=>{
  const f=fixture();let prevented=0;const event={preventDefault(){prevented++;}};
  f.window.emit('close',event);f.app.emit('before-quit',event);
  assert.equal(prevented,2);assert.equal(f.sent.length,1);assert.equal(f.stopped,0);
  const pending=f.guard.request(),id=f.sent[0][1];
  f.ipcMain.emit('asphodel:save-result',{...f.trusted,senderFrame:{url:'asphodel://app/'}},id,true);
  f.ipcMain.emit('asphodel:save-result',f.trusted,'stale-id',true);assert.equal(f.stopped,0);
  f.ipcMain.emit('asphodel:save-result',f.trusted,id,true);await pending;assert.equal(f.stopped,1);
  f.window.emit('close',event);assert.equal(prevented,2);f.window.destroy();
  assert.equal(f.ipcMain.listenerCount('asphodel:save-result'),0);
  assert.equal(f.contents.listenerCount('did-start-navigation'),0);
  assert.equal(f.app.listenerCount('before-quit'),0);
});
test('backend exit can destroy the native window during shutdown without a cleanup exception',async()=>{
  const errors=[];let stopped=0;
  const f=fixture({shutdown:async()=>{stopped++;f.window.destroy();},onError:error=>errors.push(error)});
  const pending=f.guard.request();
  assert.equal(stopped,0);
  f.ipcMain.emit('asphodel:save-result',f.trusted,f.sent[0][1],true);
  await pending;
  assert.equal(stopped,1);assert.deepEqual(errors,[]);
  assert.equal(f.ipcMain.listenerCount('asphodel:save-ready'),0);
  assert.equal(f.ipcMain.listenerCount('asphodel:save-result'),0);
  assert.equal(f.contents.listenerCount('did-start-navigation'),0);
  await f.guard.request();assert.equal(stopped,1);
});
test('destroying the window during a pending save drains the request without opening a dialog on a destroyed window',async()=>{
  const f=fixture(),pending=f.guard.request();
  assert.equal(f.stopped,0);
  f.window.destroy();await pending;
  assert.equal(f.stopped,1);assert.equal(f.confirmed,0);
  assert.equal(f.ipcMain.listenerCount('asphodel:save-result'),0);
  assert.equal(f.contents.listenerCount('did-start-navigation'),0);
});
test('save failure cancels closing; a later retry can complete',async()=>{
  const f=fixture();let pending=f.guard.request();f.ipcMain.emit('asphodel:save-result',f.trusted,f.sent[0][1],false);await pending;
  assert.equal(f.stopped,0);assert.equal(f.confirmed,1);
  pending=f.guard.request();f.ipcMain.emit('asphodel:save-result',f.trusted,f.sent[1][1],true);await pending;assert.equal(f.stopped,1);
});
test('a native backup/restore operation holds closing before any renderer save request',async()=>{
  let busy=true;const f=fixture({canClose:()=>!busy});
  await f.guard.request();assert.equal(f.sent.length,0);assert.equal(f.stopped,0);assert.equal(f.confirmed,0);
  busy=false;const pending=f.guard.request();f.ipcMain.emit('asphodel:save-result',f.trusted,f.sent[0][1],true);await pending;assert.equal(f.stopped,1);
});
test('a reloaded renderer with blocked restoration can quit without waiting for the previous page',async()=>{
  const f=fixture();f.window.webContents.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});
  await f.guard.request();assert.equal(f.sent.length,0);assert.equal(f.stopped,1);assert.equal(f.confirmed,0);
});
test('unresponsive renderer times out without stopping backend unless user chooses to quit',async()=>{
  const f=fixture({timeoutMs:10});await f.guard.request();assert.equal(f.stopped,0);assert.equal(f.confirmed,1);
  const force=fixture({timeoutMs:10,confirmFailure:async()=>true});await force.guard.request();assert.equal(force.stopped,1);
});
