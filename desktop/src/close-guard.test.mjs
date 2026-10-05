import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { installCloseGuard } from './close-guard.mjs';
function fixture(options = {}) {
  const app=new EventEmitter(),ipcMain=new EventEmitter(),window=new EventEmitter();
  const sent=[];window.webContents={mainFrame:{url:'asphodel://app/'},isDestroyed:()=>false,send:(...args)=>sent.push(args)};
  const trusted={sender:window.webContents,senderFrame:window.webContents.mainFrame};
  let stopped=0,confirmed=0;
  const guard=installCloseGuard({app,ipcMain,window,shutdown:async()=>{stopped++;},confirmFailure:async()=>{confirmed++;return false;},timeoutMs:2000,...options});
  ipcMain.emit('asphodel:save-ready',trusted);
  return {app,ipcMain,window,sent,trusted,guard,get stopped(){return stopped;},get confirmed(){return confirmed;}};
}
test('native close and app quit share one save request; backend stays alive until trusted acknowledgement',async()=>{
  const f=fixture();let prevented=0;const event={preventDefault(){prevented++;}};
  f.window.emit('close',event);f.app.emit('before-quit',event);
  assert.equal(prevented,2);assert.equal(f.sent.length,1);assert.equal(f.stopped,0);
  const pending=f.guard.request(),id=f.sent[0][1];
  f.ipcMain.emit('asphodel:save-result',{...f.trusted,senderFrame:{url:'asphodel://app/'}},id,true);
  f.ipcMain.emit('asphodel:save-result',f.trusted,'stale-id',true);assert.equal(f.stopped,0);
  f.ipcMain.emit('asphodel:save-result',f.trusted,id,true);await pending;assert.equal(f.stopped,1);
  f.window.emit('close',event);assert.equal(prevented,2);f.window.emit('closed');
  assert.equal(f.ipcMain.listenerCount('asphodel:save-result'),0);
});
test('save failure cancels closing; a later retry can complete',async()=>{
  const f=fixture();let pending=f.guard.request();f.ipcMain.emit('asphodel:save-result',f.trusted,f.sent[0][1],false);await pending;
  assert.equal(f.stopped,0);assert.equal(f.confirmed,1);
  pending=f.guard.request();f.ipcMain.emit('asphodel:save-result',f.trusted,f.sent[1][1],true);await pending;assert.equal(f.stopped,1);
});
test('unresponsive renderer times out without stopping backend unless user chooses to quit',async()=>{
  const f=fixture({timeoutMs:10});await f.guard.request();assert.equal(f.stopped,0);assert.equal(f.confirmed,1);
  const force=fixture({timeoutMs:10,confirmFailure:async()=>true});await force.guard.request();assert.equal(force.stopped,1);
});
