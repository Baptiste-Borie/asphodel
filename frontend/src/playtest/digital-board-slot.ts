import { renderHiddenHand, renderPublicZones } from './table-scene.js';
import { commandZoneCards, renderBattlefieldHalf, renderCommanderDock, renderHand, renderLandZone, type BoardCallbacks, type HandActionCallbacks } from './board-renderer.js';
import { partitionBattlefield } from './land-zone.js';
import { seatName } from './player-seat.js';
import type { AgentObservation, AgentPlayerObservation, AgentCardObservation, AgentSelfPlayerObservation, CardPresentation } from './types.js';

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
  hand: HTMLElement;
  commandName: HTMLElement;
  summary: HTMLButtonElement;
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
 * One player's ENTIRE visual area — playmat + life/identity + commander dock + battlefield + land
 * zone + public piles + hand (interactive for self, hidden-fan for an opponent; see
 * `renderDigitalBoardSlot`) — everything a real player owns on the Obsidian Table, with nothing
 * left as a global sibling. This is what makes a viewport self-contained: a future N-player layout
 * only ever creates more of these and lays them out differently — it never has to go find some
 * other global element (a shared hand band, a shared opponent-hand strip) that secretly belonged
 * to one specific player. The viewport itself is the click target for focusing this player (see
 * playtest-view.ts's `applyDigitalFocus`) — there is no separate Focus button. `positionClass` is
 * purely today's fixed visual position ("asphodel" = top seat, "human" = bottom seat) — a future
 * N-player layout replaces only `digital-layout.ts`'s ordering, never this function.
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
  const hand = area('table-viewport-hand');
  const labelled = (label: string, content: HTMLElement, className: string) => {
    const tray = area(className);
    const title = document.createElement('span'); title.className = 'table-zone-label'; title.textContent = label;
    tray.append(title, content);return tray;
  };
  const personalBand = area('table-personal-band');
  personalBand.append(labelled('Terrains',landZone,'table-land-tray'),labelled(positionClass === 'human' ? 'Ta main' : 'Main adverse',hand,'table-hand-tray'));
  const permanentsTray = labelled('Permanents',battlefieldCards,'table-permanents-tray');
  const commandTray = area('table-command-tray');
  const commandName = area('table-command-name');commandTray.append(commanderDock,commandName);
  const summary = document.createElement('button');
  summary.type = 'button'; summary.className = 'table-seat-summary';
  half.append(life, commandTray, permanentsTray, publicZones, personalBand, summary);
  return { half, life, commanderDock, battlefieldCards, landZone, publicZones, hand, commandName, summary };
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
 *
 * Milestone 3 "A VIEWPORT OWNS ITS HAND TOO": the self/opponent hand branch used to live in
 * playtest-view.ts's per-slot render loop, reaching into a global `handContainer`/`opponentHand`
 * pair — the last two elements a Digital player's own presentation didn't actually own. It's
 * decided here instead, from `player.role`, exactly like every other zone this function already
 * owns; the caller only ever supplies `handActions` (the self-hand's click wiring), never decides
 * WHICH render function to call. `renderHand`/`renderHiddenHand` themselves are unchanged — reused
 * exactly as Physical/opponent-hidden-hand already do, never duplicated.
 */
export function renderDigitalBoardSlot(
  slot: DigitalBoardSlot,
  player: AgentPlayerObservation,
  observation: AgentObservation,
  callbacks: BoardCallbacks,
  expand: boolean,
  get: (name: string) => CardPresentation | null | undefined,
  inspect: (title: string, cards: AgentCardObservation[], location?: { playerId: string; zone: 'graveyard' | 'exile' }) => void,
  handActions?: HandActionCallbacks,
): void {
  slot.half.dataset.playerId = player.playerId;
  slot.half.dataset.role = player.role;
  slot.commanderDock.setAttribute('aria-label', 'Zone de commandement');
  slot.battlefieldCards.setAttribute('aria-label', 'Permanents');
  slot.landZone.setAttribute('aria-label', 'Terrains');
  slot.hand.setAttribute('aria-label', player.role === 'self' ? 'Ta main' : 'Main adverse');
  slot.half.classList.toggle('table-battlefield-half--active', player.playerId === observation.game.activePlayerId);
  const { lands, nonLands } = partitionBattlefield(player.battlefield);
  slot.summary.textContent = `${nonLands.length} permanents · ${lands.length} terrains\n${player.handSize} cartes en main · Agrandir →`;
  slot.summary.setAttribute('aria-label', `Agrandir le plateau de ${seatName(player, observation)} — ${nonLands.length} permanents, ${lands.length} terrains, ${player.handSize} cartes en main`);
  renderPublicZones(slot.publicZones, player, get, inspect);
  renderCommanderDock(slot.commanderDock, player, callbacks, expand);
  slot.commandName.textContent = commandZoneCards(player).filter(card => !card.hidden && !card.faceDown && card.name).map(card => card.name).join(' · ');
  slot.commandName.title = slot.commandName.textContent;
  slot.commandName.hidden = !slot.commandName.textContent;
  renderBattlefieldHalf(slot.battlefieldCards, player, callbacks, expand);
  // Count rendered slots (including grouped tokens), not raw observations, for fit sizing.
  slot.half.style.setProperty('--strategy-slot-count', String(Math.max(1, slot.battlefieldCards.children.length)));
  renderLandZone(slot.landZone, player, callbacks, expand);
  if (player.role === 'self') renderHand(slot.hand, (player as AgentSelfPlayerObservation).hand, get, handActions);
  else renderHiddenHand(slot.hand, player.handSize);
}
