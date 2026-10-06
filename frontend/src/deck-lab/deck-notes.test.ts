import assert from 'node:assert/strict';
import test from 'node:test';
import { createNote, detachNote, notePosition } from './deck-notes';
import { ProjectHistory } from './project-history';
import { prepareProject, ProjectPersistence, loadDrafts, sheetFromProject, type Storage } from './project-persistence';
import { parseBuilderProject } from '../../../shared/builder-project.mjs';
import { reconcileWorkspace, parseWorkspace, setRowMembership } from './deck-workspace';
import type { Sheet } from './deck-model';
import sample from './cards.json';
const setup = () => {
  const s: Sheet = {name:'Aang notes',cuts:[],groups:[{name:'Commander',commander:true,entries:[]},{name:'Ramp',entries:[{card:sample[0]!,quantity:37}]}]};
  const h=new ProjectHistory(s),w=s.workspace!,rows=reconcileWorkspace(s,w);return {s,h,w,rows};
};
const edit = (h:ProjectHistory, label:string, mutate:()=>void) => {h.begin(label);mutate();h.commit();};
test('free and linked notes preserve quantities and card identity; exact undo/redo removes optional notes field',()=>{
  const {s,h,w,rows}=setup(),before=prepareProject(s);
  edit(h,'Note',()=>{createNote(w,{x:-400,y:300}).text='Draw to find';createNote(w,{x:190,y:0},rows[0]!.placement.id).text='Protection for Aang';});
  const after=prepareProject(s);assert.deepEqual(after.groups,before.groups);assert.equal(after.workspace.notes!.length,2);
  assert.deepEqual(parseWorkspace(JSON.stringify(w)),w);assert.deepEqual(sheetFromProject(after).workspace,w);
  h.undo();assert.equal(w.notes,undefined);assert.deepEqual(prepareProject(s),before);h.redo();assert.deepEqual(prepareProject(s),after);
});
test('linked notes follow cards and category moves; detaching keeps the absolute position and remains undoable',()=>{
  const {s,h,w,rows}=setup(),row=rows[0]!,note=createNote(w,{x:190,y:24},row.placement.id),initial=notePosition(note,w);
  row.placement.x+=650;row.placement.y-=130;assert.deepEqual(notePosition(note,w),{x:initial.x+650,y:initial.y-130});
  s.groups[1]!.name='Mana';reconcileWorkspace(s,w);assert.equal(note.cardId,row.entry.id);
  setRowMembership(s,row,false);reconcileWorkspace(s,w);assert.equal(note.cardId,row.entry.id);
  h.sync();const before=prepareProject(s),point=notePosition(note,w);
  edit(h,'Detach',()=>detachNote(note,w));assert.equal(note.cardId,undefined);assert.deepEqual(notePosition(note,w),point);
  h.undo();assert.deepEqual(prepareProject(s),before);
});
test('V1 cutting preserves annotation text and position; undo restores its stable link',()=>{
  const {s,h,w,rows}=setup();createNote(w,{x:190,y:12},rows[0]!.placement.id).text='Possible cut';h.sync();
  const before=prepareProject(s),point=notePosition(w.notes![0]!,w);
  edit(h,'Cut',()=>{const entry=s.groups[1]!.entries.pop()!;s.cuts.push(entry.card);reconcileWorkspace(s,w);});
  assert.equal(w.notes![0]!.cardId,undefined);assert.equal(w.notes![0]!.text,'Possible cut');assert.deepEqual(notePosition(w.notes![0]!,w),point);
  parseBuilderProject(prepareProject(s));h.undo();assert.deepEqual(prepareProject(s),before);
});
test('typing and dragging are single actions; cancellation restores text, colors and offsets exactly',()=>{
  const {s,h,w}=setup();createNote(w,{x:200,y:300});h.sync();const before=prepareProject(s);
  h.begin('Text');for(const text of ['P','Protect','Protection for Aang'])w.notes![0]!.text=text;h.commit();
  const typed=prepareProject(s);h.undo();assert.deepEqual(prepareProject(s),before);h.redo();assert.deepEqual(prepareProject(s),typed);
  h.begin('Drag');for(let i=0;i<100;i++)w.notes![0]!.x+=2;h.cancel();assert.deepEqual(prepareProject(s),typed);
  edit(h,'Color',()=>{w.notes![0]!.color='sage';});h.undo();assert.deepEqual(prepareProject(s),typed);
});
test('text is journalled before debounce, survives failed saves and drains on immediate close',async()=>{
  const {s,w}=setup(),map=new Map<string,string>();
  const local: Storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);},removeItem:k=>{map.delete(k);},key:i=>[...map.keys()][i]??null,get length(){return map.size;}};
  let fail=true,last:unknown;const manager=new ProjectPersistence(local,async p=>{if(fail)throw Error('disk failure');last=p;return{id:7};},()=>{},60_000);
  createNote(w,{x:-10,y:20}).text='Typed just before closing';manager.changed(s);
  assert.equal(loadDrafts(local).drafts[0]!.project.workspace.notes![0]!.text,'Typed just before closing');
  assert.equal(await manager.flush(),false);assert.deepEqual(sheetFromProject(loadDrafts(local).drafts[0]!.project).workspace,w);
  fail=false;assert.equal(await manager.flush(),true);assert.deepEqual(last,prepareProject(s));assert.equal(loadDrafts(local).drafts.length,0);
});
test('old projects remain readable; malformed notes, dead links and printing metadata are rejected',()=>{
  const {s,w,rows}=setup();parseBuilderProject(prepareProject(s));createNote(w,{x:190,y:0},rows[0]!.placement.id);const good=prepareProject(s);
  for(const mutate of [(p:any)=>p.workspace.notes[0].text='x'.repeat(4001),(p:any)=>p.workspace.notes[0].color='neon',(p:any)=>p.workspace.notes[0].x=NaN,(p:any)=>p.workspace.notes.push(p.workspace.notes[0]),(p:any)=>p.workspace.notes[0].cardId='missing',(p:any)=>p.groups[1].entries[0].card.faces=[{name:'Back',image:123}],(p:any)=>p.groups[1].entries[0].card.otherPrintings=[{}]]){
    const bad=structuredClone(good);mutate(bad);assert.throws(()=>parseBuilderProject(bad));
  }
});
