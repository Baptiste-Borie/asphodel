import { it } from 'node:test';
import assert from 'node:assert/strict';
import { decisionPresentationNames } from './decision-cards.js';
it('only requests presentation names explicitly present in the current card picker',()=>{
  const item={label:'Forest',cardRef:'card-48',presentationName:'Forest',choice:{decisionId:'d',kind:'object' as const,choice:'o',reason:'human'}};
  assert.deepEqual(decisionPresentationNames({kind:'card_picker',title:'Search',items:[item,{...item,cardRef:'card-49'}],selected:[],minSelections:0,maxSelections:2}),['Forest']);
  assert.deepEqual(decisionPresentationNames(undefined),[]);
  assert.deepEqual(decisionPresentationNames({kind:'menu',title:'Other',items:[item]}),[]);
});
