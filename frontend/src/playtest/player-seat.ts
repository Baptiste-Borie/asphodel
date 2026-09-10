import type { AgentObservation, AgentPlayerObservation } from './types.js';

export function seatName(player: AgentPlayerObservation, observation: AgentObservation): string {
  if (!/^External Player \d+$/.test(player.name)) return player.name;
  if (player.role === 'self') return 'You';
  const opponents = observation.players.filter(p => p.role !== 'self');
  return opponents.length === 1 ? 'Asphodel' : `Asphodel ${opponents.findIndex(p => p.playerId === player.playerId) + 1}`;
}

/** Identity and life belong to the player. No commander image and no derived resources. */
export function renderPlayerSeat(container: HTMLElement, player: AgentPlayerObservation, observation: AgentObservation, previousLife: number | null): void {
  const life = document.createElement('strong'); life.className = 'physical-life'; life.textContent = String(player.life); life.setAttribute('aria-label', `${player.life} life`);
  const plaque = document.createElement('span'); plaque.className = 'physical-seat-plaque';
  const name = document.createElement('span'); name.className = 'physical-player-name'; name.textContent = seatName(player, observation);
  const state = document.createElement('small'); state.className = 'physical-seat-state';
  state.textContent = player.playerId === observation.game.activePlayerId ? 'Active turn' : player.role === 'self' ? 'Your physical table' : 'Opponent';
  plaque.append(name, state);
  container.replaceChildren(life, plaque);
  if (player.playerId === observation.game.priorityPlayerId) {
    const priority = document.createElement('span'); priority.className = 'physical-priority-marker'; priority.title = 'Has priority'; priority.setAttribute('aria-label','Has priority'); container.append(priority);
  }
  if (previousLife !== null && previousLife !== player.life) {
    const delta = document.createElement('small'); delta.className = 'physical-life-delta';
    const amount = player.life - previousLife; delta.textContent = `${amount > 0 ? '+' : ''}${amount}`; container.append(delta);
  }
}
