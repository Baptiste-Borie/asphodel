import { renderPlayerSeat, seatName } from './player-seat.js';
import { renderHiddenHand, renderPublicZones } from './table-scene.js';
import { physicalLayout } from './physical-layout.js';
import { renderBattlefieldHalf, renderCommanderDock, renderLandZone, renderHand, type BoardCallbacks } from './board-renderer.js';
import type { AgentObservation, AgentCardObservation, MenuItem } from './types.js';

function area(className: string) { const node = document.createElement('div'); node.className = className; return node; }
function createBoard() {
  const element = document.createElement('section'); element.className = 'physical-board';
  const focus = document.createElement('button'); focus.type = 'button'; focus.className = 'physical-board-focus';
  const identity = document.createElement('button'); identity.type = 'button'; identity.className = 'physical-identity';
  const command = area('table-commander-dock');
  const permanents = area('table-battlefield-cards');
  const lands = area('table-land-zone');
  const zones = area('table-public-zones');
  const hand = area('physical-hand');
  const header = document.createElement('header'); header.className = 'physical-board-header';
  header.append(identity, hand, focus);
  const zoneBand = area('physical-board-zones'); zoneBand.append(command, zones);
  element.append(header, permanents, lands, zoneBand);
  return { element, focus, identity, command, permanents, lands, zones, hand, previousLife: null as number | null };
}

/** Physical composition only. All boards remain mounted and live when focus changes. */
export function createPhysicalScene(inspect: (title: string, cards: AgentCardObservation[]) => void) {
  const element = area('physical-scene');
  const overview = document.createElement('button'); overview.type = 'button'; overview.className = 'physical-overview'; overview.textContent = 'Table view'; overview.setAttribute('aria-label','Overview'); overview.hidden = true;
  const boards = new Map<string, ReturnType<typeof createBoard>>();
  let focused: string | null = null;
  let current: AgentObservation | null = null;
  const layout = () => {
    if (!current) return;
    const seats = physicalLayout(current, focused);
    if (!current.players.some(p => p.playerId === focused)) focused = null;
    element.dataset.count = String(seats.length); element.dataset.focused = String(focused !== null);
    overview.hidden = focused === null;
    for (const seat of seats) {
      const board = boards.get(seat.playerId)!;
      board.element.dataset.density = seat.density;
      board.focus.setAttribute('aria-pressed', String(focused === seat.playerId));
      board.focus.textContent = focused === seat.playerId ? 'Focused' : 'Inspect';
    }
  };
  overview.onclick = () => { focused = null; layout(); };
  return { element, overview,
    render(observation: AgentObservation, callbacks: BoardCallbacks, expand: boolean, targets: MenuItem[] = [], choose?: (items: MenuItem[], anchor: HTMLElement) => void) {
      current = observation;
      callbacks = { ...callbacks, battlefieldStyle: "condensed" };
      for (const [id, board] of boards) if (!observation.players.some(p => p.playerId === id)) { board.element.remove(); boards.delete(id); }
      for (const player of observation.players) {
        let board = boards.get(player.playerId);
        if (!board) {
          board = createBoard(); boards.set(player.playerId, board); element.append(board.element);
          board.focus.onclick = () => { focused = player.playerId; layout(); };
          board.element.onclick = event => {
            if ((event.target as HTMLElement).closest('button, a, input, summary, .table-card')) return;
            focused = player.playerId; layout();
          };
        }
        board.element.dataset.playerId = player.playerId;
        board.element.dataset.active = String(player.playerId === observation.game.activePlayerId);
        board.element.dataset.priority = String(player.playerId === observation.game.priorityPlayerId);
        board.focus.setAttribute("aria-label", `Focus ${seatName(player, observation)}`);
        board.element.dataset.role = player.role;
        renderPlayerSeat(board.identity, player, observation, board.previousLife);
        board.previousLife = player.life;
        const playerTargets = targets.filter(item => item.playerId === player.playerId);
        board.identity.classList.toggle('physical-identity--target', playerTargets.length > 0);
        board.identity.setAttribute('aria-label', playerTargets.length ? `Target ${player.name}` : `${player.name}, ${player.life} life`);
        board.identity.onclick = () => { if (playerTargets.length) choose?.(playerTargets, board!.identity); else { focused = player.playerId; layout(); } };
        renderPublicZones(board.zones, player, callbacks.getPresentation, inspect);
        if (player.role === 'self') renderHand(board.hand, player.hand, callbacks.getPresentation, {
          isPlayable: () => false,
          onActivate: callbacks.onCardActivate,
        });
        else renderHiddenHand(board.hand, player.handSize);
        board.hand.setAttribute('aria-label', `${player.name}: hand, ${player.handSize} cards`);
        renderCommanderDock(board.command, player, callbacks, expand);
        board.command.dataset.multiple = String(board.command.childElementCount > 1);
        board.command.dataset.zone = 'command'; board.command.dataset.playerId = player.playerId;
        board.hand.dataset.zone = 'hand'; board.hand.dataset.playerId = player.playerId;
        // Commander tax badge (V2h): now rendered directly by renderCommanderDock itself — see
        // commander-tax.ts — so both Physical and Digital boards share the exact same presentation.
        renderBattlefieldHalf(board.permanents, player, callbacks, expand);
        renderLandZone(board.lands, player, callbacks, expand);
      }
      layout();
    },
  };
}
