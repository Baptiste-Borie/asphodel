import { newlyArrivedPermanents } from './reveal-detection.js';
import type { AgentCardObservation, AgentObservation } from './types.js';

/** Identity only comes from a visible stack item. Never parse a narrated name into a game object. */
export function newlyVisibleSpells(previous: AgentObservation | null, next: AgentObservation): AgentCardObservation[] {
  if (!previous || previous.gameRef !== next.gameRef) return [];
  const known = new Set(previous.stack.map(item => item.stackRef));
  return next.stack.filter(item => !known.has(item.stackRef) && !item.hidden && !item.faceDown && item.sourceCardName).map(item => ({
    cardRef: item.sourceCardRef ?? `stack:${item.stackRef}`, name: item.sourceCardName,
    zone: 'battlefield', ownerId: null, controllerId: item.controllerId,
    tapped: false, summoningSick: false, hidden: false, faceDown: false,
    counters: null, power: null, toughness: null, typeLine: null,
  }));
}

export function presentationBeats(previous: AgentObservation | null, next: AgentObservation) {
  const spells = newlyVisibleSpells(previous, next);
  const arrivals = newlyArrivedPermanents(previous, next);
  const priorStack = new Set(previous?.stack.filter(item => !item.hidden && !item.faceDown).map(item => item.sourceCardRef));
  return { spells, arrivals, unshownArrivals: arrivals.filter(card => !priorStack.has(card.cardRef)) };
}
