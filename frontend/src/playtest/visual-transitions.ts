import {presentationTiming,type PresentationTiming} from './presentation-preferences';
import type { AgentObservation } from './types.js';

export interface CardLocation { playerId: string; zone: string; tapped: boolean | null }
/** Only observer-visible zones. Unknown arrivals remain arrivals, never guessed draws. */
export function cardLocations(observation: AgentObservation): Map<string, CardLocation> {
  const locations = new Map<string, CardLocation>();
  for (const player of observation.players) {
    for (const zone of ['battlefield', 'graveyard', 'exile', 'command', ...(player.role === 'self' ? ['hand'] as const : [])] as const) {
      const cards = zone === 'hand' ? (player.role === 'self' ? player.hand : []) : player[zone];
      for (const card of cards) locations.set(card.cardRef, { playerId: player.playerId, zone, tapped: card.tapped });
    }
  }
  for (const item of observation.stack) if (item.sourceCardRef) locations.set(item.sourceCardRef, { playerId: item.controllerId ?? '', zone: 'stack', tapped: false });
  return locations;
}
export function diffLocations(previous: AgentObservation, current: AgentObservation) {
  if (previous.gameRef !== current.gameRef) return [];
  const before = cardLocations(previous);
  return [...cardLocations(current)].flatMap(([cardRef, to]) => {
    const from = before.get(cardRef);
    return from && (from.zone !== to.zone || from.playerId !== to.playerId || from.tapped !== to.tapped) ? [{ cardRef, from, to }] : [];
  });
}

/** Public seat changes only; same-state polls and a new game produce no effects. */
export function seatEffects(previous: AgentObservation | null, current: AgentObservation) {
  if (!previous || previous.gameRef !== current.gameRef) return [];
  return current.players.flatMap(player => {
    const before = previous.players.find(candidate => candidate.playerId === player.playerId);
    if (!before) return [];
    const lifeDelta = player.life - before.life;
    const activated = current.game.activePlayerId === player.playerId && previous.game.activePlayerId !== player.playerId;
    return lifeDelta || activated ? [{playerId: player.playerId, lifeDelta, activated}] : [];
  });
}

/** FLIP-style motion around authoritative paints. No timers, engine waits, or rule mutations.
 * Seat/zone anchors are player-ID based so the transition model is independent of seating. */
