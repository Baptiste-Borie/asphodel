import type { LabCard, LabPrinting } from '../../../shared/deck-lab';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function printingKey(p: LabPrinting): string { return JSON.stringify([p.set,p.collector_number,p.lang,p.image]); }
export function availablePrintings(card: LabCard): LabPrinting[] {
  const unique = new Map<string,LabPrinting>();
  for (const p of [card,...card.otherPrintings ?? []]) if (!unique.has(printingKey(p))) {
    unique.set(printingKey(p), { set:p.set,set_name:p.set_name,collector_number:p.collector_number,rarity:p.rarity,lang:p.lang,image:p.image,
      ...(p.faces ? {faces:p.faces} : {}) });
  }
  return [...unique.values()];
}
/** Changing art changes the whole printing identity, not deck identity or Oracle rules. */
export function cardWithPrinting(card: LabCard, printing: LabPrinting): LabCard {
  const next = { ...card, set: printing.set, set_name: printing.set_name, collector_number: printing.collector_number,
    rarity: printing.rarity, lang: printing.lang, image: printing.image };
  if (printing.faces) next.faces = structuredClone(printing.faces);
  else delete next.faces;
  return next;
}
/** Catalog enrichment must never silently replace a user's chosen illustration. */
export function enrichInspection(saved: LabCard, catalog: LabCard): LabCard {
  const printing = availablePrintings(catalog).find(p => p.image === saved.image ||
    (!!saved.set && p.set === saved.set && p.collector_number === saved.collector_number && p.lang === saved.lang));
  const merged = { ...catalog, ...saved, mana_cost: saved.mana_cost ?? catalog.mana_cost,
    oracle_text: saved.oracle_text ?? catalog.oracle_text, type_line: saved.type_line || catalog.type_line,
    power: saved.power ?? catalog.power, toughness: saved.toughness ?? catalog.toughness, loyalty: saved.loyalty ?? catalog.loyalty,
    related: saved.related.length ? saved.related : catalog.related, otherPrintings: availablePrintings(catalog),
    commander_legal: catalog.commander_legal };
  // Legacy cards with only a front image can recover its matching back image offline.
  if (saved.faces) merged.faces = saved.faces;
  else if (printing?.faces) merged.faces = printing.faces;
  else delete merged.faces;
  return merged;
}
export interface InspectionActions {
  state: () => { quantity: number; included: boolean };
  quantity: (value: number) => void;
  membership: (included: boolean) => void;
  printing: (card: LabCard) => void;
  note: () => void;
  tags?: () => void;
  tagNames?: () => string[];
}
/** Self-contained inspector; preview/flip never mutate a deck. Explicit actions do. */
export function mountCardInspector(root: HTMLElement, initial: LabCard, actions?: InspectionActions) {
  const abort = new AbortController();
  let card = initial, printings = availablePrintings(card), chosen = 0, face = 0, interacted = false;
  let message = '';
  const get = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const chosenCard = () => cardWithPrinting(card, printings[chosen]!);
  function render() {
    const view = chosenCard(), faces = view.faces && view.faces.length >= 2 ? view.faces : undefined;
    if (!faces || face >= faces.length) face = 0;
    const art = faces?.[face] ?? view;
    const mana = esc(view.mana_cost ?? '').replace(/\{([^}]+)\}/g, (_,symbol: string) => `<span class="lab-mana">${symbol}</span>`);
    const state = actions?.state();
    root.innerHTML = `<article class="lab-inspection"><div class="lab-inspection-art"><div class="lab-inspection-image">${art.image ? `<img src="${esc(art.image)}" alt="${esc(art.name)}">` : `<p class="lab-inspection-no-image">Illustration indisponible</p>`}</div>${faces ? `<button type="button" data-inspect-flip>Retourner · ${esc(faces[face]!.name)}</button>` : ''}</div><div class="lab-inspection-info"><h2 id="lab-inspection-title">${esc(view.name)}</h2><div class="lab-inspection-mana">${mana}<span>Valeur de mana : ${view.cmc}</span></div><p class="lab-type">${esc(view.type_line)}</p><div class="lab-rules">${(view.oracle_text ?? 'Texte indisponible dans les données enregistrées.').split('\n').map(line => `<p>${esc(line)}</p>`).join('')}</div>${view.power !== null || view.toughness !== null ? `<p>Force / endurance : ${esc(view.power ?? '—')} / ${esc(view.toughness ?? '—')}</p>` : ''}${view.loyalty !== null ? `<p>Loyauté : ${esc(view.loyalty)}</p>` : ''}<p>Identité couleur : ${esc(view.color_identity.join(' · ') || 'Incolore')}</p><p>Commander : ${view.commander_legal ? esc(view.commander_legal.replaceAll('_',' ')) : 'statut indisponible'}</p><div class="lab-inspection-printing"><label for="lab-inspection-printing">Illustration / édition</label><select id="lab-inspection-printing" data-inspect-printing>${printings.map((p,i) => `<option value="${i}" ${i === chosen ? 'selected' : ''}>${esc(p.set_name || p.set || 'Version enregistrée')} · #${esc(p.collector_number || '—')} · ${esc(p.lang.toUpperCase())}</option>`).join('')}</select><p>${esc(view.set.toUpperCase())} · ${esc(view.rarity || 'Rareté indisponible')}</p>${actions ? '<button type="button" data-inspect-apply>Conserver cette illustration</button>' : ''}<small>Aperçu seulement tant que tu ne la conserves pas.</small></div>${view.related.length ? `<details><summary>Cartes / faces liées · ${view.related.length}</summary><ul>${view.related.map(name => `<li>${esc(name)}</li>`).join('')}</ul></details>` : ''}${state ? `<div class="lab-inspection-actions"><p>${state.included ? 'Dans le deck' : 'Mise de côté'}</p><label>Quantité <input data-inspect-quantity type="number" min="1" max="999" step="1" value="${state.quantity}"></label><button type="button" data-inspect-membership>${state.included ? 'Mettre de côté' : 'Inclure dans le deck'}</button><button type="button" data-inspect-note>Ajouter une note liée</button>${actions?.tags ? `<p>Tags : ${esc(actions.tagNames?.().join(' · ') || 'Aucun')}</p><button type="button" data-inspect-tags>Modifier les tags</button>` : ''}</div>` : ''}<p class="lab-inspection-status" role="status">${esc(message)}</p></div></article>`;
  }
  root.addEventListener('error', event => {
    const img = event.target;
    if (img instanceof HTMLImageElement) { const fallback = document.createElement('p'); fallback.className = 'lab-inspection-no-image'; fallback.textContent = 'Illustration indisponible'; img.replaceWith(fallback); }
  }, {capture:true,signal:abort.signal});
  root.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.matches('[data-inspect-printing]')) { const index = Number(input.value); if (!Number.isInteger(index) || !printings[index]) return; chosen = index; face = 0; interacted = true; message = 'Aperçu de l’illustration.'; render(); }
    if (input.matches('[data-inspect-quantity]') && actions) { const quantity = Number(input.value); if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) { input.value = String(actions.state().quantity); return; } actions.quantity(quantity); interacted = true; message = 'Quantité modifiée.'; render(); }
  }, {signal:abort.signal});
  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!button) return;
    if (button.matches('[data-inspect-flip]')) { face = (face + 1) % (chosenCard().faces?.length ?? 1); interacted = true; render(); get<HTMLButtonElement>('[data-inspect-flip]').focus(); }
    if (button.matches('[data-inspect-apply]') && actions) { card = chosenCard(); actions.printing(card); interacted = true; message = 'Illustration conservée dans le deck.'; render(); }
    if (button.matches('[data-inspect-membership]') && actions) { actions.membership(!actions.state().included); interacted = true; message = 'Appartenance au deck modifiée.'; render(); }
    if (button.matches('[data-inspect-note]') && actions) actions.note();
    if (button.matches('[data-inspect-tags]')) actions?.tags?.();
  }, {signal:abort.signal});
  render();
  return { update(next: LabCard) { if (interacted) return; card = next; printings = availablePrintings(card); chosen = 0; face = 0; render(); }, dispose() { abort.abort(); } };
}
