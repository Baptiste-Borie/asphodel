import assert from 'node:assert/strict';
import test from 'node:test';
import { captureLibraryStorage, restoreLibraryStorage } from '../library-storage';
function memory(values:Record<string,string>={}) {
  const map=new Map(Object.entries(values));
  return { get length(){return map.size;},key:(i:number)=>[...map.keys()][i]??null,getItem:(k:string)=>map.get(k)??null,
    setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);},clear:()=>map.clear() } as Storage;
}
test('storage replacement restores drafts/legacy layouts/selection while preserving unrelated keys',()=>{
  const storage=memory({'unrelated':'keep','asphodel.builder-draft.v1.old':'old','asphodel.deck-lab.selection.v1':'old pool'});
  const next={'asphodel.builder-draft.v1.new':'new draft','asphodel.deck-table.v1.9':'layout','asphodel.voice.approvedVocabulary.v1':'vocabulary'};
  restoreLibraryStorage(storage,next);assert.deepEqual(captureLibraryStorage(storage),next);assert.equal(storage.getItem('unrelated'),'keep');
});
test('quota failure restores previous storage and leaves the new restore intent unacknowledged',()=>{
  const storage=memory({'asphodel.deck-lab.selection.v1':'before'});const set=storage.setItem;
  storage.setItem=(k,v)=>{if(v==='quota failure')throw new Error('quota');set(k,v);};
  assert.throws(()=>restoreLibraryStorage(storage,{'asphodel.builder-draft.v1.new':'quota failure'}));
  assert.deepEqual(captureLibraryStorage(storage),{'asphodel.deck-lab.selection.v1':'before'});
});
