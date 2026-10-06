import { apiRequest } from '../api/api-client';
import type { LabCard, LabSearchResult } from '../../../shared/deck-lab';
import type { ProjectHistory } from './project-history';
import { deckStatistics, type Sheet } from './deck-model';
import { assignZone, createZone, fitZones, initializeZones, zoneAt, emptyWorkspace, reconcileWorkspace, screenToWorld, setRowMembership, zoomAt, type Point, type Row, type Workspace } from './deck-workspace';
import './deck-table.css';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Options = { history: ProjectHistory; changed: () => void; inspect: (card: LabCard) => void; legacy: () => void; library: () => void };

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
  let results: LabCard[] = [];
  let space = false;
  let disposed = false;
  let gesture: { pointer: number; start: Point; camera: Point; positions: { point: Point; x: number; y: number }[]; pan: boolean; lasso: boolean; additive: boolean; cards: boolean; moved: boolean; last: Point; selection: string[]; raised: boolean } | undefined;
  root.innerHTML = `<div class="dt-heading"><h2 title="${esc(sheet.name)}">${esc(sheet.name)}</h2><span data-dt-count></span>
    <details class="dt-create"><summary>+ Zone</summary><form class="dt-zone-form"><label for="dt-zone-name">Nouvelle zone</label><input id="dt-zone-name" aria-label="New zone name" placeholder="Ramp, Draw, À tester…" maxlength="60" required><button>Create zone</button><small>Le contour s’adapte aux cartes déposées.</small></form></details>
    <div class="dt-history"><button type="button" data-history="undo" aria-label="Annuler">↶</button><button type="button" data-history="redo" aria-label="Rétablir">↷</button></div>
    <button data-dt="search" aria-expanded="false">Search</button><button data-dt="analysis" aria-expanded="false">Analyse</button>
    <details class="dt-menu"><summary aria-label="Table tools">•••</summary><div class="dt-menu-content"><button data-action="export-deck">Exporter le deck</button><button data-dt="library">Tous les decks</button><button data-dt="legacy">Builder V1</button><button data-action="selection">Selection</button><button data-dt="deck">Center deck</button><button data-dt="pan" aria-pressed="false">Pan tool</button><p>Ctrl / Espace + glisser : déplacer la vue<br>Shift + clic : sélectionner plusieurs cartes<br>Glisser sur le vide : sélectionner une zone<br>Échap : annuler le geste en cours<br>Ctrl+Z : annuler · Ctrl+Maj+Z / Ctrl+Y : rétablir<br>Molette : zoom · F : tout voir<br>Double clic : inspecter une carte</p></div></details></div>
    <div class="dt-body"><div class="dt-canvas" tabindex="0" aria-label="Deck table. Drag cards to move. Shift click to select several. Control or Space drag to pan. Wheel to zoom."><div class="dt-world"><div class="dt-zones"></div><div class="dt-cards"></div></div><div class="dt-lasso" hidden></div><p class="dt-empty" hidden>Room to think. Search for cards and place your first ideas.</p></div>
    <aside class="dt-panel dt-search" hidden><header><h3>Find cards</h3><button data-dt="search" aria-label="Close search">✕</button></header><form class="dt-search-form"><input aria-label="Table card search" placeholder="Name or Oracle text…"><label><input type="checkbox" name="advanced"> Advanced syntax</label><button>Search catalog</button></form><p class="dt-search-status" role="status"></p><div class="dt-search-results"></div><button data-dt="more" hidden>Load more</button><small>Click or drag a result onto the table. It starts as a candidate.</small></aside>
    <aside class="dt-panel dt-analysis" hidden aria-label="Deck analysis"><header><h3>Analyse</h3><button data-dt="analysis" aria-label="Close analysis">✕</button></header><div class="dt-analysis-content"></div></aside></div>
    <div class="dt-tools"><button data-dt="fit">Show all · F</button><button data-dt="out" aria-label="Zoom out">−</button><span data-dt-zoom></span><button data-dt="in" aria-label="Zoom in">+</button></div>
    <div class="dt-selection" hidden><span data-dt-selected>0 selected</span><label class="dt-quantity">Quantité <input type="number" min="1" max="999" step="1" data-dt-quantity aria-label="Quantité de la carte sélectionnée"></label><button data-dt="exclude">Set aside</button><button data-dt="include">Add to deck</button><button data-dt="clear" aria-label="Clear selection">✕</button></div>
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
    get('.dt-analysis-content').innerHTML = `<p>${stats.total} cards in deck · candidates and cuts excluded</p><h4>Types</h4><div class="dt-stat-list">${list(stats.types)}</div><h4>Mana curve · nonlands</h4><div class="lab-curve">${stats.curve.map((n,i) => `<div><span>${n}</span><i style="height:${n/Math.max(...stats.curve,1)*100}px"></i><label>${i===7?'7+':i}</label></div>`).join('')}</div><p>Average mana value: ${stats.spells ? stats.average.toFixed(2) : '—'}</p><h4>Color identity · overlaps</h4><div class="dt-stat-list">${list(['W','U','B','R','G'].map(name => ({name,count:stats.entries.filter(e=>e.card.color_identity.includes(name)).reduce((n,e)=>n+e.quantity,0)})))}</div><h4>Existing categories / roles</h4><div class="dt-stat-list">${list(sheet.groups.filter(g=>!g.maybeboard).map(g=>({name:g.name,count:g.entries.reduce((n,e)=>n+e.quantity,0)})))}</div><p>Spatial zones never change roles. Multiple functional tags and mana-source analysis are not yet available.</p>`;
  }
  function render() {
    rows = reconcileWorkspace(sheet, workspace);
    initializeZones(workspace, rows, fresh);
    fitZones(workspace, rows);
    for (const id of selected) if (!rows.some(r => r.placement.id === id)) selected.delete(id);
    get('.dt-cards').innerHTML = rows.map(r => `<button class="dt-card ${r.group.maybeboard ? 'is-aside' : ''}" data-dt-card="${r.placement.id}" style="left:${r.placement.x}px;top:${r.placement.y}px;z-index:${r.placement.z}" aria-label="${esc(r.entry.card.name)} · ${r.entry.quantity} · ${r.group.maybeboard?'outside deck':'in deck'}" aria-pressed="false">${r.entry.card.image ? `<img draggable="false" src="${esc(r.entry.card.image)}" alt="${esc(r.entry.card.name)}" loading="lazy">` : `<span class="dt-fallback">${esc(r.entry.card.name)}</span>`}<span class="dt-card-label">${esc(r.entry.card.name)}</span><span class="dt-badge">${r.entry.quantity > 1 ? `×${r.entry.quantity} · ` : ''}${r.group.maybeboard ? r.placement.cut ? 'Cut' : 'Candidate' : r.group.commander ? 'Commander' : 'In deck'}</span></button>`).join('');
    get('.dt-zones').innerHTML = workspace.zones.map(z => `<section class="dt-zone" data-dt-zone="${z.id}" style="left:${z.x}px;top:${z.y}px;width:${z.width}px;height:${z.height}px"><header><input aria-label="Zone name" maxlength="60" value="${esc(z.name)}"><span data-zone-count></span><button data-delete-zone="${z.id}" aria-label="Delete zone ${esc(z.name)}">×</button></header><span class="dt-zone-empty">Déposer des cartes ici</span></section>`).join('');
    get('.dt-empty').hidden = rows.length > 0;
    updateZoneCounts(); selection(); analysis(); camera();
    if (needsInitialFit && canvas.clientWidth > 0) { needsInitialFit = false; fit(); }
  }
  function edit(label: string, mutate: () => void) {
    checkpoint(); history.begin(label);
    try { mutate(); render(); history.commit(); persist(); }
    catch (error) { history.cancel(); render(); persist(); get('[data-dt-storage]').textContent = error instanceof Error ? error.message : 'Modification impossible.'; }
  }
  function updateZoneCounts() {
    for (const z of workspace.zones) {
      const count = rows.filter(r => r.placement.zoneId === z.id).reduce((n,r)=>n+r.entry.quantity,0);
      const el = get(`[data-dt-zone="${z.id}"]`);
      el.querySelector('[data-zone-count]')!.textContent = `${count} cards`;
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
    if (!deckOnly) points.push(...workspace.zones);
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
    if(form.matches('.dt-zone-form')){const input=form.querySelector('input')!;const name=input.value.trim();if(!name)return; edit('Créer une zone', () => { const point=center(); workspace.zones.push(createZone(name,{x:point.x-125,y:point.y-157})); });get<HTMLDetailsElement>('.dt-create').open=false;canvas.focus();}
  },{signal:abort.signal});
  root.addEventListener('click',e=>{
    const target=(e.target as HTMLElement).closest<HTMLElement>('button');if(!target)return;
    if(target.dataset.result!==undefined)addCandidate(results[Number(target.dataset.result)]!);
    if(target.dataset.deleteZone)edit('Supprimer une zone', () => {assignZone(rows.filter(r=>r.placement.zoneId===target.dataset.deleteZone),undefined);workspace.zones=workspace.zones.filter(z=>z.id!==target.dataset.deleteZone);});
    const action=target.dataset.dt;
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
    if(input.matches('[data-dt-quantity]')) {
      const row=rows.find(r=>selected.has(r.placement.id)), quantity=Number(input.value);
      if(!row || selected.size!==1)return;
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>999){input.value=String(row.entry.quantity);return;}
      edit('Modifier une quantité',()=>{row.entry.quantity=quantity;});return;
    }
    const zone=input.closest<HTMLElement>('[data-dt-zone]');if(!zone || !input.matches('input'))return;
    const z=workspace.zones.find(z=>z.id===zone.dataset.dtZone)!;
    edit('Renommer une zone',()=>{z.name=input.value.trim()||z.name;});
  },{signal:abort.signal});
  canvas.addEventListener('dblclick',e=>{const el=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-dt-card]');const row=rows.find(r=>r.placement.id===el?.dataset.dtCard);if(row)options.inspect(row.entry.card);},{signal:abort.signal});
  canvas.addEventListener('wheel',e=>{e.preventDefault();if(gesture)return;zoomAt(workspace.camera,local(e),workspace.camera.zoom*Math.exp(-e.deltaY*(e.deltaMode===1?.04:.0015)));camera();persist();},{passive:false,signal:abort.signal});
  canvas.addEventListener('pointerdown',e=>{
    if(gesture || (e.button!==0 && e.button!==1))return;
    const target=e.target as HTMLElement;
    if(target.closest('input,[data-delete-zone]'))return;
    e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);
    const selectedBefore=[...selected];
    const start=local(e),pan=e.ctrlKey||space||panTool||e.button===1;
    const card=target.closest<HTMLElement>('[data-dt-card]');const zone=target.closest<HTMLElement>('[data-dt-zone]');
    const positions: {point:Point;x:number;y:number}[]=[];
    if(!pan && card){const id=card.dataset.dtCard!;if(e.shiftKey && selected.has(id))selected.delete(id);else{if(!e.shiftKey && !selected.has(id))selected.clear();selected.add(id);}for(const row of rows.filter(r=>selected.has(r.placement.id)))positions.push({point:row.placement,x:row.placement.x,y:row.placement.y});selection();}
    if(!pan && zone && !card){
      const z=workspace.zones.find(z=>z.id===zone.dataset.dtZone)!;
      positions.push({point:z,x:z.x,y:z.y});
      for(const row of rows.filter(r=>r.placement.zoneId===z.id)) positions.push({point:row.placement,x:row.placement.x,y:row.placement.y});
    }
    const lasso=!pan&&!card&&!zone;
    if(lasso&&!e.shiftKey){selected.clear();selection();}
    if(!pan && positions.length)history.begin(card ? 'Déplacer les cartes' : 'Déplacer une zone');
    gesture={pointer:e.pointerId,start,last:start,camera:{...workspace.camera},positions,pan,lasso,additive:e.shiftKey,cards:!pan&&!!card&&positions.length>0,moved:false,selection:selectedBefore,raised:false};
  },{signal:abort.signal});
  canvas.addEventListener('pointermove',e=>{
    if(!gesture || e.pointerId!==gesture.pointer)return;const p=local(e),dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;
    gesture.last=p;
    if(Math.hypot(dx,dy)>3)gesture.moved=true;
    if(!gesture.moved)return;
    if(gesture.cards && !gesture.raised) {
      gesture.raised=true;let z=Math.max(0,...workspace.cards.map(p=>p.z));
      for(const row of rows.filter(r=>selected.has(r.placement.id))){row.placement.z=++z;get(`[data-dt-card="${row.placement.id}"]`).style.zIndex=String(z);}
    }
    if(gesture.pan){workspace.camera.x=gesture.camera.x+dx;workspace.camera.y=gesture.camera.y+dy;camera();}
    else if(gesture.lasso){const box=get('.dt-lasso');box.hidden=false;Object.assign(box.style,{left:`${Math.min(p.x,gesture.start.x)}px`,top:`${Math.min(p.y,gesture.start.y)}px`,width:`${Math.abs(dx)}px`,height:`${Math.abs(dy)}px`});}
    else {for(const item of gesture.positions){item.point.x=item.x+dx/workspace.camera.zoom;item.point.y=item.y+dy/workspace.camera.zoom;}for(const row of rows){const el=get(`[data-dt-card="${row.placement.id}"]`);el.style.left=`${row.placement.x}px`;el.style.top=`${row.placement.y}px`;}for(const z of workspace.zones){const el=get(`[data-dt-zone="${z.id}"]`);Object.assign(el.style,{left:`${z.x}px`,top:`${z.y}px`,width:`${z.width}px`,height:`${z.height}px`});}updateZoneCounts();if(gesture.cards && gesture.moved)highlightZone(screenToWorld(p,workspace.camera));}
  },{signal:abort.signal});
  function finishGesture() {
    if (!gesture) return;
    const completed = gesture;
    gesture = undefined;
    if (completed.cards && completed.moved) {
      const target = zoneAt(workspace, screenToWorld(completed.last, workspace.camera));
      const moved = new Set(completed.positions.map(item => item.point));
      assignZone(rows.filter(row => moved.has(row.placement)), target?.id);
    } else if (completed.lasso) {
      const a = screenToWorld(completed.start, workspace.camera), b = screenToWorld(completed.last, workspace.camera);
      if (!completed.additive) selected.clear();
      if (completed.moved) for (const row of rows) {
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
  function checkpoint() { if (gesture) finishGesture(); else persist(); }
  canvas.addEventListener('pointerup',e=>{if(gesture?.pointer===e.pointerId)finishGesture();},{signal:abort.signal});
  canvas.addEventListener('pointercancel',e=>{if(gesture?.pointer===e.pointerId)cancelGesture();},{signal:abort.signal});
  canvas.addEventListener('lostpointercapture',e=>{if(gesture?.pointer===e.pointerId)cancelGesture();},{signal:abort.signal});
  root.addEventListener('keydown',e=>{
    if((e.target as HTMLElement).closest('input,textarea,select'))return;
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
  return { refresh(){render();persist();}, cancelGesture, checkpoint, dispose(){checkpoint();disposed=true;abort.abort();searchAbort?.abort();} };
}
