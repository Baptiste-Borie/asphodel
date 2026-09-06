import { createTableCard } from './card-view.js';
import type { AgentCardObservation, AgentPlayerObservation, AgentObservation, CardPresentation } from './types.js';

export function visibleFace(card: Pick<AgentCardObservation, 'name' | 'hidden' | 'faceDown'>): boolean {
  return Boolean(card.name && !card.hidden && !card.faceDown);
}

/** A seat owns its public piles. Never reads a library or an opponent hand. */
export function renderPublicZones(container: HTMLElement, player: AgentPlayerObservation, get: (name: string) => CardPresentation | null | undefined, inspect: (title: string, cards: AgentCardObservation[]) => void): void {
  container.dataset.playerId = player.playerId;
  container.replaceChildren();
  for (const zone of ['library', 'graveyard', 'exile'] as const) {
    const cards = zone === 'library' ? [] : player[zone];
    const count = player[`${zone}Size`];
    const pile = document.createElement('button');
    pile.type = 'button';
    pile.className = `table-pile table-pile--${zone}`;
    pile.dataset.zone = zone;
    pile.dataset.playerId = player.playerId;
    pile.setAttribute('aria-label', `${player.name}: ${zone}, ${count} cards`);
    const top = cards.at(-1);
    const face = document.createElement('span');
    face.className = count ? 'table-pile-face table-card-back' : 'table-pile-face table-pile-face--empty';
    if (top && visibleFace(top)) {
      const art = get(top.name!)?.imageUri;
      if (art) { const img = document.createElement('img'); img.src = art; img.alt = top.name!; face.append(img); }
      else face.textContent = top.name;
    } else face.textContent = count ? '◇' : '—';
    const label = document.createElement('span');
    label.className = 'table-pile-label';
    label.textContent = `${zone} · ${count}`;
    pile.append(face, label);
    pile.disabled = zone === 'library' || !count;
    if (zone !== 'library') pile.onclick = () => inspect(`${player.name} · ${zone}`, cards);
    container.append(pile);
  }
}

export function createZoneInspector(get: (name: string) => CardPresentation | null | undefined) {
  const dialog = document.createElement('dialog');
  dialog.className = 'table-zone-inspector';
  dialog.setAttribute('aria-label', 'Public zone cards');
  return { element: dialog, open(title: string, cards: AgentCardObservation[]) {
    dialog.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = title;
    const close = document.createElement('button'); close.textContent = 'Close ×'; close.onclick = () => dialog.close();
    const row = document.createElement('div'); row.className = 'table-zone-inspector-cards';
    for (const card of cards) row.append(createTableCard(card, visibleFace(card) ? get(card.name!) : null));
    dialog.append(heading, close, row);
    if (!dialog.open) dialog.showModal();
  }, close() { dialog.close(); } };
}

export function renderHiddenHand(container: HTMLElement, count: number): void {
  container.setAttribute('aria-label', `Opponent hand: ${count} cards`);
  container.replaceChildren();
  for (let i = 0; i < Math.min(count, 16); i++) {
    const back = document.createElement('span'); back.className = 'table-card-back'; back.textContent = '◇';
    back.style.setProperty('--fan-angle', `${(i - (Math.min(count, 16) - 1) / 2) * 3}deg`);
    back.setAttribute('aria-hidden', 'true'); container.append(back);
  }
  const label = document.createElement('small'); label.textContent = `${count} cards`; container.append(label);
}

export function renderStack(container: HTMLElement, observation: AgentObservation): void {
  container.replaceChildren();
  container.hidden = !observation.stack.length;
  for (const item of observation.stack) {
    const spell = document.createElement('div'); spell.className = 'table-stack-spell';
    spell.dataset.cardRef = item.sourceCardRef ?? '';
    spell.textContent = item.hidden || item.faceDown ? 'Face-down spell' : item.sourceCardName ?? 'Ability';
    container.append(spell);
  }
}
