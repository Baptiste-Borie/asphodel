import type { AgentObservation } from './types.js';

export type BoardDensity = 'primary' | 'normal' | 'preview';
/** Viewing state is independent of turn, priority and decisions. */
export function physicalLayout(observation: AgentObservation, focus: string | null) {
  const focused = observation.players.some(player => player.playerId === focus) ? focus : null;
  return observation.players.map(player => ({
    playerId: player.playerId,
    density: (focused ? (player.playerId === focused ? 'primary' : 'preview')
      : observation.players.length >= 4 ? 'normal'
      : player.playerId === observation.selfPlayerId ? 'preview'
      : observation.players.length === 2 ? 'primary' : 'normal') as BoardDensity,
  }));
}
