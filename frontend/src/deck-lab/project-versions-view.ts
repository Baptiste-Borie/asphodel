import type { ProjectSnapshot } from '../../../shared/builder-project.mjs';
import type { Sheet } from './deck-model';
import { escapeTagText as esc, roleStatistics } from './deck-tags';
import { addProjectVersion, compareProjectVersions, findProjectVersion, versionSnapshot } from './project-versions';
import './project-versions.css';

type Actions = { changed: () => void; restore: (id: string) => string; fork: (id: string) => void; hands: (state: ProjectSnapshot) => void };
const sections = { commander: 'Commandants', mainboard: 'Deck joué', maybeboard: 'Candidats hors du deck', cuts: 'Cartes écartées V1' };

export function openProjectVersions(sheet: Sheet, actions: Actions): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'lab-versions'; dialog.setAttribute('aria-labelledby', 'lab-versions-title');
  let source = sheet.versions?.at(-1)?.id ?? '', target = 'working', feedback = '', failed = false;
  let confirmation: 'restore' | 'delete' | undefined;
  const resolve = (id: string) => id === 'working' ? versionSnapshot(sheet) : structuredClone(findProjectVersion(sheet, id).state);
  const label = (id: string) => id === 'working' ? 'Travail actuel' : findProjectVersion(sheet, id).name;
  function render() {
    const versions = sheet.versions ?? [];
    if (!versions.some(v => v.id === source)) source = versions.at(-1)?.id ?? '';
    if (target !== 'working' && !versions.some(v => v.id === target)) target = 'working';
    const options = versions.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
    let comparison = '';
    if (source) {
      const before = resolve(source), after = resolve(target), diff = compareProjectVersions(before, after);
      const summaryRows = [['Cartes jouées', diff.before.total, diff.after.total], ['Terrains (type enregistré)', diff.before.lands, diff.after.lands], ['Valeur de mana moyenne · non-terrains', diff.before.spells ? diff.before.average.toFixed(2) : '—', diff.after.spells ? diff.after.average.toFixed(2) : '—']];
      const rolesBefore = roleStatistics(before).roles, rolesAfter = roleStatistics(after).roles;
      const roles = new Set([...rolesBefore.map(r => r.name), ...rolesAfter.map(r => r.name)]);
      comparison = `<section class="lab-version-comparison"><h3>${esc(label(source))} → ${esc(label(target))}</h3><p class="lab-version-totals"><strong>+${diff.added}</strong> cartes ajoutées · <strong>−${diff.removed}</strong> retirées du deck joué, commandants compris</p><div class="lab-version-table"><table><thead><tr><th>Repère</th><th>${esc(label(source))}</th><th>${esc(label(target))}</th></tr></thead><tbody>${summaryRows.map(([name,a,b])=>`<tr><th>${esc(String(name))}</th><td>${a}</td><td>${b}</td></tr>`).join('')}${[...roles].map(name=>`<tr><th>Tag manuel · ${esc(name)}</th><td>${rolesBefore.find(r=>r.name===name)?.count ?? 0}</td><td>${rolesAfter.find(r=>r.name===name)?.count ?? 0}</td></tr>`).join('')}</tbody></table></div><p>Les tags peuvent se recouper. Ces repères ne prédisent pas la force du deck.</p>${Object.entries(sections).map(([section,title]) => {
        const rows = diff.changes.filter(c=>c.section===section);
        return `<details ${section==='mainboard'||section==='commander' ? 'open' : ''}><summary>${title} · ${rows.length} carte${rows.length>1?'s':''} modifiée${rows.length>1?'s':''}</summary>${rows.length ? `<div class="lab-version-table"><table><thead><tr><th>Carte</th><th>Avant</th><th>Après</th><th>Écart</th></tr></thead><tbody>${rows.map(c=>`<tr><th>${esc(c.name)}</th><td>${c.before}</td><td>${c.after}</td><td class="${c.delta>0?'is-added':'is-removed'}">${c.delta>0?'+':'−'}${Math.abs(c.delta)}</td></tr>`).join('')}</tbody></table></div>` : '<p>Aucun changement de quantité.</p>'}</details>`;
      }).join('')}<p>Autres différences : ${[diff.tagsChanged&&'tags et cibles',diff.tableChanged&&'table, notes ou cadrage',diff.categoriesChanged&&'composition ou rangement des catégories',diff.printingChanged&&'illustrations ou métadonnées des cartes'].filter(Boolean).join(' · ') || 'aucune'}.</p><p>La comparaison regroupe les quantités par nom et section : déplacer une carte entre deux catégories du deck ne compte pas comme un ajout. Passer de candidat à deck apparaît dans les deux sections.</p></section>`;
    }
    dialog.innerHTML = `<header><div><p class="lab-eyebrow">CONSTRUIRE · COMPARER · ESSAYER</p><h2 id="lab-versions-title">Versions du deck</h2><p>${esc(sheet.name)}</p></div><button type="button" data-version-action="close" aria-label="Fermer les versions">✕</button></header><p>Une version conserve tes cartes, quantités, illustrations, tags, piles, zones et notes. Ton travail actuel continue à s’enregistrer automatiquement.</p><form class="lab-version-save"><label>Nom de la nouvelle version<input name="versionName" required maxlength="80" placeholder="Base, plus de pioche, sans combo…"></label><button ${versions.length>=20?'disabled':''}>Enregistrer cette version</button><span>${versions.length} / 20 versions</span></form><p data-version-feedback role="${failed?'alert':'status'}">${esc(feedback)}</p>${versions.length ? `<div class="lab-version-pickers"><label>Version de référence<select data-version-source>${options}</select></label><label>Comparer à<select data-version-target><option value="working">Travail actuel</option>${options}</select></label></div><p>Référence enregistrée le ${esc(new Date(findProjectVersion(sheet,source).createdAt).toLocaleString())}.</p><div class="lab-version-actions"><button type="button" data-version-action="hands">Essayer ses mains</button><button type="button" data-version-action="fork">Créer un deck séparé</button><button type="button" data-version-action="restore">Restaurer la référence</button><button type="button" data-version-action="delete">Supprimer la référence</button></div>${confirmation ? `<div class="lab-version-confirm" role="group" aria-label="Confirmation">${confirmation==='restore' ? '<p>Remplacer le travail actuel par cette référence ? L’état précédent sera conservé parmi les versions, et la restauration sera annulable.</p>' : '<p>Supprimer cette version enregistrée ? Le travail actuel et les autres versions seront conservés.</p>'}<button type="button" data-version-action="confirm">${confirmation==='restore'?'Restaurer et conserver l’état précédent':'Supprimer cette version'}</button><button type="button" data-version-action="cancel">Annuler</button></div>` : ''}${comparison}` : '<div class="lab-version-empty"><h3>Garde une base avant de tenter une idée.</h3><p>Enregistre ta première version, modifie ton deck puis reviens ici voir ce qui a changé.</p></div>'}`;
    const from = dialog.querySelector<HTMLSelectElement>('[data-version-source]'), to = dialog.querySelector<HTMLSelectElement>('[data-version-target]');
    if (from) from.value = source; if (to) to.value = target;
  }
  function run(action: () => void) {
    const active = document.activeElement as HTMLElement | null;
    const buttonAction = active?.dataset.versionAction;
    const selector = active?.hasAttribute('data-version-source') ? '[data-version-source]' : active?.hasAttribute('data-version-target') ? '[data-version-target]' : buttonAction ? `[data-version-action="${buttonAction}"]` : '[name=versionName]';
    const name = dialog.querySelector<HTMLInputElement>('[name=versionName]')?.value ?? '';
    failed = false; feedback = '';
    try { action(); } catch(error) { failed = true; feedback = error instanceof Error ? error.message : 'Action impossible.'; }
    render();
    if (failed) dialog.querySelector<HTMLInputElement>('[name=versionName]')!.value = name;
    if (dialog.open) dialog.querySelector<HTMLElement>(selector)?.focus();
  }
  dialog.addEventListener('submit', event => { event.preventDefault(); const input = dialog.querySelector<HTMLInputElement>('[name=versionName]')!;
    run(()=>{ source = addProjectVersion(sheet,input.value).id; target = 'working'; confirmation = undefined; actions.changed(); feedback = 'Version conservée. Enregistrement automatique en cours ; le statut du builder confirme sa sauvegarde.'; });
  });
  dialog.addEventListener('change', event => {
    const select = event.target as HTMLSelectElement;
    if (select.hasAttribute('data-version-source')) source = select.value;
    else if (select.hasAttribute('data-version-target')) target = select.value;
    else return;
    confirmation = undefined; run(()=>{});
  });
  dialog.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-version-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.versionAction;
    if (action==='close') { dialog.close(); return; }
    run(()=>{
      if (action==='hands') actions.hands(resolve(source));
      if (action==='fork') { actions.fork(source); dialog.close(); }
      if (action==='restore' || action==='delete') confirmation = action;
      if (action==='cancel') confirmation = undefined;
      if (action==='confirm') {
        if (confirmation==='restore') feedback = `Référence restaurée. État précédent conservé : ${actions.restore(source)}.`;
        if (confirmation==='delete') { sheet.versions = sheet.versions!.filter(v=>v.id!==source); actions.changed(); feedback = 'Version supprimée. Le travail actuel est conservé.'; }
        confirmation = undefined;
      }
    });
  });
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  render(); document.body.append(dialog); dialog.showModal(); return dialog;
}
