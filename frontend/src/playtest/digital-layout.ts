import type { AgentObservation, AgentPlayerObservation } from './types.js';

/**
 * Milestone 1: exactly two board slots ([far/mirrored seat, near seat] — matching the existing
 * "asphodel"/"human" visual positions), populated from whichever players the current observation
 * reports. This is the ONE deliberate 2-seat assumption left in the Digital Scene's rendering path
 * — every renderer downstream (see digital-board-slot.ts) already only cares about "the player for
 * this slot", not about who that player is. Milestone 2 (N players) replaces this function alone,
 * the same way physical-layout.ts's `physicalLayout` already does for the Physical Scene.
 */
export function orderDigitalSeats(observation: AgentObservation): (AgentPlayerObservation | undefined)[] {
  const self = observation.players.find(player => player.playerId === observation.selfPlayerId);
  const others = observation.players.filter(player => player.playerId !== observation.selfPlayerId);
  return [others[0], self];
}
