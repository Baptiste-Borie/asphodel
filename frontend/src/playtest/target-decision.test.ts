import assert from 'node:assert/strict';
import {it} from 'node:test';
import {targetDecisionModel} from './target-decision';
import type {AgentObservation,MenuItem,WebPendingDecisionDTO} from './types';

const card=(ref:string,name:string,zone:'battlefield'|'graveyard'='battlefield')=>({cardRef:ref,name,zone,ownerId:'human',controllerId:'human',hidden:false,faceDown:false,tapped:false,summoningSick:false,counters:{},power:2,toughness:2,typeLine:'Creature'});
function fixture(){
  const player=(playerId:string,role:'self'|'opponent')=>({playerId,role,name:'External Player 2',life:40,startingLife:40,handSize:0,librarySize:90,graveyardSize:0,exileSize:0,commandZoneSize:0,battlefieldSize:0,externalController:true,battlefield:[],graveyard:[],exile:[],command:[],commanders:[],...(role==='self'?{hand:[]}: {})});
  const observation:AgentObservation={gameRef:'g',selfPlayerId:'human',game:{turn:2,phase:'main1',activePlayerId:'human',priorityPlayerId:'human'},players:[player('human','self'),player('ai1','opponent'),player('ai2','opponent')],stack:[]};
  observation.players[0]!.graveyard=[card('g1','Bear','graveyard'),card('g2','Bear','graveyard')];
  const item=(choice:string,ref:string):MenuItem=>({label:'Engine label',cardRef:ref,choice:{decisionId:'d1',kind:'target',choice,reason:'human_choice'},target:{kind:'card',name:'Bear',concealed:false,zone:'graveyard',controllerId:'human',stackRef:null}});
  const pending:WebPendingDecisionDTO={decisionId:'d1',type:'target_selection',context:{...observation.game,stackSize:0},selectedCardRefs:null,combatPairings:null,
    rendered:{kind:'menu',title:'Choose up to two',targeting:{sourceName:'Reanimate',abilityText:'Return target creature',minTargets:1,maxTargets:2,selectedCount:0},items:[item('first','g1'),item('second','g2')]}};
  return {pending,observation,item};
}
const menu=(pending:WebPendingDecisionDTO)=>{if(pending.rendered.kind!=='menu')throw Error('Expected menu');return pending.rendered;};
it('keeps same-name graveyard targets distinct with location and exact immutable choices',()=>{
  const {pending,observation}=fixture(),before=JSON.stringify({pending,observation});const model=targetDecisionModel(pending,observation)!;
  assert.deepEqual(model.options.map(o=>o.label),['Bear · 1','Bear · 2']);assert.equal(model.options[1]!.detail,'Cimetière · Toi');
  assert.equal(model.options[1]!.item,menu(pending).items[1]);assert.equal(JSON.stringify({pending,observation}),before);assert.equal(model.finishes.length,0);
});
it('shows all three player destinations using seats and current life, with no card artwork',()=>{
  const {pending,observation}=fixture();menu(pending).items=observation.players.map(player=>({label:'raw',playerId:player.playerId,cardRef:null,choice:{decisionId:'d1',kind:'target',choice:player.playerId,reason:'human_choice'},target:{kind:'player',name:'raw',concealed:false,zone:null,controllerId:player.playerId,stackRef:null}}));
  observation.players[2]!.life=23;const options=targetDecisionModel(pending,observation)!.options;
  assert.deepEqual(options.map(o=>o.label),['Toi · 40 PV','Asphodel 1 · 40 PV','Asphodel 2 · 23 PV']);assert.ok(options.every(o=>!o.artName));
});
it('identifies spell instances by stackRef and never binds a spell choice to its source permanent',()=>{
  const {pending,observation}=fixture();observation.stack=[{stackRef:'s1',position:0,sourceCardRef:'host',sourceCardName:'Ability',controllerId:'ai1',description:'First',hidden:false,faceDown:false},{stackRef:'s2',position:1,sourceCardRef:'host',sourceCardName:'Ability',controllerId:'ai1',description:'Second',hidden:false,faceDown:false}];
  menu(pending).items=observation.stack.map(stack=>({label:'raw',cardRef:null,choice:{decisionId:'d1',kind:'target',choice:stack.stackRef,reason:'human_choice'},target:{kind:'spell',name:'Ability',concealed:false,zone:'stack',controllerId:'ai1',stackRef:stack.stackRef}}));
  const options=targetDecisionModel(pending,observation)!.options;assert.deepEqual(options.map(o=>o.label),['Ability · 1','Ability · 2']);assert.match(options[1]!.detail,/Position 2/);assert.equal(options[1]!.item.cardRef,null);
});
it('uses observer visibility above target hints and never resolves opponent hands',()=>{
  const {pending,observation,item}=fixture();observation.players[0]!.graveyard[0]!.hidden=true;observation.players[0]!.graveyard[0]!.name='Leaked secret';
  menu(pending).items[0]!.target!.name='Leaked secret';menu(pending).items[1]!.target!.concealed=true;
  (observation.players[1] as unknown as {hand:unknown[]}).hand=[card('secret','Opponent secret')];
  const unknown=item('unknown','secret');unknown.target!.name=null;menu(pending).items.push(unknown);
  const model=targetDecisionModel(pending,observation)!;assert.ok(model.options.every(o=>!o.artName&&!o.stats));assert.ok(!JSON.stringify(model.options.map(o=>({label:o.label,art:o.artName}))).includes('secret'));
});
it('keeps public targets absent from the observation, including duplicate names, without inventing stats',()=>{
  const {pending,observation}=fixture();observation.players[0]!.graveyard=[];
  const options=targetDecisionModel(pending,observation)!.options;assert.deepEqual(options.map(o=>o.label),['Bear · 1','Bear · 2']);assert.ok(options.every(o=>o.artName==='Bear'&&o.stats===null));
});
it('relays the engine selected count and finish only, even when minimum or maximum look reached',()=>{
  const {pending,observation}=fixture();menu(pending).targeting!.selectedCount=1;
  assert.equal(targetDecisionModel(pending,observation)!.finishes.length,0);assert.match(targetDecisionModel(pending,observation)!.progress,/choisies : 1.*1 à 2/);
  const finish:MenuItem={label:'finish',choice:{decisionId:'d1',kind:'target',choice:'finish-exact',reason:'human_choice'},target:{kind:'finish',name:null,concealed:false,zone:null,controllerId:null,stackRef:null}};
  menu(pending).items.push(finish);assert.equal(targetDecisionModel(pending,observation)!.finishes[0]!.item,finish);
  menu(pending).targeting!.selectedCount=0;menu(pending).targeting!.minTargets=0;assert.equal(targetDecisionModel(pending,observation)!.finishes[0]!.label,'Terminer sans choisir de cible');
});
it('falls back for older, incomplete or stale menus and leaves other decision families unchanged',()=>{
  for(const mutate of [(p:WebPendingDecisionDTO)=>delete menu(p).targeting,(p:WebPendingDecisionDTO)=>delete menu(p).items[0]!.target,(p:WebPendingDecisionDTO)=>{menu(p).items[0]!.choice.decisionId='old';},(p:WebPendingDecisionDTO)=>{menu(p).targeting!.maxTargets=-1;},(p:WebPendingDecisionDTO)=>{p.type='priority_action';}]){
    const {pending,observation}=fixture();mutate(pending);assert.equal(targetDecisionModel(pending,observation),null);
  }
  assert.equal(targetDecisionModel(null,null),null);
});
it('keeps an unknown zone target selectable and distinguishes a controlled permanent from its owner',()=>{
  const {pending,observation}=fixture();menu(pending).items[0]!.target!.zone='some_future_zone';observation.players[0]!.graveyard[0]!.controllerId='ai2';
  menu(pending).items[1]!.target!.zone='battlefield';observation.players[0]!.graveyard[1]!.controllerId='ai1';
  const model=targetDecisionModel(pending,observation)!;assert.equal(model.options[0]!.group,'Autre zone');assert.equal(model.options[1]!.detail,'Champ de bataille · Asphodel 1');assert.equal(model.options.length,2);
});
