import {combatFixture} from './combat-flow.mjs';

// Public DTOs exercise presentation/transport, not a real Forge match.
export function targetFixture(playMode='digital') {
  const base=combatFixture(playMode).states[0];
  const card=(ref,name,zone='graveyard')=>({cardRef:ref,name,zone,ownerId:'human',controllerId:'human',hidden:false,faceDown:false,tapped:false,summoningSick:false,counters:{},power:2,toughness:2,typeLine:'Creature'});
  const observation=structuredClone(base.observation);
  observation.game.phase='main1';observation.players[0].graveyard=[card('grave1','Bear'),card('grave2','Bear')];
  observation.players[0].hand=[card('source','Test spell','hand')];
  observation.stack=[{stackRef:'stack1',position:0,sourceCardRef:'ability-host',sourceCardName:'Repeated ability',controllerId:'ai1',description:'First ability',hidden:false,faceDown:false},
    {stackRef:'stack2',position:1,sourceCardRef:'ability-host',sourceCardName:'Repeated ability',controllerId:'ai1',description:'Second ability',hidden:false,faceDown:false}];
  const choice=(id,value)=>({decisionId:id,kind:'target',choice:value,reason:'human_choice'});
  const target=(id,kind,ref,name,zone,controllerId='human',concealed=false)=>({label:'Engine option',cardRef:kind==='card'?ref:null,...(kind==='player'?{playerId:ref}:{}),choice:choice(id,ref),
    target:{kind,name:concealed?null:name,zone,controllerId,concealed,stackRef:kind==='spell'?ref:null}});
  function state(id,items,count=0,min=1,max=2){
    return {...structuredClone(base),sessionId:'target-session',observation:structuredClone(observation),pendingDecision:{decisionId:id,type:'target_selection',context:{...observation.game,stackSize:2},selectedCardRefs:null,combatPairings:null,
      rendered:{kind:'menu',title:'Choose the targets for this effect',targeting:{sourceName:'Test spell',abilityText:'Choose the legal targets offered by this effect.',minTargets:min,maxTargets:max,selectedCount:count},items}}};
  }
  const opponent=playMode==='digital'?'ai2':'ai1';
  const extras=Array.from({length:10},(_,i)=>target('t1','card',`extra${i}`,`Public candidate ${i}`,'graveyard'));
  const states=[state('t1',[target('t1','card','grave1','Bear','graveyard'),target('t1','card','grave2','Bear','graveyard'),target('t1','player',opponent,'External Player','player',opponent),target('t1','card','hidden','Secret should not appear','exile','human',true),...extras]),
    state('t2',[target('t2','player',opponent,'External Player','player',opponent),target('t2','finish','finish-selected',null,null)],1),
    state('t3',[target('t3','spell','stack1','Repeated ability','stack','ai1'),target('t3','spell','stack2','Repeated ability','stack','ai1'),target('t3','finish','finish-zero',null,null)],0,0,1),
    {...structuredClone(base),sessionId:'target-session',observation,pendingDecision:{decisionId:'priority',type:'priority_action',context:{...observation.game,stackSize:2},selectedCardRefs:null,combatPairings:null,rendered:{kind:'menu',title:'Choose an action',items:[{label:'Pass priority',control:'pass',cardRef:null,choice:{decisionId:'priority',kind:'action',choice:'pass',reason:'human_choice'}}]}}}];
  return {states,transition:['grave2','finish-selected','stack2']};
}
export function installTargetFixture(fixture){
  const original=window.fetch.bind(window);window.targetSmoke={index:0,choices:[]};
  window.fetch=async(input,options={})=>{
    const url=typeof input==='string'?input:input.url;const state=fixture.states[window.targetSmoke.index];
    if(url==='/playtests/active'||url==='/playtests/target-session')return Response.json(state);
    if(url==='/cards/presentation')return Response.json({cards:{}});
    if(url==='/playtests/target-session/choice'){
      const choice=JSON.parse(options.body);
      if(!state.pendingDecision.rendered.items.some(item=>JSON.stringify(item.choice)===JSON.stringify(choice)))return Response.json({message:'Illegal/stale target fixture choice'},{status:400});
      window.targetSmoke.choices.push(choice);if(fixture.transition[window.targetSmoke.index]===choice.choice)window.targetSmoke.index++;
      return Response.json({accepted:true});
    }
    return original(input,options);
  };
}
