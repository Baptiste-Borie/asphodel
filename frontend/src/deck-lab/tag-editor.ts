import { MAX_TAGS, validProjectTags, type ProjectTag, type ProjectTags } from '../../../shared/deck-tags.mjs';
import type { Sheet } from './deck-model';
import { editableTags, escapeTagText as esc, removeTag, setCardTag } from './deck-tags';
import './deck-tags.css';

/** One modal session = one undoable edit. Cancel never changes the live project. */
export function openTagEditor(sheet: Sheet, names: string[], apply: (tags: ProjectTags) => void) {
  const draft = editableTags(sheet);
  const known = new Set([...sheet.groups.flatMap(g => g.entries.map(e => e.card.name)), ...sheet.cuts.map(c => c.name)]);
  const selected = [...new Set(names)].filter(n => known.has(n));
  const invoker = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog'); dialog.className = 'lab-tag-editor';
  dialog.setAttribute('aria-labelledby', 'lab-tag-editor-title');
  dialog.innerHTML = `<header><div><p class="lab-tag-eyebrow">RÔLES DU DECK</p><h2 id="lab-tag-editor-title">${selected.length ? 'Attribuer des tags' : 'Gérer les tags'}</h2></div><button type="button" data-tag-cancel aria-label="Fermer les tags">✕</button></header><p>${selected.length ? `${selected.length} carte${selected.length > 1 ? 's' : ''} : ${esc(selected.slice(0, 3).join(' · '))}${selected.length > 3 ? '…' : ''}.` : esc(sheet.name)}</p><p class="lab-tag-help">${selected.length > 1 ? 'Une case partielle signale des tags différents. Coche pour attribuer à toutes, décoche pour retirer à toutes. ' : ''}Les tags suivent toutes les copies d’une carte. Catégories, piles et zones restent indépendantes.</p><div class="lab-tag-rows"></div><form class="lab-tag-create"><label>Nouveau tag<input name="name" maxlength="60" placeholder="Sacrifice, Jetons, Earthbend…" required></label><button type="submit">Créer le tag</button></form><p class="lab-tag-error" role="alert"></p><footer><span>Les modifications sont appliquées en une seule fois.</span><button type="button" data-tag-cancel>Annuler</button><button type="button" data-tag-save>Enregistrer</button></footer>`;
  const rows = dialog.querySelector<HTMLElement>('.lab-tag-rows')!;
  const error = dialog.querySelector<HTMLElement>('.lab-tag-error')!;
  const create = dialog.querySelector<HTMLFormElement>('.lab-tag-create')!;
  function addRow(tag: ProjectTag) {
    const row = document.createElement('section'); row.className = 'lab-tag-row'; row.dataset.tagRow = tag.id;
    const count = selected.filter(n => draft.cards.find(c => c.name === n)?.tagIds.includes(tag.id)).length;
    row.innerHTML = `<div class="lab-tag-row-heading">${selected.length ? `<label class="lab-tag-choice"><input type="checkbox" data-tag-toggle="${tag.id}" ${count === selected.length ? 'checked' : ''}><span>${esc(tag.name)}</span></label>` : `<strong>${esc(tag.name)}</strong>`}<details ${selected.length ? '' : 'open'}><summary>Définition et cible</summary><div class="lab-tag-fields"><label>Nom<input data-tag-name maxlength="60" required value="${esc(tag.name)}"></label><label>Définition<textarea data-tag-description maxlength="1000" rows="2">${esc(tag.description)}</textarea></label><label>Ma cible <small>facultative</small><input data-tag-target type="number" min="0" max="999" step="1" placeholder="Aucune" value="${tag.target ?? ''}"></label><button type="button" data-tag-delete="${tag.id}">Supprimer ce tag</button></div></details></div>`;
    rows.append(row);
    const checkbox = row.querySelector<HTMLInputElement>('[data-tag-toggle]');
    if (checkbox) checkbox.indeterminate = count > 0 && count < selected.length;
  }
  draft.definitions.forEach(addRow);
  function collect(): boolean {
    error.textContent = '';
    for (const row of rows.querySelectorAll<HTMLElement>('[data-tag-row]')) {
      const tag = draft.definitions.find(d => d.id === row.dataset.tagRow)!;
      const name = row.querySelector<HTMLInputElement>('[data-tag-name]')!;
      const target = row.querySelector<HTMLInputElement>('[data-tag-target]')!;
      for (const input of [name, target]) if (!input.checkValidity()) {
        row.querySelector('details')!.open = true; input.reportValidity(); return false;
      }
      tag.name = name.value.trim(); tag.description = row.querySelector<HTMLTextAreaElement>('[data-tag-description]')!.value;
      if (target.value === '') delete tag.target; else tag.target = Number(target.value);
    }
    if (!validProjectTags(draft, known)) { error.textContent = 'Chaque tag doit avoir un nom unique de 1 à 60 caractères et une cible entière entre 0 et 999.'; return false; }
    return true;
  }
  create.addEventListener('submit', event => {
    event.preventDefault();
    if (!collect()) return;
    const input = create.elements.namedItem('name') as HTMLInputElement, name = input.value.trim();
    if (!name) { error.textContent = 'Choisis un nom pour le tag.'; return; }
    if (draft.definitions.length >= MAX_TAGS) { error.textContent = `Maximum ${MAX_TAGS} tags par deck.`; return; }
    if (draft.definitions.some(d => d.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) { error.textContent = 'Ce nom de tag existe déjà.'; return; }
    const tag = { id: crypto.randomUUID(), name, description: '' }; draft.definitions.push(tag); addRow(tag); input.value = '';
    const row = rows.lastElementChild!;
    if (selected.length) { setCardTag(draft, selected, tag.id, true); row.querySelector<HTMLInputElement>('[data-tag-toggle]')!.checked = true; }
    row.scrollIntoView?.({ block: 'nearest' });
  });
  dialog.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.tagToggle) { setCardTag(draft, selected, input.dataset.tagToggle, input.checked); input.indeterminate = false; error.textContent = ''; }
    if (input.matches('[data-tag-name]')) {
      const row = input.closest<HTMLElement>('[data-tag-row]')!;
      const heading = row.querySelector('.lab-tag-choice span, strong'); if (heading) heading.textContent = input.value.trim();
    }
  });
  dialog.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!button) return;
    if (button.hasAttribute('data-tag-cancel')) dialog.close();
    if (button.dataset.tagDelete) { removeTag(draft, button.dataset.tagDelete); button.closest('[data-tag-row]')!.remove(); }
    if (button.hasAttribute('data-tag-save') && collect()) { apply(structuredClone(draft)); dialog.close(); }
  });
  dialog.addEventListener('close', () => { dialog.remove(); if (invoker?.isConnected) invoker.focus(); }, { once: true });
  document.body.append(dialog); dialog.showModal();
  // Start at the first checkbox or first editable name, not on the destructive actions.
  dialog.querySelector<HTMLInputElement>('[data-tag-toggle], [data-tag-name]')?.focus();
  return dialog;
}
