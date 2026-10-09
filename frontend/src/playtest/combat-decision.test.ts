import assert from 'node:assert/strict';
import {test} from 'node:test';
import {combatDecisionModel,combatIdentities} from './combat-decision';
import type {AgentCardObservation,AgentObservation,MenuItem,WebPendingDecisionDTO} from './types';

function card(ref:string,name='Goblin',patch:Partial<AgentCardObservation>={}):AgentCardObservation {
  return {cardRef:ref,name,zone:'battlefield',ownerId:'human',controllerId:'human',faceDown:false,hidden:false,
    tapped:false,summoningSick:false,counters:{},power:1,toughness:1,typeLine:'Creature — Goblin',...patch};
}
function observation():AgentObservation {
  const player={life:40,startingLife:40,handSize:0,librarySize:90,graveyardSize:0,exileSize:0,commandZoneSize:0,battlefieldSize:0,
    externalController:true,battlefield:[],graveyard:[],exile:[],command:[],commanders:[]};
  return {gameRef:'game',game:{turn:3,phase:'combat_declare_attackers',activePlayerId:'human',priorityPlayerId:'human'},selfPlayerId:'human',stack:[],
    players:[{...player,playerId:'human',role:'self',name:'External Player 1',hand:[],battlefield:[card('g1'),card('g2')]},
      {...player,playerId:'ai1',role:'opponent',name:'External Player 2',battlefield:[card('bear','Bear',{power:2,toughness:2})]},
      {...player,playerId:'ai2',role:'opponent',name:'External Player 3',life:23,battlefield:[]}]};
}
function option(id:string,ref:string|null,destination:string|null,operation:'add'|'remove'|'finish'='add'):MenuItem {
  return {label:'Unparsed engine label',cardRef:ref,combat:{operation,relatedRef:destination},choice:{decisionId:'d',kind:'object',choice:id,reason:'human_choice'}};
}
function pending(items:MenuItem[],patch:Partial<WebPendingDecisionDTO>={}):WebPendingDecisionDTO {
  return {decisionId:'d',type:'attackers_selection',context:{...observation().game,stackSize:0},rendered:{kind:'menu',title:'Declare attackers',items},
    selectedCardRefs:[],combatPairings:[],...patch};
}

