import {seatName} from './player-seat';
import type {AgentCardObservation, AgentObservation, MenuItem, WebPendingDecisionDTO} from './types';

export interface CombatIdentity {
  ref: string;
  label: string;
  stats: string | null;
  artName: string | null;
}
export interface CombatGroup {
  card: CombatIdentity;
  selected: boolean;
  options: {item: MenuItem; operation: 'add' | 'remove'; destination: CombatIdentity}[];
}
export interface CombatDecisionModel {
  decisionId: string;
  scope: string;
  type: 'attackers_selection' | 'blockers_selection';
  heading: string;
  groups: CombatGroup[];
  assignments: {card: CombatIdentity; destination: CombatIdentity}[] | null;
  attackers: {card: CombatIdentity; defender: CombatIdentity; ownBlocks: number | null; canAddBlock: boolean}[] | null;
  finishes: {item: MenuItem; label: string}[];
}

/** Use only observer-visible identities. Duplicate cards stay distinct even without artwork. */
export function combatIdentities(observation: AgentObservation): Map<string, CombatIdentity> {
  const identities = new Map<string, CombatIdentity>();
  const cards: AgentCardObservation[] = observation.players.flatMap(player => [
    ...player.battlefield, ...player.graveyard, ...player.exile, ...player.command,
    ...(player.role === 'self' ? player.hand : []),
  ]);
  const unique = [...new Map(cards.map(card => [card.cardRef, card])).values()];
  const cardName = (card: AgentCardObservation) => !card.hidden && !card.faceDown && card.name
    ? card.name : card.faceDown ? 'Carte face cachée' : 'Carte non identifiée';
  const counts = new Map<string, number>(), positions = new Map<string, number>();
  for (const card of unique) counts.set(cardName(card), (counts.get(cardName(card)) ?? 0) + 1);
  for (const card of unique) {
    const name = cardName(card), ordinal = (positions.get(name) ?? 0) + 1;
    positions.set(name, ordinal);
    const visible = !card.hidden && !card.faceDown && Boolean(card.name);
    identities.set(card.cardRef, {ref: card.cardRef, label: name + ((counts.get(name) ?? 0) > 1 ? ` · ${ordinal}` : ''),
      stats: visible && typeof card.power === 'number' && typeof card.toughness === 'number' ? `${card.power}/${card.toughness}` : null,
      artName: visible ? card.name : null});
  }
  for (const player of observation.players) {
    identities.set(player.playerId, {ref: player.playerId, label: `${player.role === 'self' ? 'Toi' : seatName(player, observation)} · ${player.life} PV`, stats: null, artName: null});
  }
  return identities;
}

/** No rule inference: selectable edits and Finish come exclusively from the current Forge menu. */
export function combatDecisionModel(pending: WebPendingDecisionDTO | null, observation: AgentObservation | null): CombatDecisionModel | null {
  if (!pending || !observation || pending.rendered.kind !== 'menu'
      || (pending.type !== 'attackers_selection' && pending.type !== 'blockers_selection')) return null;
  const items = pending.rendered.items;
  // An older backend or incomplete metadata keeps the existing generic decision surface usable.
  if (!items.length || items.some(item => !item.combat || item.choice.kind !== 'object'
      || item.choice.decisionId !== pending.decisionId || !['add','remove','finish'].includes(item.combat.operation)
      || (item.combat.operation !== 'finish' && (!item.cardRef || !item.combat.relatedRef)))) return null;
  const identities = combatIdentities(observation);
  const identity = (ref: string): CombatIdentity => identities.get(ref)
    ?? {ref, label: 'Objet non identifié', stats: null, artName: null};
  const selected = new Set(pending.selectedCardRefs ?? pending.combatPairings?.map(pair => pair.cardRef) ?? []);
  const groups = new Map<string, CombatGroup>();
  for (const item of items) {
    const metadata = item.combat!;
    if (metadata.operation === 'finish') continue;
    const ref = item.cardRef!;
    let group = groups.get(ref);
    if (!group) {group = {card: identity(ref), selected: selected.has(ref), options: []}; groups.set(ref, group);}
    group.options.push({item, operation: metadata.operation as 'add' | 'remove', destination: identity(metadata.relatedRef!)});
  }
  const assignments = pending.combatPairings?.map(pair => ({card: identity(pair.cardRef), destination: identity(pair.relatedRef)})) ?? null;
  const empty = assignments !== null && assignments.length === 0;
  const attack = pending.type === 'attackers_selection';
  return {
    decisionId: pending.decisionId, scope: `${observation.gameRef}:${pending.context.turn}:${pending.type}:${observation.selfPlayerId}`,
    type: pending.type, heading: attack ? 'Déclarer les attaquants' : 'Déclarer les bloqueurs', groups: [...groups.values()], assignments,
    attackers: !attack && pending.combatAttackers ? pending.combatAttackers.map(attacker => ({
      card: identity(attacker.cardRef), defender: identity(attacker.relatedRef),
      ownBlocks: pending.combatPairings?.filter(pair => pair.relatedRef === attacker.cardRef).length ?? null,
      canAddBlock: items.some(item => item.combat?.operation === 'add' && item.combat.relatedRef === attacker.cardRef),
    })) : null,
    finishes: items.filter(item => item.combat?.operation === 'finish').map(item => ({item,
      label: empty ? (attack ? 'N’attaquer avec aucune créature' : 'Ne bloquer avec aucune créature')
        : (attack ? 'Valider les attaques' : 'Valider les blocs')})),
  };
}
