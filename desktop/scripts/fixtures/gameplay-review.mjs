import {combatFixture} from './combat-flow.mjs';
import {targetFixture} from './target-flow.mjs';
import {populatedTableFixture} from './populated-table.mjs';

/** Public, illustrated stress DTOs. Exact fixture choices exercise UI transport,
 * not Forge rules or the legality of the displayed synthetic board. */
export async function gameplayReviewFixture(mode,kind) {
  const table=await populatedTableFixture(mode,mode==='digital'?4:2);
  if(kind==='crowded') {
    const state=table.states[0];
    for(const player of state.observation.players) {
      const originals=player.battlefield.filter(card=>!card.typeLine?.includes('Land'));
      const lands=player.battlefield.filter(card=>card.typeLine?.includes('Land'));
      player.battlefield=Array.from({length:24},(_,i)=>({...structuredClone(originals[i%originals.length]),cardRef:`${player.playerId}-stress-${i}`,tapped:i%4===0,counters:{'+1/+1':i%3}}));
      player.battlefield.push(...Array.from({length:18},(_,i)=>({...structuredClone(lands[i%lands.length]),cardRef:`${player.playerId}-stress-land-${i}`,tapped:i%2===0})));
      // Identical public tokens deliberately exercise the existing stack renderer.
      player.battlefield.push(...Array.from({length:16},(_,i)=>({...structuredClone(originals[0]),cardRef:`${player.playerId}-stress-token-${i}`,token:true,tapped:false,counters:{}})));
      player.battlefieldSize=player.battlefield.length;player.handSize=18;
      if(player.role==='self')player.hand=Array.from({length:18},(_,i)=>({...structuredClone(player.hand[i%player.hand.length]),cardRef:`${player.playerId}-stress-hand-${i}`}));
    }
    return table;
  }
  const result=kind==='combat'?combatFixture(mode):targetFixture(mode);
  result.presentations=table.presentations;
  const names=['Kami of Whispered Hopes','Rishkar, Peema Renegade','Renata, Called to the Hunt','Evolution Sage'];
  for(const state of result.states) {
    const original=state.observation.players;
    state.asphodelDeckNames=table.states[0].asphodelDeckNames;
    state.observation.players=structuredClone(table.states[0].observation.players);
    for(const player of state.observation.players) {
      const source=original.find(p=>p.playerId===player.playerId);if(!source)continue;
      player.battlefield.push(...source.battlefield.map((card,i)=>({...card,name:names[i%names.length]})));
      player.battlefieldSize=player.battlefield.length;
      if(kind==='targets'&&player.role==='self') {
        player.graveyard=source.graveyard.map((card,i)=>({...card,name:i===0?'Cultivate':'Inspiring Call'}));
        player.graveyardSize=player.graveyard.length;
      }
    }
    if(kind==='targets') {
      const prompt=state.pendingDecision.rendered;
      if(prompt.kind==='menu')for(const item of prompt.items) {
        if(item.target?.concealed)continue;
        if(item.cardRef==='grave1')item.target.name='Cultivate';
        if(item.cardRef==='grave2')item.target.name='Inspiring Call';
        if(item.cardRef?.startsWith('extra'))item.target.name=names[Number(item.cardRef.slice(5))%names.length];
      }
    }
  }
  return result;
}
