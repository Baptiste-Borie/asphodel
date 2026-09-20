import { renderPublicZones } from './table-scene.js';
import { renderBattlefieldHalf, renderCommanderDock, renderLandZone, type BoardCallbacks } from './board-renderer.js';
import { seatName } from './player-seat.js';
import type { AgentObservation, AgentPlayerObservation, AgentCardObservation, CardPresentation } from './types.js';

function area(className: string): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

export interface DigitalBoardSlot {
  half: HTMLElement;
  life: HTMLElement;
  commanderDock: HTMLElement;
  battlefieldCards: HTMLElement;
  landZone: HTMLElement;
  publicZones: HTMLElement;
  focusToggle: HTMLButtonElement;
}

/**
 * Temporary per-seat playmat art (frontend/src/assets/environments) so the two boards read as
 * genuinely separate viewports rather than one shared table cut in half — placeholder assignment
 * only, swapped for real per-deck/player art later; see styles/table-scene.css's `[data-playmat]`.
 */
const PLAYMAT_BY_POSITION: Readonly<Record<'asphodel' | 'human', string>> = {
  asphodel: 'courtyard-slate',
  human: 'turquoise-ruins',
};

/** Pure. Which playmat asset a given seat position renders behind its own board — see PLAYMAT_BY_POSITION. */
export function digitalPlaymatAsset(positionClass: 'asphodel' | 'human'): string {
  return PLAYMAT_BY_POSITION[positionClass];
}

/**
 * One player's visual area on the Obsidian Table (playmat + battlefield + commander dock + land
 * zone + public piles) — everything a `table-battlefield-half` owns besides the hand, which stays
 * playtest-view.ts's responsibility since a human's real hand and an opponent's hidden fan are
 * genuinely different surfaces, not just different players (see paintBoard). `positionClass` is
 * purely today's fixed visual position ("asphodel" = far/mirrored seat, "human" = near seat) — a
 * future N-player layout replaces only `digital-layout.ts`'s seat assignment, never this function.
 */
export function createDigitalBoardSlot(positionClass: 'asphodel' | 'human', extraClassName = ''): DigitalBoardSlot {
  const half = document.createElement('div');
  half.className = `table-battlefield-half table-battlefield-half--${positionClass}${extraClassName}`;
  half.dataset.playmat = digitalPlaymatAsset(positionClass);
  const life = document.createElement('div');
  life.className = `table-life table-life--${positionClass}`;
  const commanderDock = area('table-commander-dock');
  const battlefieldCards = area('table-battlefield-cards');
  const landZone = area('table-land-zone');
  const publicZones = area('table-public-zones');
  const focusToggle = document.createElement('button');
  focusToggle.type = 'button';
  focusToggle.className = 'table-focus-toggle';
  focusToggle.setAttribute('aria-pressed', 'false');
  focusToggle.textContent = 'Focus';
  half.append(life, commanderDock, battlefieldCards, landZone, publicZones, focusToggle);
  return { half, life, commanderDock, battlefieldCards, landZone, publicZones, focusToggle };
}

/** Pure. The label shown on a player's life plaque — reuses Physical Scene's own naming so both scenes agree on what to call a seat, generalizing past the hardcoded "ASPHODEL"/"YOU" strings without changing today's 2-player output (`seatName` already returns exactly "Asphodel"/"You" for a 1v1). */
export function digitalSeatLabel(player: AgentPlayerObservation, observation: AgentObservation): string {
  return seatName(player, observation).toUpperCase();
}

/**
 * Paints one player's board slot — the Digital-mode counterpart of physical-scene.ts's per-player
 * render loop body, reusing the exact same generic renderers so a card's placement/grouping/
 * tapped-state/transition behaviour is identical between the two scenes. Life and public-zone
 * inspection stay the caller's params rather than closure state, so this stays a pure DOM-diffing
 * function with no knowledge of polling/frame-playback/card-presentation caching.
 */
export function renderDigitalBoardSlot(
  slot: DigitalBoardSlot,
  player: AgentPlayerObservation,
  observation: AgentObservation,
  callbacks: BoardCallbacks,
  expand: boolean,
  get: (name: string) => CardPresentation | null | undefined,
  inspect: (title: string, cards: AgentCardObservation[], location?: { playerId: string; zone: 'graveyard' | 'exile' }) => void,
): void {
  slot.half.dataset.playerId = player.playerId;
  slot.half.classList.toggle('table-battlefield-half--active', player.playerId === observation.game.activePlayerId);
  renderPublicZones(slot.publicZones, player, get, inspect);
  renderCommanderDock(slot.commanderDock, player, callbacks, expand);
  renderBattlefieldHalf(slot.battlefieldCards, player, callbacks, expand);
  renderLandZone(slot.landZone, player, callbacks, expand);
}