test('duplicate creatures and two defenders retain exact distinct Forge choices',()=>{
  const items=[option('g1-ai1','g1','ai1'),option('g1-ai2','g1','ai2'),option('g2-ai2','g2','ai2'),option('done',null,null,'finish')];
  const model=combatDecisionModel(pending(items),observation())!;
  assert.deepEqual(model.groups.map(g=>g.card.label),['Goblin · 1','Goblin · 2']);
  assert.deepEqual(model.groups[0].options.map(o=>o.destination.label),['Asphodel 1 · 40 PV','Asphodel 2 · 23 PV']);
  assert.equal(model.groups[0].options[0].item,items[0]); assert.equal(model.groups[1].options[0].item,items[2]);
  assert.equal(model.finishes[0].item,items[3]); assert.equal(model.finishes[0].label,'N’attaquer avec aucune créature');
});
test('selected attacks and remove destinations are authoritative, not guessed from tapped state',()=>{
  const obs=observation();obs.players[0].battlefield[0].tapped=false;obs.players[0].battlefield[1].tapped=true;
  const model=combatDecisionModel(pending([option('undo','g1','ai2','remove'),option('add','g2','ai1')],
    {selectedCardRefs:['g1'],combatPairings:[{cardRef:'g1',relatedRef:'ai2'}]}),obs)!;
  assert.equal(model.groups[0].selected,true);assert.equal(model.groups[1].selected,false);
  assert.equal(model.groups[0].options[0].operation,'remove');assert.equal(model.assignments![0].destination.ref,'ai2');
  assert.equal(model.finishes.length,0,'no synthesized Finish when Forge rejects the declaration');
});
test('blocking lists every public attacker, including one with no offered block',()=>{
  const obs=observation();obs.players[1].battlefield.push(card('flying','Flying threat',{power:5,toughness:5}));
  const model=combatDecisionModel(pending([option('block','g1','bear'),option('end',null,null,'finish')],{
    type:'blockers_selection',combatAttackers:[{cardRef:'bear',relatedRef:'human'},{cardRef:'flying',relatedRef:'human'}]}),obs)!;
  assert.equal(model.attackers!.length,2);assert.equal(model.attackers![0].canAddBlock,true);assert.equal(model.attackers![1].canAddBlock,false);
  assert.equal(model.attackers![1].ownBlocks,0);assert.equal(model.attackers![1].card.label,'Flying threat');
  assert.equal(model.finishes[0].label,'Ne bloquer avec aucune créature');
});
test('one blocker assigned to multiple attackers retains all pairings and all removal choices',()=>{
  const obs=observation();obs.players[1].battlefield.push(card('bear2','Bear',{power:2,toughness:2}));
  const pairs=[{cardRef:'g1',relatedRef:'bear'},{cardRef:'g1',relatedRef:'bear2'}];
  const model=combatDecisionModel(pending([option('remove1','g1','bear','remove'),option('remove2','g1','bear2','remove'),option('finish',null,null,'finish')],{
    type:'blockers_selection',selectedCardRefs:['g1','g1'],combatPairings:pairs,combatAttackers:[{cardRef:'bear',relatedRef:'human'},{cardRef:'bear2',relatedRef:'human'}]}),obs)!;
  assert.equal(model.groups.length,1);assert.equal(model.groups[0].options.length,2);assert.equal(model.assignments!.length,2);
  assert.deepEqual(model.attackers!.map(a=>a.ownBlocks),[1,1]);assert.equal(model.finishes[0].label,'Valider les blocs');
});
test('hidden and face-down identities never supply a name, statistics or artwork',()=>{
  const obs=observation();obs.players[0].battlefield=[card('hidden','Secret human card',{hidden:true}),card('down','Secret face',{faceDown:true})];
  (obs.players[1] as unknown as {hand:AgentCardObservation[]}).hand=[card('private','Secret opponent hand')];
  const ids=combatIdentities(obs);
  assert.equal(ids.has('private'),false);assert.equal(ids.get('hidden')!.label,'Carte non identifiée');assert.equal(ids.get('down')!.label,'Carte face cachée');
  for(const ref of ['hidden','down']) {assert.equal(ids.get(ref)!.artName,null);assert.equal(ids.get(ref)!.stats,null);}
  assert.equal(JSON.stringify([...ids.values()]).includes('Secret'),false);
});
test('combat metadata supports a planeswalker defender without replacing it by a player',()=>{
  const obs=observation();obs.players[1].battlefield.push(card('walker','Public planeswalker',{typeLine:'Planeswalker',power:null,toughness:null}));
  const model=combatDecisionModel(pending([option('attack-walker','g1','walker')]),obs)!;
  assert.equal(model.groups[0].options[0].destination.ref,'walker');assert.equal(model.groups[0].options[0].destination.label,'Public planeswalker');
});
test('older metadata keeps the generic surface; unavailable assignments or attackers are not fabricated',()=>{
  assert.equal(combatDecisionModel(pending([{label:'old Finish',choice:{decisionId:'d',kind:'object',choice:'legacy',reason:'human_choice'}}]),observation()),null);
  const model=combatDecisionModel(pending([option('finish',null,null,'finish')],{combatPairings:null,selectedCardRefs:null,type:'blockers_selection'}),observation())!;
  assert.equal(model.assignments,null);assert.equal(model.attackers,null);assert.equal(model.finishes[0].label,'Valider les blocs');
});
test('wrong decision identifiers, unsupported operations and incomplete edits use the generic fallback',()=>{
  const bad=option('old','g1','ai1');bad.choice.decisionId='previous';
  assert.equal(combatDecisionModel(pending([bad]),observation()),null);
  const order=option('order','g1','ai1');order.combat!.operation='order';assert.equal(combatDecisionModel(pending([order]),observation()),null);
  assert.equal(combatDecisionModel(pending([option('missing','g1',null)]),observation()),null);
  assert.equal(combatDecisionModel(pending([]),observation()),null);
});
test('other decision types, absent observations and unknown references never invent actions or identities',()=>{
  const items=[option('known','missing','unknown-defender')];const data=pending(items);const before=JSON.stringify(data);
  const model=combatDecisionModel(data,observation())!;assert.equal(model.groups[0].card.label,'Objet non identifié');
  assert.equal(model.groups[0].options[0].destination.artName,null);assert.equal(model.groups[0].options[0].item,items[0]);
  assert.equal(combatDecisionModel({...data,type:'combat_order_selection'},observation()),null);
  assert.equal(combatDecisionModel(data,null),null);assert.equal(combatDecisionModel(null,observation()),null);assert.equal(JSON.stringify(data),before);
});