export class VisualTransitions {
  private readonly options: {timing?:()=>PresentationTiming;reducedMotion?:()=>boolean};
  constructor(options: {timing?:()=>PresentationTiming;reducedMotion?:()=>boolean} = {}) {this.options=options;}
  private previous: AgentObservation | null = null;
  private animations = new Set<Animation>();
  cancelAnimations(): void {for (const animation of this.animations) animation.cancel();this.animations.clear();}
  reset(): void {this.previous=null;this.cancelAnimations();}
  private play(node: HTMLElement, keyframes: Keyframe[], duration: number): void {
    const animation = node.animate(keyframes, {duration, easing:'cubic-bezier(.2,.7,.2,1)'});
    this.animations.add(animation);
    void animation.finished.catch(() => {}).finally(() => this.animations.delete(animation));
  }
  /** Reflow immediately; motion never delays focus or blocks clicks. */
  relayout(root: HTMLElement, render: () => void): void {
    this.cancelAnimations();
    const boards = [...root.querySelectorAll<HTMLElement>('.table-battlefield-half')];
    const before = new Map(boards.map(node => [node, node.getBoundingClientRect()]));
    render();
    if (root.dataset.look !== 'strategy' || this.options.reducedMotion?.() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const node of boards) {
      const from = before.get(node)!, to = node.getBoundingClientRect();
      if (!from.width || !to.width) continue;
      this.play(node, [{translate:`${from.left-to.left}px ${from.top-to.top}px`,opacity:.65},{translate:'0 0',opacity:1}], Math.min(260,(this.options.timing?.() ?? presentationTiming()).movement));
    }
  }
  paint(root: HTMLElement, observation: AgentObservation, render: () => void): void {
    const before = new Map<string, { rect: DOMRect; node: HTMLElement }>();
    for (const node of root.querySelectorAll<HTMLElement>('.table-battlefield [data-card-ref], .table-hand [data-card-ref], .physical-scene [data-card-ref], .table-stack [data-card-ref]')) {
      if (node.getBoundingClientRect().width > 0 && !before.has(node.dataset.cardRef!)) before.set(node.dataset.cardRef!, { rect: node.getBoundingClientRect(), node });
    }
    const anchors = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-zone]'), node => [node.dataset.zone === 'stack' ? 'stack' : `${node.dataset.playerId}:${node.dataset.zone}`, node.getBoundingClientRect()]));
    const changes = this.previous ? diffLocations(this.previous, observation) : [];
    const effects = seatEffects(this.previous, observation);
    render();
    const hadPrevious = this.previous?.gameRef === observation.gameRef;
    this.previous = observation;
    if (this.options.reducedMotion?.() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (root.dataset.look === 'strategy') for (const effect of effects) {
      const board = [...root.querySelectorAll<HTMLElement>('.table-battlefield-half,.physical-board')].find(node => node.dataset.playerId === effect.playerId);
      if (!board) continue;
      if (effect.activated) this.play(board, [
        {boxShadow:'inset 0 0 0 2px #78d9df, inset 0 0 70px #63c9d62b'},
        {boxShadow:getComputedStyle(board).boxShadow},
      ], Math.min(650,(this.options.timing?.() ?? presentationTiming()).settle));
      const life = board.querySelector<HTMLElement>('.table-life,.physical-identity');
      if (effect.lifeDelta && life) this.play(life, [
        {scale:'1',boxShadow:'0 0 0 0 transparent'},
        {scale:'1.08',boxShadow:`0 0 20px ${effect.lifeDelta > 0 ? '#7ee6a2' : '#f08478'}`},
        {scale:'1',boxShadow:getComputedStyle(life).boxShadow},
      ], Math.min(520,(this.options.timing?.() ?? presentationTiming()).settle));
    }
    const after = new Map(Array.from(root.querySelectorAll<HTMLElement>('.table-battlefield [data-card-ref], .table-hand [data-card-ref], .physical-scene [data-card-ref], .table-stack [data-card-ref]'), node => [node.dataset.cardRef!, node]));
    if (hadPrevious) for (const [ref, node] of after) {
      if (before.has(ref) || changes.some(change => change.cardRef === ref)) continue;
      const animation = node.animate([{ opacity: .3, translate: '0 16px' }, { opacity: 1, translate: '0 0' }], { duration: (this.options.timing?.() ?? presentationTiming()).arrival, easing: 'ease-out' });
      this.animations.add(animation);
      void animation.finished.catch(() => {}).finally(() => this.animations.delete(animation));
    }
    for (const change of changes) {
      const old = before.get(change.cardRef);
      const target = after.get(change.cardRef);
      const pile = Array.from(root.querySelectorAll<HTMLElement>('[data-zone]')).find(node => node.dataset.zone === change.to.zone && (change.to.zone === 'stack' || node.dataset.playerId === change.to.playerId));
      const origin = old?.rect ?? anchors.get(change.from.zone === 'stack' ? 'stack' : `${change.from.playerId}:${change.from.zone}`);
      if (!origin?.width || !(target || pile)) continue;
      if (change.from.zone === change.to.zone && change.from.playerId === change.to.playerId) continue; // native tap rotation
      const destination = (target?.getBoundingClientRect().width ? target : pile ?? target)!.getBoundingClientRect();
      if (!destination.width) continue;
      const ghost = old ? old.node.cloneNode(true) as HTMLElement : document.createElement('div');
      if (!old) { ghost.textContent = '◇'; ghost.style.background = '#24362c'; ghost.style.color = '#c7ae79'; }
      ghost.removeAttribute('data-card-ref'); ghost.removeAttribute('id'); ghost.setAttribute('aria-hidden', 'true');
      ghost.className = 'table-transition-ghost';
      Object.assign(ghost.style, { left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px` });
      document.body.append(ghost);
      const animation = ghost.animate([
        { transform: 'translate(0,0) scale(1)', opacity: .9 },
        { transform: `translate(${destination.left - origin.left}px,${destination.top - origin.top}px) scale(${destination.width / origin.width})`, opacity: 0 },
      ], { duration: (this.options.timing?.() ?? presentationTiming()).movement, easing: 'cubic-bezier(.2,.7,.2,1)' });
      this.animations.add(animation);
      void animation.finished.catch(() => {}).finally(() => { ghost.remove(); this.animations.delete(animation); });
    }
  }
}
