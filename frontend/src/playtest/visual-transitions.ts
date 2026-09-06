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

/** FLIP-style motion around authoritative paints. No timers, engine waits, or rule mutations.
 * Seat/zone anchors are player-ID based so the transition model is independent of seating. */
export class VisualTransitions {
  private previous: AgentObservation | null = null;
  private animations = new Set<Animation>();
  reset(): void { this.previous = null; for (const animation of this.animations) animation.cancel(); this.animations.clear(); }
  paint(root: HTMLElement, observation: AgentObservation, render: () => void): void {
    const before = new Map<string, { rect: DOMRect; node: HTMLElement }>();
    for (const node of root.querySelectorAll<HTMLElement>('.table-battlefield [data-card-ref], .table-hand [data-card-ref]')) {
      if (!before.has(node.dataset.cardRef!)) before.set(node.dataset.cardRef!, { rect: node.getBoundingClientRect(), node });
    }
    const changes = this.previous ? diffLocations(this.previous, observation) : [];
    render();
    const hadPrevious = this.previous?.gameRef === observation.gameRef;
    this.previous = observation;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const after = new Map(Array.from(root.querySelectorAll<HTMLElement>('.table-battlefield [data-card-ref], .table-hand [data-card-ref]'), node => [node.dataset.cardRef!, node]));
    if (hadPrevious) for (const [ref, node] of after) {
      if (before.has(ref)) continue;
      const animation = node.animate([{ opacity: .3, translate: '0 16px' }, { opacity: 1, translate: '0 0' }], { duration: 280, easing: 'ease-out' });
      this.animations.add(animation);
      void animation.finished.catch(() => {}).finally(() => this.animations.delete(animation));
    }
    for (const change of changes) {
      const old = before.get(change.cardRef);
      const target = after.get(change.cardRef);
      const pile = Array.from(root.querySelectorAll<HTMLElement>('[data-zone]')).find(node => node.dataset.zone === change.to.zone && node.dataset.playerId === change.to.playerId);
      if (!old || !(target || pile)) continue;
      if (change.from.zone === change.to.zone && change.from.playerId === change.to.playerId) continue; // native tap rotation
      const destination = (target ?? pile)!.getBoundingClientRect();
      const ghost = old.node.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('data-card-ref'); ghost.removeAttribute('id'); ghost.setAttribute('aria-hidden', 'true');
      ghost.className = 'table-transition-ghost';
      Object.assign(ghost.style, { left: `${old.rect.left}px`, top: `${old.rect.top}px`, width: `${old.rect.width}px`, height: `${old.rect.height}px` });
      document.body.append(ghost);
      const animation = ghost.animate([
        { transform: 'translate(0,0) scale(1)', opacity: .9 },
        { transform: `translate(${destination.left - old.rect.left}px,${destination.top - old.rect.top}px) scale(${destination.width / old.rect.width})`, opacity: 0 },
      ], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' });
      this.animations.add(animation);
      void animation.finished.catch(() => {}).finally(() => { ghost.remove(); this.animations.delete(animation); });
    }
  }
}
