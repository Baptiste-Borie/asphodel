import type { Sheet } from './deck-model';
import { OpeningHandTrial } from './opening-hand';
import { escapeTagText as esc } from './deck-tags';
import './opening-hand.css';

/** An isolated snapshot: no persistence, history actions, catalog requests or Forge calls. */
export function openOpeningHands(sheet: Sheet) {
  const snapshot = structuredClone(sheet), dialog = document.createElement('dialog'); dialog.className = 'lab-opening-hands';
  const randomSeed = () => String(crypto.getRandomValues(new Uint32Array(1))[0]);
  let seed = randomSeed(), freeFirst = true, trial: OpeningHandTrial | undefined, error = '';
  function start() { try { trial = new OpeningHandTrial(snapshot, seed, freeFirst); error = ''; } catch (e) { trial = undefined; error = e instanceof Error ? e.message : 'Essai indisponible.'; } }
  function render() {
    const t = trial;
    const lands = t?.hand.filter(c => c.card.type_line.split(' // ')[0]!.split(/\s|—/).includes('Land')).length ?? 0;
    dialog.innerHTML = `<header><div><h2>Mains de départ</h2><p>${esc(snapshot.name)} · instantané à l’ouverture, sans modifier le deck</p></div><button type="button" data-hand="close" aria-label="Fermer les mains de départ">✕</button></header><form><label>Graine de l’essai <input name="seed" maxlength="80" required value="${esc(seed)}"></label><label>Règle de mulligan <select name="mode"><option value="multi" ${freeFirst ? 'selected' : ''}>Multijoueur · premier gratuit</option><option value="duel" ${!freeFirst ? 'selected' : ''}>Duel · aucun gratuit</option></select></label><button>Rejouer cette graine</button></form><p>Rejouer une graine recommence le même mélange et la même suite d’actions. Changer de règle recommence l’essai. London : remélanger, revoir jusqu’à 7 cartes, puis choisir les cartes à mettre dessous lorsque tu gardes.</p>${error ? `<p role="alert">${esc(error)}</p>` : ''}${t ? `<p class="lab-hand-status" role="status">${t.snapshot.cards.length} cartes dans la bibliothèque initiale · ${t.hand.length} en main · ${t.library.length} restantes · ${lands} terrains au recto en main · ${t.mulligans} mulligan${t.mulligans > 1 ? 's' : ''} · ${t.drawn} pioche${t.drawn > 1 ? 's' : ''}</p><p>Commandants hors de la bibliothèque : ${t.snapshot.commanders.map(e => `${esc(e.card.name)} ×${e.quantity}`).join(' · ') || 'aucun désigné'}. ${t.snapshot.cards.length < 7 ? 'Bibliothèque incomplète : moins de 7 cartes disponibles.' : ''}</p><div class="lab-hand-actions"><button type="button" data-hand="new">Nouvelle main</button><button type="button" data-hand="mulligan" ${t.kept || t.penalty >= Math.min(7, t.snapshot.cards.length) ? 'disabled' : ''}>Mulligan</button><button type="button" data-hand="keep" ${t.kept || t.bottom.length !== t.penalty ? 'disabled' : ''}>Garder${t.penalty ? ` · ${t.bottom.length} / ${t.penalty} dessous` : ''}</button><button type="button" data-hand="draw" ${!t.kept || !t.library.length ? 'disabled' : ''}>Piocher une carte</button></div><p>${t.kept ? 'Main gardée. Les pioches suivent le dessus de cette bibliothèque.' : t.penalty ? `Choisis ${t.penalty} carte${t.penalty > 1 ? 's' : ''} à mettre dessous, dans l’ordre voulu, puis garde la main.` : 'Garde cette main ou prends un mulligan.'}</p><div class="lab-hand-cards">${t.hand.map(c => `<article data-trial-card="${c.id}">${c.card.image ? `<img src="${esc(c.card.image)}" alt="${esc(c.card.name)}" loading="lazy">` : '<div class="lab-hand-no-art">Illustration indisponible</div>'}<h3>${esc(c.card.name)}</h3><p>${esc(c.card.mana_cost ?? 'Coût indisponible')} · ${c.roles.map(esc).join(' · ') || 'sans tag'}</p>${t.penalty && !t.kept ? `<button type="button" data-bottom="${c.id}" aria-pressed="${t.bottom.includes(c.id)}">${t.bottom.includes(c.id) ? `Dessous · position ${t.bottom.indexOf(c.id) + 1}` : 'Mettre dessous'}</button>` : ''}<details><summary>Texte enregistré</summary><p>${esc(c.card.type_line)}</p><p class="lab-hand-oracle">${esc(c.card.oracle_text ?? 'Texte indisponible')}</p>${c.card.faces?.length ? `<p>${c.card.faces.map(f => esc(f.name)).join(' / ')} · une seule carte dans la bibliothèque</p>` : ''}</details></article>`).join('')}</div>` : ''}<details><summary>Portée de l’essai</summary><p>Quantités et illustrations conservées. Commandants, candidats et cartes écartées exclus des tirages. Les tags sont manuels ; les terrains au verso restent des options à examiner. Aucune gestion automatique des effets, tours, mana, tuteurs, mulligans spéciaux ou cartes de départ hors bibliothèque. Ce mélange déterministe sert aux essais manuels ; aucune probabilité de bonne main ou de sort lançable n’est annoncée. Ferme puis rouvre pour utiliser les modifications récentes du deck.</p></details>`;
  }
  dialog.addEventListener('submit', event => {
    event.preventDefault(); const form = dialog.querySelector('form')!; seed = (form.elements.namedItem('seed') as HTMLInputElement).value.trim(); freeFirst = (form.elements.namedItem('mode') as HTMLSelectElement).value === 'multi'; start(); render();
  });
  dialog.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
    if (button.dataset.hand === 'close') { dialog.close(); return; }
    if (!trial) return;
    if (button.dataset.bottom !== undefined) trial.toggleBottom(button.dataset.bottom);
    switch (button.dataset.hand) { case 'new': trial.newHand(); break; case 'mulligan': trial.mulligan(); break; case 'keep': trial.keep(); break; case 'draw': trial.draw(); break; }
    if (button.dataset.hand || button.dataset.bottom !== undefined) {
      const action = button.dataset.hand, bottom = button.dataset.bottom; render();
      const next = dialog.querySelector<HTMLButtonElement>(bottom !== undefined ? `[data-bottom="${bottom}"]` : `[data-hand="${action}"]`);
      if (next && !next.disabled) next.focus();
    }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  start(); render(); document.body.append(dialog); dialog.showModal(); return dialog;
}
