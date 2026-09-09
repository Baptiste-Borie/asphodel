import { physicalLayout } from './physical-layout.js';
import { renderBattlefieldHalf, renderCommanderDock, renderLandZone, type BoardCallbacks } from './board-renderer.js';
import type { AgentObservation } from './types.js';

function area(className: string) { const node = document.createElement('div'); node.className = className; return node; }
function createBoard() {
  const element = document.createElement('section'); element.className = 'physical-board';
  const focus = document.createElement('button'); focus.type = 'button'; focus.className = 'physical-board-focus';
  const identity = area('physical-identity');
  const command = area('table-commander-dock');
  const permanents = area('table-battlefield-cards');
  const lands = area('table-land-zone');
  const zones = area('table-public-zones');
  const hand = area('physical-hand');
  element.append(identity, focus, command, permanents, lands, zones, hand);
  return { element, focus, identity, command, permanents, lands, zones, hand };
}

/** Physical composition only. All boards remain mounted and live when focus changes. */
export function createPhysicalScene() {
  const element = area('physical-scene');
  const overview = document.createElement('button'); overview.type = 'button'; overview.className = 'physical-overview'; overview.textContent = 'Overview'; overview.hidden = true;
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
    }
  };
  overview.onclick = () => { focused = null; layout(); };
  return { element, overview,
    render(observation: AgentObservation, callbacks: BoardCallbacks, expand: boolean) {
      current = observation;
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
        board.focus.textContent = `Focus ${player.name}`;
        board.identity.textContent = `${player.name} · ${player.life} life`;
        renderCommanderDock(board.command, player, callbacks, expand);
        renderBattlefieldHalf(board.permanents, player, callbacks, expand);
        renderLandZone(board.lands, player, callbacks, expand);
      }
      layout();
    },
  };
}
