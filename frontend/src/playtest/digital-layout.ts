import type { AgentObservation, AgentPlayerObservation } from './types.js';

/**
 * Milestone 2 "VIEWPORT LIST, NOT FIXED SLOTS": every player currently known, in a stable reading
 * order (other players first, the human self last — matching today's top/bottom viewport
 * convention), never a fixed-length array with holes for a seat that isn't known yet. A future
 * N-player Digital layout only ever grows what this returns; every renderer downstream (see
 * digital-board-slot.ts) already only cares about "the player for this viewport", not about who
 * that player is or how many others exist.
 */
export function digitalPlayerOrder(observation: AgentObservation): AgentPlayerObservation[] {
  const self = observation.players.find(player => player.playerId === observation.selfPlayerId);
  const others = observation.players.filter(player => player.playerId !== observation.selfPlayerId);
  return self ? [...others, self] : [...others];
}

/**
 * The Digital Scene's own view state — which player (if any) currently fills most of the screen.
 * Keyed by `playerId`, never a slot index, so it never encodes an assumption of exactly two visual
 * regions (see playtest-view.ts's `applyDigitalFocus`).
 */
export type DigitalView = { mode: 'overview' } | { mode: 'focus'; playerId: string };
