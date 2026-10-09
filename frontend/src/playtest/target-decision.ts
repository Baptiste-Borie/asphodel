import {combatIdentities} from './combat-decision';
import {seatName} from './player-seat';
import type {AgentObservation, MenuItem, WebPendingDecisionDTO} from './types';

export interface TargetOption {
  item: MenuItem;
  label: string;
  detail: string;
  group: string;
  artName: string | null;
  stats: string | null;
}
export interface TargetDecisionModel {
  decisionId: string;
  title: string;
  sourceName: string | null;
  abilityText: string | null;
  progress: string;
  options: TargetOption[];
  finishes: {item: MenuItem; label: string}[];
}
const zones: Record<string,string> = {battlefield:'Champ de bataille',graveyard:'Cimetière',exile:'Exil',command:'Commandement',hand:'Main',library:'Bibliothèque',stack:'Pile'};

/** Presentation only: never filters engine legality or invents an option from a card's rules. */
export function targetDecisionModel(pending: WebPendingDecisionDTO | null, observation: AgentObservation | null): TargetDecisionModel | null {
  if (!pending || !observation || pending.type !== 'target_selection' || pending.rendered.kind !== 'menu') return null;
  const {items, targeting} = pending.rendered;
  if (!targeting || !items.length || ![targeting.minTargets,targeting.maxTargets,targeting.selectedCount].every(n=>Number.isSafeInteger(n)&&n>=0)
      || targeting.maxTargets < targeting.minTargets || targeting.selectedCount > targeting.maxTargets
      || items.some(item=>!item.target || item.choice.kind!=='target' || item.choice.decisionId!==pending.decisionId
        || !['card','player','spell','finish'].includes(item.target.kind)
        || (item.target.kind==='card'&&!item.cardRef) || (item.target.kind==='player'&&!item.playerId)
        || (item.target.kind==='spell'&&!item.target.stackRef))) return null;
  const identities = combatIdentities(observation);
  const playerLabel = (id: string | null) => {
    const player=observation.players.find(p=>p.playerId===id);
    return player ? player.role==='self' ? 'Toi' : seatName(player,observation) : 'Joueur non identifié';
  };
  const options: TargetOption[] = items.filter(item=>item.target!.kind!=='finish').map(item=>{
    const target=item.target!;
    if (target.kind==='player') return {item,label:identities.get(item.playerId!)?.label??playerLabel(item.playerId!),detail:'Joueur',group:'Joueurs',artName:null,stats:null};
    const card = item.cardRef ? observation.players.flatMap(player=>[
      ...player.battlefield,...player.graveyard,...player.exile,...player.command,...(player.role==='self'?player.hand:[]),
    ]).find(card=>card.cardRef===item.cardRef) : undefined;
    const stack = target.kind==='spell' ? observation.stack.find(entry=>entry.stackRef===target.stackRef) : undefined;
    const concealed=target.concealed || Boolean(card?.hidden||card?.faceDown||stack?.hidden||stack?.faceDown);
    // A source card identity does not replace the exact spell/ability instance on the stack.
    const name=concealed ? null : target.kind==='spell' ? (stack?.sourceCardName??target.name) : (card?.name??target.name);
    const owner=card ? observation.players.find(player=>[player.battlefield,player.graveyard,player.exile,player.command,
      ...(player.role==='self'?[player.hand]:[])].some(zone=>zone.some(c=>c.cardRef===card.cardRef))) : undefined;
    const zone=zones[target.zone??'']??'Autre zone';
    const location=target.kind==='spell' ? `Pile${stack ? ` · Position ${stack.position+1}` : ''} · ${playerLabel(target.controllerId)}`
      : target.zone==='battlefield' ? `${zone} · ${playerLabel(card?.controllerId??target.controllerId)}`
      : `${zone}${owner ? ` · ${playerLabel(owner.playerId)}` : ''}`;
    return {item,label:name??(concealed?'Objet face cachée ou non identifié':'Objet non identifié'),detail:location,group:target.kind==='spell'?'Sorts et capacités sur la pile':zone,
      artName:name,stats:!concealed&&typeof card?.power==='number'&&typeof card.toughness==='number'?`${card.power}/${card.toughness}`:null};
  });
  // Distinct legal choices keep distinct buttons, including same-name cards absent from the board.
  const counts=new Map<string,number>(),positions=new Map<string,number>();
  for (const option of options) if(option.item.target!.kind!=='player') counts.set(option.label,(counts.get(option.label)??0)+1);
  for (const option of options) if(option.item.target!.kind!=='player'&&(counts.get(option.label)??0)>1) {
    const ordinal=(positions.get(option.label)??0)+1;positions.set(option.label,ordinal);option.label+=` · ${ordinal}`;
  }
  const range=targeting.minTargets===targeting.maxTargets ? `${targeting.maxTargets}` : `${targeting.minTargets} à ${targeting.maxTargets}`;
  return {decisionId:pending.decisionId,title:pending.rendered.title,sourceName:targeting.sourceName,abilityText:targeting.abilityText,
    progress:`Cibles déjà choisies : ${targeting.selectedCount} · Nombre demandé : ${range}`,options,
    finishes:items.filter(item=>item.target!.kind==='finish').map(item=>({item,label:targeting.selectedCount===0?'Terminer sans choisir de cible':'Terminer le choix des cibles'}))};
}
