import {readFile} from 'node:fs/promises';
import {combatFixture} from './combat-flow.mjs';

// A populated presentation fixture, not a simulated/legal Forge match.
// Uses the existing bundled public card catalog and its actual illustrations.
export async function populatedTableFixture(mode='physical') {
  const cards=JSON.parse(await readFile(new URL('../../../frontend/src/deck-lab/cards.json',import.meta.url),'utf8'));
  const find=name=>{const card=cards.find(card=>card.name===name);if(!card)throw new Error(`Missing public fixture card: ${name}`);return card;};
  const observationCard=(name,ref,playerId,zone='battlefield',tapped=false)=>{
    const card=find(name);
    return {cardRef:ref,name,zone,ownerId:playerId,controllerId:playerId,faceDown:false,hidden:false,tapped,summoningSick:false,counters:{},
      power:card.power===null?null:Number(card.power)||0,toughness:card.toughness===null?null:Number(card.toughness)||0,typeLine:card.type_line};
  };
  const fixture=combatFixture(mode),state=fixture.states[0];
  fixture.states=[state];fixture.transition=[];
  state.observation.game.phase='main1';
  state.pendingDecision={decisionId:'populated-priority',type:'priority_action',context:{...state.observation.game,stackSize:0},selectedCardRefs:null,combatPairings:null,
    rendered:{kind:'menu',title:'Choisir une action',items:[{label:'Passer la priorité',control:'pass',cardRef:null,choice:{decisionId:'populated-priority',kind:'action',choice:'pass',reason:'human_choice'}}]}};
  state.humanDeckName='Kodama — aperçu de table';state.asphodelDeckNames=state.observation.players.slice(1).map(()=> 'Kodama — aperçu adverse');
  for(const [index,player] of state.observation.players.entries()) {
    const id=player.playerId;
    const names=['Kami of Whispered Hopes','Rishkar, Peema Renegade','Forgotten Ancient','Renata, Called to the Hunt','Evolution Sage','Sol Ring','Hardened Scales'];
    player.battlefield=names.slice(0,index===0?4:7).map((name,i)=>observationCard(name,`${id}-permanent-${i}`,id,'battlefield',i===1));
    player.battlefield.push(...Array.from({length:6},(_,i)=>observationCard(i===0?'Boseiju, Who Endures':'Forest',`${id}-land-${i}`,id,'battlefield',i<3)));
    player.battlefieldSize=player.battlefield.length;
    player.command=[observationCard('Kodama of the West Tree',`${id}-commander`,id,'command')];player.commandZoneSize=1;
    player.graveyard=['Cultivate','Inspiring Call'].map((name,i)=>observationCard(name,`${id}-grave-${i}`,id,'graveyard'));player.graveyardSize=2;
    player.exile=[observationCard('Gyre Sage',`${id}-exile`,id,'exile')];player.exileSize=1;
    player.handSize=7;
    if(player.role==='self')player.hand=['Forest','Forest','Elvish Mystic','Arcane Signet','Beast Whisperer','Guardian Project',"Kodama's Reach"].map((name,i)=>observationCard(name,`${id}-hand-${i}`,id,'hand'));
  }
  fixture.presentations=Object.fromEntries(cards.map(card=>[card.name,{name:card.name,manaCost:card.mana_cost,manaValue:card.cmc,typeLine:card.type_line,oracleText:card.oracle_text,imageUri:card.image}]));
  return fixture;
}
