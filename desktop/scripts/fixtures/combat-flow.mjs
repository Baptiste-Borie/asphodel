// Deterministic public DTOs for UI checks; real Forge legality is tested separately.
export function combatFixture(playMode='digital') {
  const card=(ref,name,power=1,toughness=1,controller='human')=>({cardRef:ref,name,zone:'battlefield',ownerId:controller,controllerId:controller,
    faceDown:false,hidden:false,tapped:false,summoningSick:false,counters:{},power,toughness,typeLine:'Creature'});
  const player=(id,role,name,cards)=>({playerId:id,role,name,life:40,startingLife:40,handSize:0,librarySize:90,graveyardSize:0,exileSize:0,commandZoneSize:0,
    battlefieldSize:cards.length,externalController:true,battlefield:cards,graveyard:[],exile:[],command:[],commanders:[],...(role==='self'?{hand:[]}:{})});
  const observation={gameRef:'combat-smoke',game:{turn:3,phase:'combat_declare_attackers',activePlayerId:'human',priorityPlayerId:'human'},selfPlayerId:'human',stack:[],
    players:[player('human','self','External Player 1',[card('g1','Goblin'),card('g2','Goblin')]),
      player('ai1','opponent','External Player 2',[card('bear','Bear',2,2,'ai1'),card('flying','Flying threat',5,5,'ai1')]),
      ...(playMode==='digital'?[player('ai2','opponent','External Player 3',[])]:[])]};
  const opponent=playMode==='digital'?'ai2':'ai1';
  function state(id,type,entries,pairs=[],attackers=null) {
    const obs=structuredClone(observation);obs.game.phase=type==='blockers_selection'?'combat_declare_blockers':'combat_declare_attackers';
    const items=entries.map(([choice,ref,to,operation])=>({label:'Forge option',cardRef:ref,combat:{operation,relatedRef:to},
      choice:{decisionId:id,kind:'object',choice,reason:'human_choice'}}));
    return {sessionId:'combat-session',status:'waiting_for_human',playMode,humanDeckName:'Human fixture',asphodelDeckNames:playMode==='digital'?['Opponent 1','Opponent 2']:['Opponent'],
      observation:obs,pendingDecision:{decisionId:id,type,context:{...obs.game,stackSize:0},rendered:{kind:'menu',title:'Combat',items},
        selectedCardRefs:pairs.map(p=>p.cardRef),combatPairings:pairs,combatAttackers:attackers},manaPaymentActive:false,publicEvents:[],frames:[],asphodelDecisionCount:0,endedByHuman:false,result:null,error:null};
  }
  const edits=[['first-add','g1','ai1','add'],['second-add','g2',opponent,'add'],['finish-empty',null,null,'finish']];
  const pairs=[{cardRef:'g2',relatedRef:opponent}];
  const attackers=[{cardRef:'bear',relatedRef:'human'},{cardRef:'flying',relatedRef:'human'}];
  const states=[state('d1','attackers_selection',edits),
    state('d2','attackers_selection',[['first-add','g1','ai1','add'],['second-remove','g2',opponent,'remove'],['finish-attacks',null,null,'finish']],pairs),
    state('d3','attackers_selection',edits),
    state('d4','blockers_selection',[['block-bear','g1','bear','add'],['finish-empty-blocks',null,null,'finish']],[],attackers),
    state('d5','blockers_selection',[['remove-bear','g1','bear','remove'],['finish-blocks',null,null,'finish']],[{cardRef:'g1',relatedRef:'bear'}],attackers)];
  return {states,transition:['second-add','second-remove','finish-empty','block-bear']};
}

/** Function intentionally has no module captures, so Playwright can install it in the real renderer. */
export function installCombatFixture(fixture) {
  const original=window.fetch.bind(window);
  window.combatSmoke={index:0,choices:[]};
  window.fetch=async(input,options={})=>{
    const url=typeof input==='string'?input:input.url;
    const state=fixture.states[window.combatSmoke.index];
    if(url==='/playtests/active'||url==='/playtests/combat-session')return Response.json(state);
    if(url==='/cards/presentation')return Response.json({cards:{}});
    if(url==='/playtests/combat-session/choice'){
      const choice=JSON.parse(options.body);
      const legal=state.pendingDecision.rendered.items.some(item=>JSON.stringify(item.choice)===JSON.stringify(choice));
      if(!legal)return Response.json({message:'Illegal/stale fixture choice'},{status:400});
      window.combatSmoke.choices.push(choice);
      if(fixture.transition[window.combatSmoke.index]===choice.choice)window.combatSmoke.index++;
      return Response.json({accepted:true});
    }
    return original(input,options);
  };
}
