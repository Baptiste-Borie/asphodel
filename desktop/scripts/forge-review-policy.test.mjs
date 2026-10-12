import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reviewChoice,recordReviewAttempt} from './forge-review-policy.mjs';
const item=(label,control)=>({label,control,choice:{decisionId:'real-id',kind:'action',choice:label,reason:'human_choice'}});
const pending=(items,type='priority_action',kind='menu')=>({type,context:{turn:1},rendered:{kind,items}});
test('returns exact engine choices and limits repeated cast attempts before passing',()=>{
 const cast=item('Cast Krenko'),pass=item('Pass priority','pass'),d=pending([cast,pass]),attempts=new Map();
 assert.equal(reviewChoice(d,attempts).choice,cast.choice);
 recordReviewAttempt(d,cast.label,attempts);
 assert.equal(reviewChoice(d,attempts).choice,pass.choice);
});
test('keeps opening hand, never invents a keep or physical identity',()=>{
 const keep=item('Keep');assert.equal(reviewChoice(pending([keep,item('Mulligan')],'object_selection','opening_hand')).choice,keep.choice);
 assert.equal(reviewChoice(pending([item('Mulligan')],'object_selection','opening_hand')),null);
 assert.equal(reviewChoice({rendered:{kind:'physical_declare'}}),null);
});
test('clamps suggested values to the actual allowed interval',()=>{
 assert.equal(reviewChoice({rendered:{kind:'value',decisionId:'value-id',min:2,max:4,suggested:[8]}}).choice.choice,4);
});
test('does not remove attackers, and uses only a supplied finish',()=>{
 const add={...item('Attack'),combat:{operation:'add'}},remove={...item('Remove'),combat:{operation:'remove'}},finish={...item('Done'),combat:{operation:'finish'}};
 const d=pending([remove,add,finish],'attackers_selection');assert.equal(reviewChoice(d).choice,add.choice);
 d.selectedCardRefs=['a','b','c'];assert.equal(reviewChoice(d).choice,finish.choice);
 const forced=pending([remove],'attackers_selection');assert.equal(reviewChoice(forced),null);
});
