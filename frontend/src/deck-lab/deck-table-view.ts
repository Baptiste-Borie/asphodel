import { apiRequest } from '../api/api-client';
import type { LabCard, LabSearchResult } from '../../../shared/deck-lab';
import type { ProjectHistory } from './project-history';
import { deckStatistics, type Sheet } from './deck-model';
import { assignZone, createZone, fitZones, initializeZones, zoneAt, emptyWorkspace, reconcileWorkspace, screenToWorld, setRowMembership, zoomAt, type Point, type Row, type Workspace, type Zone } from './deck-workspace';
import { addToPile, arrangePile, arrangeZone, createPile, detachPileCards, dissolvePile, pileBounds, pileFor, pileRows, resizeZone, visibleInPile } from './deck-piles';
import { createNote, detachNote, notePosition, NOTE_WIDTH, NOTE_HEIGHT } from './deck-notes';
import './deck-table.css';
import { tagBadges, roleSummary } from './deck-tags';
import './deck-tags.css';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Options = { history: ProjectHistory; changed: () => void; inspect: (card: LabCard, entryId: string) => void; legacy: () => void; library: () => void; tags?: (names: string[]) => void; commanderAnalysis?: () => string };

/** DOM rendering and pointer gestures stay outside deck business logic. */
export function mountDeckTable(root: HTMLElement, sheet: Sheet, options: Options) {
  const history = options.history;
  const workspace: Workspace = sheet.workspace ??= emptyWorkspace();
  const fresh = workspace.cards.length === 0 && !workspace.zonesInitialized;
  let needsInitialFit = fresh;
  let rows: Row[] = [];
  const selected = new Set<string>();
  const abort = new AbortController();
  let searchAbort: AbortController | undefined;
  let noteEditing: string | undefined;
  let results: LabCard[] = [];
  let space = false;
  let disposed = false;
  let gesture: { pointer: number; start: Point; camera: Point; positions: { point: Point; x: number; y: number }[]; pan: boolean; lasso: boolean; additive: boolean; cards: boolean; moved: boolean; last: Point; selection: string[]; raised: boolean; note?: string; pile?: string; resize?: { zone: Zone; width: number; height: number } } | undefined;
  root.innerHTML = `<div class="dt-heading"><h2 title="${esc(sheet.name)}">${esc(sheet.name)}</h2><span data-dt-count></span>
    <details class="dt-create"><summary>+ Zone</summary><form class="dt-zone-form"><label for="dt-zone-name">Nouvelle zone</label><input id="dt-zone-name" aria-label="New zone name" placeholder="Ramp, Draw, À tester…" maxlength="60" required><button>Create zone</button><small>Le contour s’adapte aux cartes déposées.</small></form></details>
    <button data-dt="note">+ Note</button><div class="dt-history"><button type="button" data-history="undo" aria-label="Annuler">↶</button><button type="button" data-history="redo" aria-label="Rétablir">↷</button></div>
    <button data-dt="search" aria-expanded="false">Search</button><button data-dt="analysis" aria-expanded="false">Analyse</button>
    <details class="dt-menu"><summary aria-label="Table tools">•••</summary><div class="dt-menu-content"><button data-action="export-deck">Exporter le deck</button>${window.asphodelDesktop ? '<button data-action="prepare-artwork">Préparer hors ligne</button>' : ''}<button data-action="manage-tags">Gérer les tags</button><button data-dt="library">Tous les decks</button><button data-dt="legacy">Builder V1</button><button data-action="selection">Selection</button><button data-dt="deck">Center deck</button><button data-dt="pan" aria-pressed="false">Pan tool</button><p>Ctrl / Espace + glisser : déplacer la vue<br>Shift + clic : sélectionner plusieurs cartes<br>Créer une pile depuis la sélection<br>Glisser une carte hors d’une pile : l’extraire<br>Poignée ↘ : redimensionner une zone<br>Verrouiller une zone fixe son cadre, pas ses cartes<br>Glisser sur le vide : sélectionner une zone<br>Échap : annuler le geste en cours<br>Ctrl+Z : annuler · Ctrl+Maj+Z / Ctrl+Y : rétablir<br>Molette : zoom · F : tout voir<br>Double clic / I : inspecter une carte<br>Notes liées : suivent leur carte<br>Échap dans une note : annuler la saisie</p></div></details></div>
    <div class="dt-body"><div class="dt-canvas" tabindex="0" aria-label="Deck table. Drag cards to move. Shift click to select several. Control or Space drag to pan. Wheel to zoom."><div class="dt-world"><div class="dt-zones"></div><div class="dt-cards"></div><div class="dt-piles"></div><div class="dt-notes"></div></div><div class="dt-lasso" hidden></div><p class="dt-empty" hidden>Room to think. Search for cards and place your first ideas.</p></div>
    <aside class="dt-panel dt-search" hidden><header><h3>Find cards</h3><button data-dt="search" aria-label="Close search">✕</button></header><form class="dt-search-form"><input aria-label="Table card search" placeholder="Name or Oracle text…"><label><input type="checkbox" name="advanced"> Advanced syntax</label><button>Search catalog</button></form><p class="dt-search-status" role="status"></p><div class="dt-search-results"></div><button data-dt="more" hidden>Load more</button><small>Click or drag a result onto the table. It starts as a candidate.</small></aside>
    <aside class="dt-panel dt-analysis" hidden aria-label="Deck analysis"><header><h3>Analyse</h3><button data-dt="analysis" aria-label="Close analysis">✕</button></header><div class="dt-analysis-content"></div></aside></div>
    <div class="dt-tools"><button data-dt="fit">Show all · F</button><button data-dt="out" aria-label="Zoom out">−</button><span data-dt-zoom></span><button data-dt="in" aria-label="Zoom in">+</button></div>
    <div class="dt-selection" hidden><span data-dt-selected>0 selected</span><label class="dt-quantity">Quantité <input type="number" min="1" max="999" step="1" data-dt-quantity aria-label="Quantité de la carte sélectionnée"></label><button data-dt="tags">Tags</button><button data-dt="inspect">Inspecter</button><button data-dt="card-note">+ Note liée</button><button data-dt="exclude">Set aside</button><button data-dt="include">Add to deck</button><details class="dt-new-pile"><summary>Créer une pile</summary><form class="dt-pile-form"><label for="dt-pile-name">Nom de la pile</label><input id="dt-pile-name" maxlength="60" value="Nouvelle pile" required><button>Regrouper</button></form></details><select data-add-to-pile aria-label="Ajouter la sélection à une pile"></select><button data-dt="clear" aria-label="Clear selection">✕</button></div>
    <footer class="dt-footer"><span>Ctrl + glisser : déplacer la vue · F : tout voir</span><span data-dt-storage role="status"></span><span data-save-status role="status"></span><button data-action="retry-save" hidden>Réessayer</button></footer>`;
  const get = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const canvas = get('.dt-canvas');
  let panTool = false;
  let control = false;
  function updatePanCursor() { canvas.classList.toggle('is-pan', panTool || control || space); }
  function persist() {
    sheet.workspace = workspace;
    options.changed();
    get('[data-dt-storage]').textContent = 'Table et deck enregistrés ensemble';
  }
  function camera() {
    const c = workspace.camera;
    get('.dt-world').style.transform = `translate(${c.x}px,${c.y}px) scale(${c.zoom})`;
    canvas.dataset.distance = c.zoom < .3 ? 'far' : 'near';
    get('[data-dt-zoom]').textContent = `${Math.round(c.zoom * 100)}%`;
    canvas.style.backgroundPosition = `${c.x}px ${c.y}px`;
    canvas.style.backgroundSize = `${80 * c.zoom}px ${80 * c.zoom}px`;
  }
  function selection() {
    for (const el of root.querySelectorAll<HTMLElement>('[data-dt-card]')) {
      const yes = selected.has(el.dataset.dtCard!);
      el.classList.toggle('is-selected', yes); el.setAttribute('aria-pressed', String(yes));
    }
    get('.dt-selection').hidden = selected.size === 0;
    get('[data-dt-selected]').textContent = `${selected.size} selected`;
    get('.dt-new-pile').hidden = selected.size < 2;
    get<HTMLButtonElement>('[data-dt=inspect]').disabled = selected.size !== 1;
    get<HTMLButtonElement>('[data-dt=card-note]').disabled = selected.size !== 1;
    const destination = get<HTMLSelectElement>('[data-add-to-pile]');
    destination.hidden = !workspace.piles?.length;
    destination.innerHTML = '<option value="">Ajouter à une pile…</option>' + (workspace.piles ?? []).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    const quantity = get<HTMLInputElement>('[data-dt-quantity]');
    const row = rows.find(r => selected.has(r.placement.id));
    quantity.disabled = selected.size !== 1; quantity.value = selected.size === 1 && row ? String(row.entry.quantity) : '';
    quantity.closest<HTMLElement>('label')!.hidden = selected.size !== 1;
    get<HTMLButtonElement>('[data-dt=include]').disabled = !rows.some(r => selected.has(r.placement.id) && r.group.maybeboard);
    get<HTMLButtonElement>('[data-dt=exclude]').disabled = !rows.some(r => selected.has(r.placement.id) && !r.group.maybeboard);
  }
  function analysis() {
    const stats = deckStatistics(sheet.groups);
    get('[data-dt-count]').textContent = `${stats.total} / 100 in deck · ${rows.filter(r => r.group.maybeboard).reduce((n,r) => n+r.entry.quantity,0)} aside`;
    const list = (pairs: { name: string; count: number }[]) => pairs.map(p => `<div><span>${esc(p.name)}</span><strong>${p.count}</strong></div>`).join('');
    get('.dt-analysis-content').innerHTML = `${options.commanderAnalysis?.() ?? ''}<p>${stats.total} cards in deck · candidates and cuts excluded</p><h4>Types</h4><div class="dt-stat-list">${list(stats.types)}</div><h4>Mana curve · nonlands</h4><div class="lab-curve">${stats.curve.map((n,i) => `<div><span>${n}</span><i style="height:${n/Math.max(...stats.curve,1)*100}px"></i><label>${i===7?'7+':i}</label></div>`).join('')}</div><p>Average mana value: ${stats.spells ? stats.average.toFixed(2) : '—'}</p><h4>Color identity · overlaps</h4><div class="dt-stat-list">${list(['W','U','B','R','G'].map(name => ({name,count:stats.entries.filter(e=>e.card.color_identity.includes(name)).reduce((n,e)=>n+e.quantity,0)})))}</div><h4>Catégories de rangement</h4><div class="dt-stat-list">${list(sheet.groups.filter(g=>!g.maybeboard).map(g=>({name:g.name,count:g.entries.reduce((n,e)=>n+e.quantity,0)})))}</div>${roleSummary(sheet)}<p>Les zones et catégories ne changent pas les tags. L’analyse des sources de mana arrivera dans un prochain patch.</p>`;
  }
  function render() {
    rows = reconcileWorkspace(sheet, workspace);
    initializeZones(workspace, rows, fresh);
    fitZones(workspace, rows);
    for (const id of selected) if (!rows.some(r => r.placement.id === id)) selected.delete(id);
    get('.dt-cards').innerHTML = rows.map(r => `<button class="dt-card ${r.group.maybeboard ? 'is-aside' : ''}" data-dt-card="${r.placement.id}" ${visibleInPile(workspace,r.placement.id) ? '' : 'hidden'} style="left:${r.placement.x}px;top:${r.placement.y}px;z-index:${r.placement.z}" aria-label="${esc(r.entry.card.name)} · ${r.entry.quantity} · ${r.group.maybeboard?'outside deck':'in deck'}" aria-pressed="false">${r.entry.card.image ? `<img draggable="false" src="${esc(r.entry.card.image)}" alt="${esc(r.entry.card.name)}" loading="lazy">` : `<span class="dt-fallback">${esc(r.entry.card.name)}</span>`}${tagBadges(sheet,r.entry.card.name)}<span class="dt-card-label">${esc(r.entry.card.name)}</span><span class="dt-badge">${r.entry.quantity > 1 ? `×${r.entry.quantity} · ` : ''}${r.group.maybeboard ? r.placement.cut ? 'Cut' : 'Candidate' : r.group.commander ? 'Commander' : 'In deck'}</span></button>`).join('');
    get('.dt-zones').innerHTML = workspace.zones.map(z => `<section class="dt-zone ${z.locked?'is-locked':''} ${z.sizing==='manual'?'is-manual':''}" data-dt-zone="${z.id}" style="left:${z.x}px;top:${z.y}px;width:${z.width}px;height:${z.height}px"><header><input aria-label="Zone name" maxlength="60" value="${esc(z.name)}" ${z.locked?'readonly':''}><span data-zone-count></span><button data-zone-action="fit" data-zone="${z.id}" aria-label="Ajuster la zone ${esc(z.name)} aux cartes" title="Ajuster le cadre aux cartes" ${z.locked?'disabled':''}>↔</button><button data-zone-action="arrange" data-zone="${z.id}" aria-label="Ranger les cartes dans ${esc(z.name)}" title="Ranger en grille, sur demande" ${z.locked?'disabled':''}>▦</button><button data-zone-action="lock" data-zone="${z.id}" aria-label="${z.locked?'Déverrouiller':'Verrouiller'} la zone ${esc(z.name)}" title="${z.locked?'Déverrouiller le cadre':'Fixer le cadre ; les cartes restent libres'}" aria-pressed="${!!z.locked}">${z.locked?'🔒':'🔓'}</button><button data-delete-zone="${z.id}" aria-label="Delete zone ${esc(z.name)}" ${z.locked?'disabled':''}>×</button></header><span class="dt-zone-empty">Déposer des cartes ici</span><button class="dt-zone-resize" data-resize-zone="${z.id}" aria-label="Redimensionner la zone ${esc(z.name)}" title="Glisser pour redimensionner · flèches au clavier" ${z.locked?'disabled':''}>↘</button></section>`).join('');
    get('.dt-piles').innerHTML = (workspace.piles ?? []).map(p => {
      const members=pileRows(p,rows), total=members.reduce((n,r)=>n+r.entry.quantity,0), included=members.filter(r=>!r.group.maybeboard).reduce((n,r)=>n+r.entry.quantity,0);
      return `<header class="dt-pile" data-dt-pile="${p.id}" style="left:${p.x}px;top:${p.y}px;width:${pileBounds(p,rows).width}px;z-index:${Math.max(0,...members.map(r=>r.placement.z))}" aria-label="Pile ${esc(p.name)}"><div class="dt-pile-title"><span class="dt-pile-grip" title="Déplacer la pile">⠿</span><input aria-label="Nom de la pile ${esc(p.name)}" maxlength="60" value="${esc(p.name)}"><span title="${total} cartes, dont ${included} dans le deck">×${total}</span></div><div class="dt-pile-actions"><button data-pile-action="toggle" data-pile="${p.id}" aria-expanded="${p.expanded}">${p.expanded?'Réduire':'Déplier'}</button><button data-pile-action="select" data-pile="${p.id}" aria-label="Sélectionner la pile ${esc(p.name)}" title="Sélectionner toutes ses cartes">☷</button><button data-pile-action="dissolve" data-pile="${p.id}" title="Séparer les cartes sans les retirer du deck">Dissoudre</button></div></header>`;
    }).join('');
    renderNotes();
    get('.dt-empty').hidden = rows.length > 0 || !!workspace.notes?.length;
    updateZoneCounts(); selection(); analysis(); camera();
    if (needsInitialFit && canvas.clientWidth > 0) { needsInitialFit = false; fit(); }
  }
  function edit(label: string, mutate: () => void) {
    checkpoint(); history.begin(label);
    try { mutate(); render(); history.commit(); persist(); }
    catch (error) { history.cancel(); render(); persist(); get('[data-dt-storage]').textContent = error instanceof Error ? error.message : 'Modification impossible.'; }
  }
  function renderNotes() {
    get('.dt-notes').innerHTML = (workspace.notes ?? []).map(n => {
      const point = notePosition(n, workspace), name = rows.find(r => r.placement.id === n.cardId)?.entry.card.name;
      return `<article class="dt-note" data-note="${n.id}" data-color="${n.color}" style="left:${point.x}px;top:${point.y}px"><header><span class="dt-note-grip" title="Glisser pour déplacer la note">⠿</span><span class="dt-note-anchor" title="${esc(name ?? 'Note libre')}">${esc(name ?? 'Note libre')}</span>${n.cardId ? `<button data-note-action="detach" data-note-id="${n.id}" aria-label="Détacher la note" title="Garder cette note ici, sans suivre la carte">⤴</button>` : ''}<button data-note-action="delete" data-note-id="${n.id}" aria-label="Supprimer la note">×</button></header><textarea data-note-text="${n.id}" aria-label="Texte de la note" maxlength="4000" placeholder="Protection pour Aang, à tester, coupe possible…">${esc(n.text)}</textarea><footer><select data-note-color="${n.id}" aria-label="Couleur de la note">${[['sand','Sable'],['sage','Sauge'],['lavender','Lavande']].map(([value,label]) => `<option value="${value}" ${value === n.color ? 'selected' : ''}>${label}</option>`).join('')}</select><small>${n.cardId ? 'Liée à la carte' : 'Note libre'}</small></footer></article>`;
    }).join('');
  }
  function updateNotePositions() {
    for (const n of workspace.notes ?? []) {
      const point = notePosition(n, workspace), el = get(`[data-note="${n.id}"]`);
      el.style.left = `${point.x}px`; el.style.top = `${point.y}px`;
    }
  }
  function finishNoteEdit() {
    if (!noteEditing) return;
    noteEditing = undefined; history.commit(); persist();
  }
  function beginNoteEdit(id: string) {
    if (noteEditing === id) return;
    checkpoint(); history.begin('Modifier une note'); noteEditing = id;
  }
  function addNote(cardId?: string) {
    let id = '';
    edit(cardId ? 'Créer une note liée' : 'Créer une note', () => {
      const count = (workspace.notes ?? []).filter(n => n.cardId === cardId).length;
      const point = cardId ? { x: 190, y: count * 36 } : { x: center().x - NOTE_WIDTH / 2, y: center().y - NOTE_HEIGHT / 2 };
      id = createNote(workspace, point, cardId).id;
    });
    const note = workspace.notes?.find(n => n.id === id);
    if (note) {
      const point = notePosition(note, workspace), zoom = Math.max(.65, workspace.camera.zoom);
      Object.assign(workspace.camera, { zoom, x: canvas.clientWidth / 2 - (point.x + NOTE_WIDTH / 2) * zoom,
        y: canvas.clientHeight / 2 - (point.y + NOTE_HEIGHT / 2) * zoom });
      camera(); get<HTMLTextAreaElement>(`[data-note-text="${id}"]`).focus();
    }
  }
  root.addEventListener('focusin', e => {
    const id = (e.target as HTMLTextAreaElement).dataset.noteText;
    if (id) beginNoteEdit(id);
  }, {signal: abort.signal});
  root.addEventListener('focusout', e => { if ((e.target as HTMLElement).dataset.noteText) finishNoteEdit(); }, {signal: abort.signal});
  root.addEventListener('input', e => {
    const input = e.target as HTMLTextAreaElement, note = workspace.notes?.find(n => n.id === input.dataset.noteText);
    if (!note) return;
    beginNoteEdit(note.id); note.text = input.value.slice(0,4000); persist();
  }, {signal: abort.signal});
  function updateZoneCounts() {
    for (const z of workspace.zones) {
      const count = rows.filter(r => r.placement.zoneId === z.id).reduce((n,r)=>n+r.entry.quantity,0);
      const el = get(`[data-dt-zone="${z.id}"]`);
      el.querySelector<HTMLElement>('[data-zone-count]')!.textContent = String(count);
      el.querySelector<HTMLElement>('[data-zone-count]')!.title = `${count} cartes`;
      el.classList.toggle('is-empty', count === 0);
      Object.assign(el.style, { left: `${z.x}px`, top: `${z.y}px`, width: `${z.width}px`, height: `${z.height}px` });
    }
  }
  function highlightZone(point?: Point) {
    const target = point ? zoneAt(workspace, point) : undefined;
    for (const el of root.querySelectorAll<HTMLElement>('[data-dt-zone]')) el.classList.toggle('is-drop-target', el.dataset.dtZone === target?.id);
    return target;
  }
  function local(e: {clientX:number;clientY:number}): Point { const b=canvas.getBoundingClientRect(); return {x:e.clientX-b.left,y:e.clientY-b.top}; }
  function center(): Point { return screenToWorld({x:canvas.clientWidth/2,y:canvas.clientHeight/2},workspace.camera); }
  function fit(deckOnly=false) {
    const points = rows.filter(r=>!deckOnly || !r.group.maybeboard).map(r=>({x:r.placement.x,y:r.placement.y,width:170,height:265}));
    points.push(...(workspace.piles ?? []).filter(p=>!deckOnly || pileRows(p,rows).some(r=>!r.group.maybeboard)).map(p=>pileBounds(p,rows)));
    if (!deckOnly) { points.push(...workspace.zones); points.push(...(workspace.notes ?? []).map(n => ({...notePosition(n,workspace),width:NOTE_WIDTH,height:NOTE_HEIGHT}))); }
    if (!points.length) { Object.assign(workspace.camera,emptyWorkspace().camera); camera(); persist(); return; }
    const x=Math.min(...points.map(p=>p.x)), y=Math.min(...points.map(p=>p.y));
    const w=Math.max(...points.map(p=>p.x+p.width))-x, h=Math.max(...points.map(p=>p.y+p.height))-y;
    const zoom=Math.max(.08,Math.min(1.2,(canvas.clientWidth-100)/w,(canvas.clientHeight-100)/h));
    Object.assign(workspace.camera,{zoom,x:(canvas.clientWidth-w*zoom)/2-x*zoom,y:(canvas.clientHeight-h*zoom)/2-y*zoom}); camera(); persist();
  }
  function addCandidate(card: LabCard, point=center(), zoneId?: string) {
    let row=rows.find(r=>r.entry.card.name===card.name);
    if (row) { selected.clear(); selected.add(row.placement.id); selection(); get('.dt-search-status').textContent='Already on the table. Selected the existing card.'; return; }
    edit('Ajouter un candidat', () => {
    let group=sheet.groups.find(g=>g.maybeboard && g.name==='Candidates');
    if (!group) {group={name:'Candidates',maybeboard:true,entries:[]};sheet.groups.push(group);}
    group.entries.push({card,quantity:1});
    rows=reconcileWorkspace(sheet,workspace); row=rows.find(r=>r.entry.card===card)!;
    Object.assign(row.placement,point); assignZone([row],zoneId ?? zoneAt(workspace,point)?.id); selected.clear();selected.add(row.placement.id);
    });
  }
  let nextOffset: number | null = null;
  let searchQuery: {query?:string;raw?:string} = {};
  async function search(append=false) {
    searchAbort?.abort(); const controller=searchAbort=new AbortController();
    if (!append) {
      const input=get<HTMLInputElement>('.dt-search-form input');
      searchQuery=get<HTMLInputElement>('[name=advanced]').checked ? {raw:input.value.trim()} : {query:input.value.trim()};
      results=[];get('.dt-search-results').innerHTML=''; nextOffset=null;
    }
    get('[data-dt=more]').hidden=true; get('.dt-search-status').textContent='Searching…';
    try {
      const data=await apiRequest<LabSearchResult>('/cards/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...searchQuery,offset:append?nextOffset:0,limit:24}),signal:controller.signal});
      if(disposed || controller.signal.aborted)return;
      const start=results.length; results.push(...data.cards);nextOffset=data.nextOffset;
      get('.dt-search-results').insertAdjacentHTML('beforeend',data.cards.map((c,i)=>`<button draggable="true" data-result="${start+i}" aria-label="Place ${esc(c.name)} as candidate">${c.image?`<img src="${esc(c.image)}" alt="" loading="lazy">`:''}<span>${esc(c.name)}</span></button>`).join(''));
      get('.dt-search-status').textContent=`${data.total} results · ${results.length} shown`; get('[data-dt=more]').hidden=nextOffset===null;
    } catch(error) { if(!controller.signal.aborted && !disposed)get('.dt-search-status').textContent=error instanceof Error?error.message:'Search failed'; }
  }
  root.addEventListener('submit',e=>{
    e.preventDefault(); const form=e.target as HTMLFormElement;
    if(form.matches('.dt-search-form'))void search();
    if(form.matches('.dt-pile-form')) {
      const name=form.querySelector('input')!.value;
      if(selected.size<2)return;
      edit('Créer une pile',()=>{createPile(workspace,rows,selected,name);selected.clear();});
      get<HTMLDetailsElement>('.dt-new-pile').open=false;canvas.focus();
    }
    if(form.matches('.dt-zone-form')){const input=form.querySelector('input')!;const name=input.value.trim();if(!name)return; edit('Créer une zone', () => { const point=center(); workspace.zones.push(createZone(name,{x:point.x-125,y:point.y-157})); });get<HTMLDetailsElement>('.dt-create').open=false;canvas.focus();}
  },{signal:abort.signal});
  root.addEventListener('click',e=>{
    const target=(e.target as HTMLElement).closest<HTMLElement>('button');if(!target)return;
    if(target.dataset.result!==undefined)addCandidate(results[Number(target.dataset.result)]!);
    if(target.dataset.deleteZone && !workspace.zones.find(z=>z.id===target.dataset.deleteZone)?.locked)edit('Supprimer une zone', () => {assignZone(rows.filter(r=>r.placement.zoneId===target.dataset.deleteZone),undefined);workspace.zones=workspace.zones.filter(z=>z.id!==target.dataset.deleteZone);});
    const zone=workspace.zones.find(z=>z.id===target.dataset.zone);
    if(zone && target.dataset.zoneAction==='lock')edit(zone.locked?'Déverrouiller une zone':'Verrouiller une zone',()=>{zone.locked=!zone.locked;});
    if(zone && !zone.locked && target.dataset.zoneAction==='fit')edit('Ajuster une zone aux cartes',()=>{zone.sizing='auto';});
    if(zone && !zone.locked && target.dataset.zoneAction==='arrange')edit('Ranger les cartes d’une zone',()=>{arrangeZone(workspace,zone,rows);});
    const pile=workspace.piles?.find(p=>p.id===target.dataset.pile);
    if(pile && target.dataset.pileAction==='toggle')edit(pile.expanded?'Réduire une pile':'Déplier une pile',()=>{pile.expanded=!pile.expanded;arrangePile(workspace,pile,rows);});
    if(pile && target.dataset.pileAction==='dissolve')edit('Dissoudre une pile',()=>{dissolvePile(workspace,pile,rows);});
    if(pile && target.dataset.pileAction==='select'){selected.clear();pile.cardIds.forEach(id=>selected.add(id));selection();}

    const note=workspace.notes?.find(n=>n.id===target.dataset.noteId);
    if(note && target.dataset.noteAction==='delete')edit('Supprimer une note',()=>{workspace.notes=workspace.notes?.filter(n=>n.id!==note.id);});
    if(note && target.dataset.noteAction==='detach')edit('Détacher une note',()=>{detachNote(note,workspace);});
    const action=target.dataset.dt;
    const selectedRow=selected.size===1?rows.find(r=>selected.has(r.placement.id)):undefined;
    if(action==='note')addNote();
    if(action==='card-note' && selectedRow)addNote(selectedRow.placement.id);
    if(action==='tags' && selected.size){checkpoint();options.tags?.(rows.filter(r=>selected.has(r.placement.id)).map(r=>r.entry.card.name));}
    if(action==='inspect' && selectedRow){checkpoint();options.inspect(selectedRow.entry.card,selectedRow.placement.id);}
    if(action==='legacy')options.legacy();
    if(action==='library')options.library();
    if(action) get<HTMLDetailsElement>('.dt-menu').open=false;
    if(action==='fit'||action==='deck')fit(action==='deck');
    if(action==='search'||action==='analysis') {const panel=get(`.dt-${action}`);panel.hidden=!panel.hidden;const other=action==='search'?'analysis':'search';get(`.dt-${other}`).hidden=true;get(`[data-dt=${other}]`).setAttribute('aria-expanded','false');get(`[data-dt=${action}]`).setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)panel.querySelector<HTMLElement>('input,button')?.focus();else canvas.focus();}
    if(action==='pan'){panTool=!panTool;target.setAttribute('aria-pressed',String(panTool));updatePanCursor();}
    if(action==='in'||action==='out'){zoomAt(workspace.camera,{x:canvas.clientWidth/2,y:canvas.clientHeight/2},workspace.camera.zoom*(action==='in'?1.25:.8));camera();persist();}
    if(action==='clear'){selected.clear();selection();}
    if(action==='include'||action==='exclude')edit(action==='include' ? 'Inclure les cartes dans le deck' : 'Mettre les cartes de côté', () => {for(const row of rows.filter(r=>selected.has(r.placement.id)))setRowMembership(sheet,row,action==='include');});
    if(action==='more')void search(true);
    // Keyboard-generated clicks select cards; pointer selection is handled on pointerdown.
    if(target.dataset.dtCard && (e as MouseEvent).detail===0){if(!(e as MouseEvent).shiftKey)selected.clear();selected.add(target.dataset.dtCard);selection();}
  },{signal:abort.signal});
  root.addEventListener('change',e=>{
    const input=e.target as HTMLInputElement;
    const note=workspace.notes?.find(n=>n.id===input.dataset.noteColor);
    if(note && ['sand','sage','lavender'].includes(input.value)){edit('Changer la couleur d’une note',()=>{note.color=input.value as typeof note.color;});return;}
    if(input.matches('[data-dt-quantity]')) {
      const row=rows.find(r=>selected.has(r.placement.id)), quantity=Number(input.value);
      if(!row || selected.size!==1)return;
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>999){input.value=String(row.entry.quantity);return;}
      edit('Modifier une quantité',()=>{row.entry.quantity=quantity;});return;
    }
    if(input.matches('[data-add-to-pile]')) {
      const pile=workspace.piles?.find(p=>p.id===input.value);
      if(pile)edit('Ajouter les cartes à une pile',()=>{addToPile(workspace,pile,rows,selected);});return;
    }
    const pile=input.closest<HTMLElement>('[data-dt-pile]');
    if(pile && input.matches('input')) {
      const p=workspace.piles?.find(p=>p.id===pile.dataset.dtPile);if(p)edit('Renommer une pile',()=>{p.name=input.value.trim()||p.name;});return;
    }
    const zone=input.closest<HTMLElement>('[data-dt-zone]');if(!zone || !input.matches('input'))return;
    const z=workspace.zones.find(z=>z.id===zone.dataset.dtZone)!;
    if(!z.locked)edit('Renommer une zone',()=>{z.name=input.value.trim()||z.name;});
  },{signal:abort.signal});
  canvas.addEventListener('dblclick',e=>{const el=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-dt-card]');const row=rows.find(r=>r.placement.id===el?.dataset.dtCard);if(row){checkpoint();options.inspect(row.entry.card,row.placement.id);}},{signal:abort.signal});
  canvas.addEventListener('wheel',e=>{e.preventDefault();if(gesture)return;zoomAt(workspace.camera,local(e),workspace.camera.zoom*Math.exp(-e.deltaY*(e.deltaMode===1?.04:.0015)));camera();persist();},{passive:false,signal:abort.signal});
  canvas.addEventListener('pointerdown',e=>{
    if(gesture || (e.button!==0 && e.button!==1))return;
    const target=e.target as HTMLElement;
    if(target.closest('input,textarea,select,[data-delete-zone],[data-zone-action],[data-pile-action],[data-note-action]'))return;
    const start=local(e),pan=e.ctrlKey||space||panTool||e.button===1;
    const card=target.closest<HTMLElement>('[data-dt-card]'),zoneEl=target.closest<HTMLElement>('[data-dt-zone]'),pileEl=target.closest<HTMLElement>('[data-dt-pile]');
    const note=workspace.notes?.find(n=>n.id===target.closest<HTMLElement>('[data-note]')?.dataset.note);
    const zone=workspace.zones.find(z=>z.id===zoneEl?.dataset.dtZone);
    if(zone?.locked && !pan)return;
    const pile=workspace.piles?.find(p=>p.id===pileEl?.dataset.dtPile);
    const resizing=!pan && target.closest('[data-resize-zone]') && zone ? {zone,width:zone.width,height:zone.height}:undefined;
    e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);
    const selectedBefore=[...selected],positions: {point:Point;x:number;y:number}[]=[];
    if(!pan && card){const id=card.dataset.dtCard!;if(e.shiftKey && selected.has(id))selected.delete(id);else{if(!e.shiftKey && !selected.has(id))selected.clear();selected.add(id);}for(const row of rows.filter(r=>selected.has(r.placement.id)))positions.push({point:row.placement,x:row.placement.x,y:row.placement.y});selection();}
    if(!pan && pile){positions.push({point:pile,x:pile.x,y:pile.y});selected.clear();for(const row of pileRows(pile,rows)){positions.push({point:row.placement,x:row.placement.x,y:row.placement.y});selected.add(row.placement.id);}selection();}
    if(!pan && zone && !card && !resizing){
      positions.push({point:zone,x:zone.x,y:zone.y});
      for(const row of rows.filter(r=>r.placement.zoneId===zone.id))positions.push({point:row.placement,x:row.placement.x,y:row.placement.y});
      for(const p of workspace.piles ?? [])if(pileRows(p,rows).every(r=>r.placement.zoneId===zone.id))positions.push({point:p,x:p.x,y:p.y});
    }
    if(!pan && note)positions.push({point:note,x:note.x,y:note.y});
    const lasso=!pan&&!card&&!zone&&!pile&&!note;
    if(lasso&&!e.shiftKey){selected.clear();selection();}
    if(!pan && (positions.length || resizing))history.begin(note?'Déplacer une note':resizing?'Redimensionner une zone':pile?'Déplacer une pile':card?'Déplacer les cartes':'Déplacer une zone');
    gesture={pointer:e.pointerId,start,last:start,camera:{...workspace.camera},positions,pan,lasso,additive:e.shiftKey,cards:!pan&&!!card&&positions.length>0,moved:false,selection:selectedBefore,raised:false,note:!pan?note?.id:undefined,pile:!pan?pile?.id:undefined,resize:resizing};
  },{signal:abort.signal});
  function moveGesture(e: PointerEvent) {
    if(!gesture || e.pointerId!==gesture.pointer)return;const p=local(e),dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;
    gesture.last=p;
    if(Math.hypot(dx,dy)>3)gesture.moved=true;
    if(!gesture.moved)return;
    if((gesture.cards || gesture.pile) && !gesture.raised) {
      const moving=new Set(gesture.positions.map(item=>item.point));
      if(gesture.cards){detachPileCards(workspace,rows.filter(r=>moving.has(r.placement)).map(r=>r.placement.id));render();}
      gesture.raised=true;let z=Math.max(0,...workspace.cards.map(p=>p.z));
      for(const row of rows.filter(r=>moving.has(r.placement))){row.placement.z=++z;get(`[data-dt-card="${row.placement.id}"]`).style.zIndex=String(z);}
    }
    if(gesture.resize){resizeZone(gesture.resize.zone,gesture.resize.width+dx/workspace.camera.zoom,gesture.resize.height+dy/workspace.camera.zoom);updateZoneCounts();}
    else if(gesture.pan){workspace.camera.x=gesture.camera.x+dx;workspace.camera.y=gesture.camera.y+dy;camera();}
    else if(gesture.lasso){const box=get('.dt-lasso');box.hidden=false;Object.assign(box.style,{left:`${Math.min(p.x,gesture.start.x)}px`,top:`${Math.min(p.y,gesture.start.y)}px`,width:`${Math.abs(dx)}px`,height:`${Math.abs(dy)}px`});}
    else {for(const item of gesture.positions){item.point.x=item.x+dx/workspace.camera.zoom;item.point.y=item.y+dy/workspace.camera.zoom;}for(const row of rows){const el=get(`[data-dt-card="${row.placement.id}"]`);el.style.left=`${row.placement.x}px`;el.style.top=`${row.placement.y}px`;}for(const z of workspace.zones){const el=get(`[data-dt-zone="${z.id}"]`);Object.assign(el.style,{left:`${z.x}px`,top:`${z.y}px`,width:`${z.width}px`,height:`${z.height}px`});}updatePilePositions();updateNotePositions();updateZoneCounts();if(gesture.cards && gesture.moved)highlightZone(screenToWorld(p,workspace.camera));}
  }
  canvas.addEventListener('pointermove',moveGesture,{signal:abort.signal});
  function finishGesture() {
    if (!gesture) return;
    const completed = gesture;
    gesture = undefined;
    if ((completed.cards || completed.pile) && completed.moved) {
      const target = zoneAt(workspace, screenToWorld(completed.last, workspace.camera));
      const moved = new Set(completed.positions.map(item => item.point));
      assignZone(rows.filter(row => moved.has(row.placement)), target?.id);
    } else if (completed.lasso) {
      const a = screenToWorld(completed.start, workspace.camera), b = screenToWorld(completed.last, workspace.camera);
      if (!completed.additive) selected.clear();
      if (completed.moved) for (const pile of workspace.piles ?? []) {
        const p=pileBounds(pile,rows);
        if(p.x+p.width>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y+p.height>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y))pile.cardIds.forEach(id=>selected.add(id));
      }
      if (completed.moved) for (const row of rows.filter(r=>!pileFor(workspace,r.placement.id))) {
        const p = row.placement;
        if (p.x+170 >= Math.min(a.x,b.x) && p.x <= Math.max(a.x,b.x) && p.y+238 >= Math.min(a.y,b.y) && p.y <= Math.max(a.y,b.y)) selected.add(p.id);
      }
    }
    get('.dt-lasso').hidden = true; highlightZone();
    fitZones(workspace, rows); updateZoneCounts(); selection(); camera();
    if (history.state.editing) history.commit();
    persist();
    if (canvas.hasPointerCapture(completed.pointer)) canvas.releasePointerCapture(completed.pointer);
    // Keep card nodes intact so pointer capture and native double-click still work.
    for (const row of rows) {
      const el = get(`[data-dt-card="${row.placement.id}"]`);
      el.style.left = `${row.placement.x}px`; el.style.top = `${row.placement.y}px`;
    }
  }
  function cancelGesture(): boolean {
    if (!gesture) return false;
    const canceled = gesture; gesture = undefined;
    if (history.state.editing) history.cancel();
    if (canceled.pan) Object.assign(workspace.camera, canceled.camera);
    selected.clear(); for (const id of canceled.selection) selected.add(id);
    get('.dt-lasso').hidden = true; highlightZone();
    if (canvas.hasPointerCapture(canceled.pointer)) canvas.releasePointerCapture(canceled.pointer);
    render(); persist(); return true;
  }
  function updatePilePositions(){for(const p of workspace.piles ?? []){const el=get(`[data-dt-pile="${p.id}"]`);el.style.left=`${p.x}px`;el.style.top=`${p.y}px`;el.style.zIndex=String(Math.max(0,...pileRows(p,rows).map(r=>r.placement.z)));}}
  function checkpoint() { finishNoteEdit(); if (gesture) finishGesture(); else persist(); }
  canvas.addEventListener('pointerup',e=>{if(gesture?.pointer===e.pointerId){moveGesture(e);finishGesture();}},{signal:abort.signal});
  canvas.addEventListener('pointercancel',e=>{if(gesture?.pointer===e.pointerId)cancelGesture();},{signal:abort.signal});
  canvas.addEventListener('lostpointercapture',e=>{if(gesture?.pointer===e.pointerId)cancelGesture();},{signal:abort.signal});
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape' && noteEditing){e.preventDefault();e.stopPropagation();noteEditing=undefined;history.cancel();render();persist();canvas.focus();return;}
    if((e.target as HTMLElement).closest('input,textarea,select'))return;
    if(e.key.toLowerCase()==='i'&&!e.ctrlKey&&!e.metaKey&&!e.altKey && selected.size===1){const row=rows.find(r=>selected.has(r.placement.id));if(row){e.preventDefault();checkpoint();options.inspect(row.entry.card,row.placement.id);}return;}
    const zone=workspace.zones.find(z=>z.id===(e.target as HTMLElement).closest<HTMLElement>('[data-resize-zone]')?.dataset.resizeZone);
    if(zone && !zone.locked && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();const step=e.shiftKey?50:10;
      edit('Redimensionner une zone',()=>{resizeZone(zone,zone.width+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),zone.height+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0));});
      get(`[data-resize-zone="${zone.id}"]`).focus();return;
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();if(gesture)return;selected.clear();rows.forEach(r=>selected.add(r.placement.id));selection();return;}
    if(e.key==='Escape' && gesture){e.preventDefault();e.stopPropagation();cancelGesture();return;}
    if(e.code==='Space'){e.preventDefault();space=true;updatePanCursor();}
    if(e.key.toLowerCase()==='f'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();fit();}
    if(e.key==='Escape'){selected.clear();selection();get('.dt-analysis').hidden=true;get('.dt-search').hidden=true;get<HTMLDetailsElement>('.dt-menu').open=false;get<HTMLDetailsElement>('.dt-create').open=false;canvas.focus();}
  },{signal:abort.signal});
  window.addEventListener('keydown',e=>{if(e.key==='Control'){control=true;updatePanCursor();}},{signal:abort.signal});
  window.addEventListener('keyup',e=>{control=e.ctrlKey;if(e.code==='Space')space=false;updatePanCursor();},{signal:abort.signal});
  window.addEventListener('blur',()=>{cancelGesture();space=false;control=false;updatePanCursor();},{signal:abort.signal});
  root.addEventListener('dragstart',e=>{const el=(e.target as HTMLElement).closest<HTMLElement>('[data-result]');if(el)e.dataTransfer?.setData('application/x-asphodel-card',el.dataset.result!);},{signal:abort.signal});
  canvas.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('application/x-asphodel-card')){e.preventDefault();highlightZone(screenToWorld(local(e),workspace.camera));}},{signal:abort.signal});
  canvas.addEventListener('dragleave',e=>{if(!canvas.contains(e.relatedTarget as Node))highlightZone();},{signal:abort.signal});
  root.addEventListener('dragend',()=>highlightZone(),{signal:abort.signal});
  canvas.addEventListener('drop',e=>{e.preventDefault();const value=e.dataTransfer?.getData('application/x-asphodel-card');if(value===undefined||value==='')return;const card=results[Number(value)];if(card){const point=screenToWorld(local(e),workspace.camera);addCandidate(card,point,zoneAt(workspace,point)?.id);}highlightZone();},{signal:abort.signal});
  root.addEventListener('pointerdown',e=>{
    if(!(e.target as HTMLElement).closest('.dt-create')) get<HTMLDetailsElement>('.dt-create').open=false;
    if(!(e.target as HTMLElement).closest('.dt-menu')) get<HTMLDetailsElement>('.dt-menu').open=false;
  },{signal:abort.signal});
  render(); persist();
  return { addNote, refreshAnalysis(){analysis();}, refresh(){render();persist();}, cancelGesture, checkpoint, dispose(){checkpoint();disposed=true;abort.abort();searchAbort?.abort();} };
}
