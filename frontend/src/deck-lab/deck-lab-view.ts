import { ProjectHistory, historyShortcut } from './project-history';
import { exportDeckText, deckTextFilename } from './deck-export';
import sampleCards from './cards.json';
import { apiRequest, ApiError } from '../api/api-client';
import { element } from '../dom';
import type { LabCard, LabCatalog, LabFace, LabSearchQuery, LabSearchResult } from '../../../shared/deck-lab';
import { initFilterCombobox } from './filter-combobox';
import './deck-lab.css';
import { deckStatistics, type Group, type Sheet } from './deck-model';
import { mountDeckTable } from './deck-table-view';
import { mountCardInspector, enrichInspection, type InspectionActions } from './card-inspector';
import { reconcileWorkspace, setRowMembership } from './deck-workspace';
import type { BuilderProject } from '../../../shared/builder-project.mjs';
import { loadDrafts, prepareProject, ProjectPersistence, sheetFromProject } from './project-persistence';
import { openDeckArtwork } from '../artwork-controls';
import { openTagEditor } from './tag-editor';
import { tagBadges, roleSummary } from './deck-tags';
import { CommanderCatalog } from './commander-catalog';
import { commanderSummary } from './commander-view';
import './commander.css';

type Card = LabCard;
/** `maybeboard` groups (born from the triage feature, or manually named "Maybeboard") hold cards
 *  that are deliberately excluded from the deck's card count and from what an actual game receives. */

/** `backendId` is set once a sheet corresponds to a persisted deck (created here, imported, or opened from the library) — its presence is what turns on auto-save. */

/** Every sheet is born with this pinned-first, unrenamable category — it's the one thing that tells the builder (and the backend, via `sheetToGroups`) which card(s) are the commander. */
const commanderGroup = (): Group => ({ name: 'Commander', entries: [], commander: true });
const MAYBEBOARD_NAME = 'Maybeboard';
const maybeGroup = (): Group => ({ name: MAYBEBOARD_NAME, entries: [], maybeboard: true });
/** Where cards land when they're added without picking a category explicitly (Selection transfer, cut restore) — the first non-Commander, non-Maybeboard group. */
const defaultGroup = (sheet: Sheet): Group => sheet.groups.find(g => !g.commander && !g.maybeboard) ?? sheet.groups[0]!;
/** True for lands allowed unlimited copies (Commander's singleton rule exemption) — everything else may only appear once anywhere in the sheet (see addCardToGroup). */
const isBasicLand = (card: Card): boolean => card.type_line.includes('Basic Land');
function findEntryAnywhere(sheet: Sheet, cardName: string): { group: Group; entry: { card: Card; quantity: number } } | undefined {
  for (const group of sheet.groups) {
    const entry = group.entries.find(e => e.card.name === cardName);
    if (entry) return { group, entry };
  }
  return undefined;
}

/** The four buckets triage sorts a category into, weakest to strongest — each becomes (or joins) a
 *  regular mainboard category by that name once the triage is applied (see applyTriage). */
const TRIAGE_CATEGORIES = [
  { key: 'notInteresting', label: 'Not interesting' },
  { key: 'situational', label: 'Situational' },
  { key: 'interesting', label: 'Interesting' },
  { key: 'mustHave', label: 'Must have' },
] as const;
type TriageCategoryKey = typeof TRIAGE_CATEGORIES[number]['key'];

type DeckSection = 'commander' | 'mainboard' | 'maybeboard';
interface DeckCardView { name: string; manaCost: string | null; manaValue: number; typeLine: string; oracleText: string | null; colorIdentity: string[]; imageUri: string | null; quantity: number; section: DeckSection; category: string; categoryPosition: number; }
interface DeckSummary { id: number; name: string; totalCards: number; commanders: { name: string; imageUri: string | null }[]; }
interface DeckDetailView { id: number; name: string; totalCards: number; cards: DeckCardView[]; project?: BuilderProject | null; }
/** The backend's deck cards are a flatter, camelCase shape (see backend/src/decks/deck-service.ts DeckCardView) —
 *  this fills in the Scryfall-shaped fields the Builder's rendering/stats code reads but the backend never stored. */
function deckCardToLabCard(c: DeckCardView): Card {
  return {
    name: c.name, mana_cost: c.manaCost, cmc: c.manaValue, type_line: c.typeLine, oracle_text: c.oracleText,
    power: null, toughness: null, loyalty: null, set_name: '', set: '', collector_number: '', rarity: '', lang: 'en',
    color_identity: c.colorIdentity, image: c.imageUri ?? '', related: [],
  };
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const mana = (s: string | null) => (s ?? '').replace(/\{([^}]+)\}/g, (_, x: string) => `<span class="lab-mana" data-color="${esc(x)}">${esc(x)}</span>`);
const cardImg = (c: {name: string; image: string}, w = 488, h = 680) => c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy" width="${w}" height="${h}" />` : `<div class="lab-no-image">${esc(c.name)}<span>Image unavailable</span></div>`;
const image = (c: Card) => cardImg(c);
const printingImage = (p: {image: string; set_name: string}) => cardImg({name: p.set_name, image: p.image}, 244, 340);
/** Wraps a card's art; when both faces have their own image (transform/MDFC), it becomes a click-to-flip button. */
function cardStage(c: {name: string; image: string; faces?: LabFace[]}): string {
  const faces = c.faces && c.faces.length >= 2 ? c.faces : undefined;
  if (!faces) return `<div class="lab-card-stage">${cardImg(c)}</div>`;
  return `<button type="button" class="lab-card-stage lab-flip-card" aria-pressed="false" aria-label="Flip ${esc(c.name)} to see the other side"><span class="lab-flip-inner"><span class="lab-flip-face lab-flip-front">${cardImg(faces[0]!)}</span><span class="lab-flip-face lab-flip-back">${cardImg(faces[1]!)}</span></span><span class="lab-flip-hint" aria-hidden="true">⟲</span></button>`;
}

const SELECTION_STORAGE_KEY = 'asphodel.deck-lab.selection.v1';
function loadStoredSelection(): { names: string[]; cards: Card[] } {
  try {
    const parsed = JSON.parse(localStorage.getItem(SELECTION_STORAGE_KEY) ?? '');
    if (Array.isArray(parsed?.names) && Array.isArray(parsed?.cards)) return parsed;
  } catch { /* no stored selection yet, or it's unreadable */ }
  return { names: [], cards: [] };
}

/** Decks and tables share one snapshot; local journals protect deferred writes. */
export function initDeckLabView(root: HTMLElement) {
  const selection = new Set<string>();
  const knownCards = new Map<string, Card>(sampleCards.map(c => [c.name, c]));
  const stored = loadStoredSelection();
  for (const card of stored.cards) knownCards.set(card.name, card);
  for (const name of stored.names) selection.add(name);
  function persistSelection() {
    try {
      const cards = [...knownCards.values()].filter(c => selection.has(c.name));
      localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify({ names: [...selection], cards }));
    } catch { /* storage unavailable (private mode, quota…): selection just stays session-only */ }
  }
  let resultCards: Card[] = [];
  let nextOffset: number | null = null;
  let total = 0;
  let requestVersion = 0;
  let requestController: AbortController | undefined;
  let loading = false;
  let activated = false;
  let catalogReady = false;
  let catalogLoading = false;
  let currentQuery: LabSearchQuery = {};
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let mode = 'images';
  let view = 'search';
  let query = '';
  let typeFilters: string[] = [];
  let setFilters: string[] = [];
  let addSearchDebounce: ReturnType<typeof setTimeout> | undefined;
  let addSearchController: AbortController | undefined;
  let savedDecks: DeckSummary[] = [];

  let triage: { groupIndex: number; queue: { card: Card; quantity: number }[]; position: number; buckets: Record<TriageCategoryKey, { card: Card; quantity: number }[]> } | undefined;
  const filterField = (label: string, kind: string, placeholder: string) => `<div class="lab-filter-combobox" data-filter="${kind}"><label for="lab-filter-${kind}">${label}</label><div class="lab-filter-chips"></div><input id="lab-filter-${kind}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="lab-options-${kind}" autocomplete="off" placeholder="${placeholder}" /><div class="lab-filter-options" id="lab-options-${kind}" role="listbox" aria-label="${label} suggestions" hidden></div><span class="lab-sr-only" role="status"></span></div>`;
  const scrollPositions: Record<string, number> = { search: 0, builder: 0 };
  let active: Sheet | undefined;
  let table: ReturnType<typeof mountDeckTable> | undefined;
  let tableSheet: Sheet | undefined;
  const sheets: Sheet[] = [];
  const commanderCatalog = new CommanderCatalog();
  let drawerInvoker: HTMLElement | null = null;
  const sample = (): Sheet => {
    const sections: [string, number, number][] = [['Unsorted', 0, 10], ['Early development', 10, 18], ['Keep the cards coming', 18, 23], ['Protect the board', 23, 28], ['Counters & company', 28, 45], ['Closing the game', 45, 48], ['Lands', 48, 55], ['Second pass', 55, 71], ['Try next', 71, 86], ['Other possibilities', 86, 101]];
    return { name: 'Growing wild · sample', cuts: [], groups: [commanderGroup(), ...sections.map(([name, start, end]) => ({ name, entries: sampleCards.slice(start, end).map(card => ({ card, quantity: card.name === 'Forest' ? 40 : 1 })) }))] };
  };
  root.innerHTML = `
    <div class="lab-heading"><div><p class="lab-eyebrow">ASPHODEL / DECK LAB</p><h1>A place to think in cards.</h1></div><span class="lab-prototype">Catalogue local · Decks et tables enregistrés automatiquement</span></div>
    <div class="lab-recovery" role="status" hidden></div>
    <div class="lab-workbar"><div class="lab-tabs"><button data-view="search" aria-pressed="true">Search</button><button data-view="builder" aria-pressed="false">Builder</button><button data-view="table" aria-pressed="false">Table V2</button></div><p>Discover. Collect. Make it yours.</p><button class="lab-selection" data-action="selection">Selection <span data-count>0</span> ↗</button></div>
    <section class="lab-search">
      <form class="lab-query"><span aria-hidden="true">⌕</span><input aria-label="Search card name or Oracle text" placeholder="Search card name or Oracle text…" /><button type="submit" class="lab-primary">Search</button><button type="button" data-action="filters" aria-expanded="false">Filters <span>⌄</span></button><button type="button" data-action="advanced" aria-expanded="false">Advanced</button></form>
      <div class="lab-filters" hidden>
        <label>Card name<input data-search-field="name" placeholder="Any name" /></label>
        <label>Oracle text<input data-search-field="oracle" placeholder="Words in card text" /></label>
        ${filterField('Type', 'type', 'Creature, Legendary, Elf…')}
        <label>Color<input data-search-field="colors" placeholder="G, WU, =G, <=UG or C" /></label>
        <label>Color identity<input data-search-field="identity" placeholder="<=UG, =G or C" /></label>
        ${filterField('Set / expansion', 'set', 'Search by name or set code…')}
        <label>Mana value<input data-search-field="manaValue" placeholder="3, <=4, >=6…" /></label>
        <label>Rarity<select data-search-field="rarity"><option value="">Any</option>${['common','uncommon','rare','mythic','special','bonus'].map(r => `<option value="${r}">${r}</option>`).join('')}</select></label>
        <label>Language<select data-search-field="language"><option value="">All available languages</option></select></label>
        <p>Types: AND · Expansions: OR · Leave empty for all. Color letters: W U B R G; C = colorless. Use &lt;= for a color-identity subset.</p>
      </div>
      <form class="lab-advanced" hidden><label>Advanced query <input aria-label="Advanced query" placeholder='(set:tla OR set:tle) t:creature mv<=4' /></label><div><button type="submit">Apply query</button><span> Local syntax: name, o, t, set, r, lang, mv, c, id, f:commander · AND / OR / NOT and parentheses.</span></div></form>
      <div class="lab-results-bar"><div><strong data-results></strong><span data-catalog-scope></span></div><div class="lab-result-controls"><div class="lab-modes"><button data-mode="images" aria-pressed="true">▦ Images</button><button data-mode="full" aria-pressed="false">☰ Full</button></div></div></div>
      <p class="lab-search-status" role="status" hidden></p>
      <div class="lab-results"></div>
      <div class="lab-end"><button data-action="load-more" hidden>Load 60 more</button><p data-loaded></p><span>Selection stays with you as you explore.</span></div>
    </section>
    <section class="lab-builder" hidden></section>
    <section class="lab-table" hidden></section>
    <dialog class="lab-drawer" aria-labelledby="lab-selection-title"><div class="lab-drawer-head"><div><p class="lab-eyebrow">YOUR WORKING POOL</p><h2 id="lab-selection-title">Selection <span data-count>0</span></h2></div><button data-action="close" aria-label="Close selection">✕</button></div><p class="lab-muted">Collected ideas, independent of any deck.</p><div class="lab-pool"></div><form class="lab-transfer"><label>New deck name<input name="deckName" placeholder="Untitled exploration" /></label><button class="lab-primary" type="submit">Create a new deck from these cards</button><div class="lab-or">or add to a deck sheet</div><select aria-label="Choose destination deck"><option value="">Choose a deck explicitly…</option></select><button type="button" data-action="transfer">Add Selection to chosen deck</button><small>Cards stay in Selection until you remove them.</small></form></dialog>
    <dialog class="lab-inspect" aria-labelledby="lab-inspection-title"><button data-action="close-inspect" aria-label="Close card inspection">✕</button><div></div></dialog>
    <dialog class="lab-triage" aria-labelledby="lab-triage-title"><div class="lab-triage-head"><div><p class="lab-eyebrow" data-triage-category></p><h2 id="lab-triage-title">How interesting is this card?</h2></div><button data-action="triage-cancel" aria-label="Close sorting">✕</button></div><div class="lab-triage-body"></div></dialog>
    <p class="lab-toast" role="status" hidden></p>`;
  const exportDialog = document.createElement('dialog');
  exportDialog.className = 'lab-export';
  exportDialog.setAttribute('aria-labelledby', 'deck-export-title');
  exportDialog.innerHTML = `<header><h2 id="deck-export-title">Exporter le deck</h2><button type="button" data-export-close aria-label="Fermer l’export">✕</button></header>
    <p>Commandants et quantités sont conservés. Les catégories sont réunies dans Mainboard ; les cartes écartées restent hors de l’export.</p>
    <label><input type="checkbox" data-export-candidates> Ajouter les candidats dans une section Maybeboard</label>
    <p class="lab-muted">La section Maybeboard dépend du format d’import de l’application destinataire.</p>
    <textarea aria-label="Liste du deck à exporter" readonly spellcheck="false"></textarea>
    <footer><button type="button" data-export-copy>Copier le texte</button><button type="button" data-export-download>Télécharger .txt</button></footer>
    <p data-export-status role="status"></p>`;
  root.append(exportDialog);
  let exportedSheet: Sheet | undefined;
  const exportText = exportDialog.querySelector<HTMLTextAreaElement>('textarea')!;
  const exportCandidates = exportDialog.querySelector<HTMLInputElement>('[data-export-candidates]')!;
  const exportFeedback = exportDialog.querySelector<HTMLElement>('[data-export-status]')!;
  function renderExport() { if (exportedSheet) exportText.value = exportDeckText(exportedSheet, exportCandidates.checked); }
  function openExport() {
    if (!active) return;
    table?.checkpoint(); exportedSheet = active; exportCandidates.checked = false; exportFeedback.textContent = '';
    renderExport(); exportDialog.showModal();
  }
  exportCandidates.addEventListener('change', renderExport);
  exportDialog.querySelector('[data-export-close]')!.addEventListener('click', () => exportDialog.close());
  exportDialog.querySelector('[data-export-copy]')!.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(exportText.value); exportFeedback.textContent = 'Texte copié.'; }
    catch { exportText.focus(); exportText.select(); exportFeedback.textContent = 'Copie automatique indisponible. Le texte est sélectionné : utilise Ctrl+C.'; }
  });
  exportDialog.querySelector('[data-export-download]')!.addEventListener('click', async () => {
    if (!exportedSheet) return;
    const name = deckTextFilename(exportedSheet.name);
    try {
      if (window.asphodelDesktop) {
        const saved = await window.asphodelDesktop.saveDeckText(name, exportText.value);
        exportFeedback.textContent = saved ? 'Fichier texte enregistré.' : 'Export annulé.';
      } else {
        const url = URL.createObjectURL(new Blob([exportText.value], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); exportFeedback.textContent = 'Export téléchargé.';
      }
    } catch { exportFeedback.textContent = 'Impossible d’enregistrer le fichier. Tu peux copier le texte.'; }
  });
  const get = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const drawer = get<HTMLDialogElement>('.lab-drawer');
  const inspect = get<HTMLDialogElement>('.lab-inspect');
  let inspection: ReturnType<typeof mountCardInspector> | undefined;
  let inspectionAbort: AbortController | undefined;
  inspect.addEventListener('close', () => { inspection?.dispose(); inspection = undefined; inspectionAbort?.abort(); });
  const triageDialog = get<HTMLDialogElement>('.lab-triage');
  function toast(message: string) { const el = get('.lab-toast'); el.textContent = message; el.hidden = false; setTimeout(() => el.hidden = true, 3200); }
  let journalStorage: globalThis.Storage;
  try { journalStorage = window.localStorage; }
  catch {
    journalStorage = { length: 0, key: () => null, getItem: () => null, setItem: () => { throw new Error('Stockage local indisponible.'); }, removeItem: () => {} } as unknown as globalThis.Storage;
  }
  const histories = new WeakMap<Sheet, ProjectHistory>();
  function historyFor(sheet: Sheet): ProjectHistory {
    let history = histories.get(sheet);
    if (!history) { history = new ProjectHistory(sheet, journalStorage); histories.set(sheet, history); }
    return history;
  }
  const historyButtons = '<div class="lab-history"><button type="button" data-history="undo" aria-label="Annuler">↶ Annuler</button><button type="button" data-history="redo" aria-label="Rétablir">↷ Rétablir</button></div>';
  function updateHistoryControls() {
    const state = active ? historyFor(active).state : undefined;
    root.querySelectorAll<HTMLButtonElement>('[data-history]').forEach(button => {
      const undo = button.dataset.history === 'undo';
      button.disabled = !(undo ? state?.canUndo : state?.canRedo);
      const label = undo ? state?.undoLabel : state?.redoLabel;
      button.title = `${undo ? 'Annuler' : 'Rétablir'}${label ? ' : ' + label : ''} (${undo ? 'Ctrl+Z' : 'Ctrl+Maj+Z / Ctrl+Y'})`;
    });
  }
  function editSheet(label: string, mutate: () => void) {
    if (!active) return;
    const sheet = active, history = historyFor(sheet);
    table?.checkpoint(); history.begin(label);
    try { mutate(); renderBuilder(); history.commit(); scheduleAutoSave(sheet); }
    catch (error) { history.cancel(); renderBuilder(); scheduleAutoSave(sheet); toast(error instanceof Error ? error.message : 'Modification impossible.'); }
    updateHistoryControls();
  }
  function editTags(names: string[] = []) {
    if (!active) return;
    const sheet = active; table?.checkpoint();
    openTagEditor(sheet, names, tags => {
      if (active !== sheet) return;
      editSheet('Modifier les tags et les cibles', () => { sheet.tags = tags; });
    });
  }
  function performHistory(direction: 'undo' | 'redo') {
    if (!active || (view !== 'builder' && view !== 'table')) return;
    if (table?.cancelGesture()) { toast('Geste annulé.'); return; }
    const label = historyFor(active)[direction]();
    if (!label) return;
    renderBuilder(); scheduleAutoSave(); updateHistoryControls();
    toast(`${direction === 'undo' ? 'Annulé' : 'Rétabli'} : ${label}.`);
  }
  document.addEventListener('keydown', event => {
    if (root.hidden || !active || (view !== 'builder' && view !== 'table')) return;
    const target = event.target as HTMLElement | null;
    const editingText = !!target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    const direction = historyShortcut(event, editingText, !!document.querySelector('dialog[open]'));
    if (direction) { event.preventDefault(); performHistory(direction); }
  });
  const persistence = new ProjectPersistence(journalStorage, async (project, id) => {
    const result = await apiRequest<DeckDetailView>(id ? `/decks/${id}/project` : '/decks/projects', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
    });
    document.dispatchEvent(new Event('decks-changed'));
    return result;
  }, (sheet, status, error) => {
    if (active === sheet) setSaveStatus(status);
    if (error) toast(error instanceof Error ? error.message : 'Enregistrement impossible. Le brouillon reste disponible si son écriture locale a réussi.');
  });
  let recovery = { drafts: [] as ReturnType<typeof loadDrafts>['drafts'], unreadable: 0 };
  try { recovery = loadDrafts(journalStorage); }
  catch { toast('Stockage local indisponible : la récupération après arrêt brutal ne peut pas être garantie.'); }
  const recoveryBanner = get('.lab-recovery');
  if (recovery.drafts.length || recovery.unreadable) {
    recoveryBanner.hidden = false;
    recoveryBanner.innerHTML = `<p>${recovery.drafts.length} brouillon(s) non envoyé(s) retrouvé(s). Reprendre réapplique ces modifications au deck et à sa table.${recovery.unreadable ? ` ${recovery.unreadable} brouillon(s) illisible(s), conservé(s) sur cet appareil.` : ''}</p>${recovery.drafts.length ? '<button type="button" data-recover-projects>Reprendre les brouillons</button> <button type="button" data-discard-projects>Écarter ces brouillons</button>' : ''}`;
    recoveryBanner.querySelector('[data-discard-projects]')?.addEventListener('click', () => {
      const remaining = recovery.drafts.filter(draft => {
        try { journalStorage.removeItem(`asphodel.builder-draft.v1.${draft.project.projectId}`); return false; }
        catch { return true; }
      });
      recovery.drafts = remaining;
      if (remaining.length) toast('Certains brouillons n’ont pas pu être retirés.');
      else { recoveryBanner.hidden = true; toast('Les versions enregistrées ont été conservées.'); }
    });
    recoveryBanner.querySelector('button')?.addEventListener('click', () => {
      for (const draft of recovery.drafts) {
        const sheet = sheetFromProject(draft.project, draft.backendId);
        for (const c of [...sheet.groups.flatMap(g => g.entries.map(e => e.card)), ...sheet.cuts]) knownCards.set(c.name, c);
        const existing = sheets.findIndex(s => s.projectId === sheet.projectId || (sheet.backendId && s.backendId === sheet.backendId));
        if (existing >= 0) sheets[existing] = sheet; else sheets.push(sheet);
        active ??= sheet;
        scheduleAutoSave(sheet);
      }
      recovery.drafts = [];
      recoveryBanner.hidden = true;
      switchView('builder');
      toast('Brouillons repris. Leur enregistrement est en cours.');
    });
  }
  function selectedButton(c: Card) { return `<button class="lab-add" data-card="${esc(c.name)}" data-print="${esc(c.set + '/' + c.collector_number)}" aria-pressed="${selection.has(c.name)}">${selection.has(c.name) ? '✓ Selected' : '+ Selection'}</button>`; }
  function searchBody(): LabSearchQuery {
    const fields: Record<string,string> = {};
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-search-field]').forEach(input => fields[input.dataset.searchField!] = input.value.trim());
    return {...fields,query,types:typeFilters,sets:setFilters,raw:get<HTMLInputElement>('.lab-advanced input').value.trim()};
  }
  function scheduleSearch() { clearTimeout(debounce); debounce = setTimeout(() => void renderSearch(), 300); }
  async function renderSearch(append = false) {
    clearTimeout(debounce);
    if (append && (loading || nextOffset === null)) return;
    if (!append) { currentQuery = searchBody(); requestController?.abort(); }
    const version = ++requestVersion;
    const controller = requestController = new AbortController();
    loading = true;
    const status = get('.lab-search-status'); status.hidden = false;
    status.textContent = append ? 'Loading more cards…' : 'Searching the local catalog… The first search may take a moment to prepare the index.';
    get<HTMLButtonElement>('[data-action=load-more]').disabled = true;
    if (!append) {
      resultCards = []; nextOffset = null; total = 0; renderLoaded();
      get('[data-results]').textContent = 'Searching…';
      get('[data-catalog-scope]').textContent = 'Complete local catalog';
    }
    try {
      const data = await apiRequest<LabSearchResult>('/cards/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...currentQuery,offset:append ? nextOffset : 0,limit:60}),signal:controller.signal});
      if (version !== requestVersion) return;
      const previousLength = resultCards.length;
      resultCards = append ? [...resultCards,...data.cards] : data.cards;
      for (const card of data.cards) if (!selection.has(card.name)) knownCards.set(card.name,card);
      nextOffset = data.nextOffset; total = data.total;
      get('[data-results]').textContent = `${total.toLocaleString()} unique cards`;
      get('[data-catalog-scope]').textContent = `${setFilters.length ? setFilters.map(code=>code.toUpperCase()).join(' OR ') + ' · ' : ''}${data.catalogPrintings.toLocaleString()} local printings · snapshot ${new Date(data.snapshotDate).toLocaleDateString()}`;
      status.hidden = true;
      renderLoaded(append ? previousLength : undefined);
      if (!total) { status.hidden = false; status.textContent = 'No cards match these filters in the local snapshot. Remove a filter or change the query.'; }
    } catch (error) {
      if (version !== requestVersion || controller.signal.aborted) return;
      if (!append) get('[data-results]').textContent = 'Search unavailable';
      status.hidden = false; status.textContent = error instanceof Error ? error.message : 'Card search failed. Try again.';
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.addEventListener('click',()=>void renderSearch(append)); status.append(' ',retry);
    } finally {
      if (version === requestVersion) { loading = false; get<HTMLButtonElement>('[data-action=load-more]').disabled = false; }
    }
  }
  function renderLoaded(appendFrom?: number) {
    const matches = appendFrom === undefined ? resultCards : resultCards.slice(appendFrom);
    get('.lab-results').className = `lab-results lab-${mode}`;
    const html = matches.map(c => mode === 'images' ? `<article class="lab-tile">${cardStage(c)}${selectedButton(c)}</article>` : `<article class="lab-full-card">${cardStage(c)}<div class="lab-oracle"><div class="lab-card-title"><h2>${esc(c.name)}</h2><span>${mana(c.mana_cost)}</span></div><p class="lab-type">${esc(c.type_line)}</p><div class="lab-rules">${esc(c.oracle_text ?? '').split('\n').map(p => `<p>${p}</p>`).join('')}</div>${c.power ? `<strong class="lab-pt">${c.power} / ${c.toughness}</strong>` : c.loyalty ? `<strong>Loyalty ${c.loyalty}</strong>` : ''}</div><aside><p class="lab-eyebrow">PRINTING</p><strong>${esc(c.set_name)}</strong><p>${c.set.toUpperCase()} · #${c.collector_number} · ${c.rarity}</p><p>${esc(c.lang.toUpperCase())}</p><span class="lab-legal">Commander · ${esc((c.commander_legal ?? 'legal').replaceAll('_',' '))}</span><details><summary>Related cards · ${c.related.length}</summary>${c.related.length ? c.related.map(esc).join('<br>') : 'No related cards listed.'}</details><details><summary>Other printings${c.printings !== undefined ? ` · ${Math.max(c.printings - 1, 0)}` : ''}</summary>${c.otherPrintings?.length ? `<div class="lab-printings">${c.otherPrintings.map(p => `<button type="button" class="lab-printing-chip" data-printing-name="${esc(c.name)}" data-printing-image="${esc(p.image)}"${p.faces ? ` data-printing-faces="${esc(JSON.stringify(p.faces))}"` : ''}>${esc(p.set.toUpperCase())} · ${esc(p.rarity)}${p.lang !== 'en' ? ` · ${esc(p.lang.toUpperCase())}` : ''}<span class="lab-printing-preview">${printingImage(p)}<em>${esc(p.set_name)}</em></span></button>`).join('')}</div>` : 'No other printings in the local snapshot.'}</details>${selectedButton(c)}</aside></article>`).join('');
    if (appendFrom === undefined) get('.lab-results').innerHTML = html;
    else get('.lab-results').insertAdjacentHTML('beforeend',html);
    get<HTMLButtonElement>('[data-action=load-more]').hidden = nextOffset === null;
    get('[data-loaded]').textContent = resultCards.length ? `${resultCards.length.toLocaleString()} of ${total.toLocaleString()} loaded${nextOffset === null ? ' · End of results' : ''}` : '';
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  }
  function counts() {
    root.querySelectorAll('[data-count]').forEach(el => el.textContent = String(selection.size));
    root.querySelectorAll<HTMLButtonElement>('[data-card]').forEach(b => { const yes = selection.has(b.dataset.card!); b.setAttribute('aria-pressed', String(yes)); b.textContent = yes ? '✓ Selected' : '+ Selection'; });
  }
  function renderPool() {
    get('.lab-pool').innerHTML = [...knownCards.values()].filter(c => selection.has(c.name)).map(c => `<div class="lab-pool-card">${image(c)}<div><strong>${esc(c.name)}</strong><span>${esc(c.type_line)}</span></div><button data-remove="${esc(c.name)}" aria-label="Remove ${esc(c.name)} from Selection">−</button></div>`).join('') || '<div class="lab-empty"><h3>Keep a thought for later.</h3><p>Add cards from Search in one click. They will wait here while you browse or build.</p></div>';
    get<HTMLSelectElement>('.lab-transfer select').innerHTML = '<option value="">Choose a deck explicitly…</option>' + sheets.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
    counts();
  }
  async function loadSavedDecks() {
    try {
      const result = await apiRequest<{ decks: DeckSummary[] }>('/decks');
      savedDecks = result.decks;
    } catch { /* offline / backend down: saved-deck browsing just stays whatever it last was */ }
    if (!active) renderBuilder();
  }
  /** Converts a persisted deck into a local Sheet. Commander is always one pinned group regardless
   *  of its rows' stored `category` text (see schema.ts); mainboard cards are regrouped by that
   *  category, in the order the backend already sorted them (by categoryPosition) — so a deck saved
   *  with "Ramp"/"Removal"/etc. reopens with those same categories, not flattened back to one bucket. */
  function sheetFromDeckDetail(deck: DeckDetailView): Sheet {
    if (deck.project) {
      for (const c of [...deck.project.groups.flatMap(g => g.entries.map(e => e.card)), ...deck.project.cuts]) knownCards.set(c.name, c);
      return sheetFromProject({ ...deck.project, name: deck.name }, deck.id);
    }
    for (const c of deck.cards) knownCards.set(c.name, deckCardToLabCard(c));
    const entry = (c: DeckCardView) => ({ card: deckCardToLabCard(c), quantity: c.quantity });
    function regroup(section: 'mainboard' | 'maybeboard', fallbackName: string): Group[] {
      const groups: Group[] = [];
      const byCategory = new Map<string, Group>();
      for (const c of deck.cards) {
        if (c.section !== section) continue;
        const categoryName = c.category || fallbackName;
        let group = byCategory.get(categoryName);
        if (!group) {
          group = { name: categoryName, entries: [], ...(section === 'maybeboard' ? { maybeboard: true } : {}) };
          byCategory.set(categoryName, group);
          groups.push(group);
        }
        group.entries.push(entry(c));
      }
      return groups;
    }
    const mainboardGroups = regroup('mainboard', 'Mainboard');
    if (mainboardGroups.length === 0) mainboardGroups.push({ name: 'Mainboard', entries: [] });
    const maybeboardGroups = regroup('maybeboard', MAYBEBOARD_NAME);
    return {
      name: deck.name,
      backendId: deck.id,
      cuts: [],
      groups: [
        { ...commanderGroup(), entries: deck.cards.filter(c => c.section === 'commander').map(entry) },
        ...mainboardGroups,
        ...maybeboardGroups,
      ],
    };
  }
  function openDeckDetail(deck: DeckDetailView) {
    const existing = sheets.find(s => s.backendId === deck.id);
    active = existing ?? sheetFromDeckDetail(deck);
    if (!existing) sheets.push(active);
    scheduleAutoSave(active);
    switchView('builder');
  }
  async function openSavedDeck(id: number) {
    if (recovery.drafts.some(d => d.backendId === id)) { recoveryBanner.hidden = false; recoveryBanner.scrollIntoView(); toast('Un brouillon attend ta récupération avant l’ouverture de ce deck.'); return; }
    const existing = sheets.find(s => s.backendId === id);
    if (existing) { active = existing; switchView('builder'); return; }
    try {
      const deck = await apiRequest<DeckDetailView>(`/decks/${id}`);
      openDeckDetail(deck);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not open this deck.');
    }
  }
  function switchView(next: string) {
    if (next === 'table' && !active) { next = 'builder'; toast('Open a deck, then choose Table V2.'); }
    scrollPositions[view] = window.scrollY;
    const previous = view;
    if (previous === 'table' && next !== 'table') table?.checkpoint();
    view = next;
    get('.lab-search').hidden = view !== 'search'; get('.lab-builder').hidden = view !== 'builder';
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    get('.lab-table').hidden = view !== 'table';
    if (view === 'builder') renderBuilder();
    if (view === 'table') renderTable();
    if (previous !== view) window.scrollTo(0, scrollPositions[view] ?? 0);
  }
  /** One category card: the Commander slot gets a fixed label (its meaning depends on staying named "Commander"); every other category keeps the rename input. Search-to-add and drag-and-drop both target `data-drop-group`. */
  function categoryHtml(g: Group, gi: number): string {
    const count = g.entries.reduce((n,e) => n+e.quantity,0);
    const lockedFirst = gi === 0 || active!.groups[gi-1]!.commander === true;
    const header = g.commander || g.maybeboard
      ? `<h3>${g.commander ? 'Commander' : MAYBEBOARD_NAME}</h3>`
      : `<input aria-label="Rename category ${esc(g.name)}" data-rename="${gi}" value="${esc(g.name)}" maxlength="60" />`;
    const countLabel = g.maybeboard ? `${count} <small>not in deck</small>` : String(count);
    const sortButton = (!g.commander && !g.maybeboard && g.entries.length > 0)
      ? `<button data-triage="${gi}" aria-label="Sort ${esc(g.name)}" title="Keep or set aside, one card at a time">⇄</button>`
      : '';
    const stack = g.entries.map((e, ei) => `<div class="lab-stack-card" draggable="true" data-drag-group="${gi}" data-drag-entry="${ei}"><button class="lab-inspect-card" data-inspect="${esc(e.card.name)}" aria-label="Inspect ${esc(e.card.name)}">${image(e.card)}${tagBadges(active!, e.card.name)}</button><label class="lab-card-quantity">×<input type="number" min="1" max="999" step="1" value="${e.quantity}" data-quantity="${gi}:${ei}" aria-label="Quantité de ${esc(e.card.name)}"></label><select data-move="${gi}:${ei}" aria-label="Move or cut ${esc(e.card.name)}"><option value="">•••</option>${active!.groups.map((dest, di) => di !== gi ? `<option value="${di}">Move to ${esc(dest.name)}</option>` : '').join('')}<option value="cut">Cut card</option></select></div>`).join('') || '<p class="lab-category-empty">Room for a new idea.<br>Search or drag a card in.</p>';
    const classes = ['lab-category', g.commander && 'lab-category--commander', g.maybeboard && 'lab-category--maybeboard'].filter(Boolean).join(' ');
    return `<section class="${classes}"><header>${header}<span>${countLabel}</span>${sortButton}<button data-reorder="${gi}" aria-label="Move ${esc(g.name)} category left" ${lockedFirst ? 'disabled' : ''}>←</button></header><div class="lab-category-add"><input type="text" data-add-search="${gi}" placeholder="Add a card…" autocomplete="off" aria-label="Add a card to ${esc(g.name)}" /><div class="lab-add-results" data-add-results="${gi}" hidden></div></div><div class="lab-stack" data-drop-group="${gi}">${stack}</div></section>`;
  }
  /** A saved-deck / in-progress-sheet tile — reuses the app shell's own .deck-tile styling (frontend/src/style.css) so browsing decks looks the same here as the old Decks page did. */
  function deckTileHtml(key: string, name: string, totalCards: number, commanderName: string, commanderImage: string | null): string {
    const visual = commanderImage
      ? `<img class="deck-cover-image" src="${esc(commanderImage)}" alt="" loading="lazy" />`
      : `<div class="card-image-fallback">${esc((commanderName || name).slice(0, 1).toUpperCase())}</div>`;
    return `<button type="button" class="deck-tile" data-open-deck="${esc(key)}"><div class="deck-tile-visual">${visual}<span class="deck-count">${totalCards} cards</span></div><div class="deck-tile-information"><h2>${esc(name)}</h2><p class="deck-commander-name">${esc(commanderName || 'No commander set')}</p></div></button>`;
  }
  function renderTable() {
    if (!active) return;
    if (table && tableSheet === active) { table.refresh(); setSaveStatus(persistence.status(active)); updateHistoryControls(); return; }
    table?.dispose();
    tableSheet = active;
    const sheet = active;
    table = mountDeckTable(get('.lab-table'), sheet, {
      history: historyFor(sheet),
      changed: () => scheduleAutoSave(sheet),
      inspect: (card, entryId) => { knownCards.set(card.name, card); openInspect(card.name, entryId); },
      legacy: () => switchView('builder'),
      library: () => { active = undefined; switchView('builder'); },
      tags: names => editTags(names),
      commanderAnalysis: () => commanderSummary(sheet, commanderCatalog.state(sheet)),
    });
    setSaveStatus(persistence.status(sheet)); updateHistoryControls();
  }
  function renderBuilder() {
    if (view === 'table' && active) { renderTable(); return; }
    if (!active) {
      const localTiles = sheets.map((s, i) => {
        const commanders = s.groups.find(g => g.commander)?.entries ?? [];
        const total = s.groups.filter(g => !g.maybeboard).flatMap(g => g.entries).reduce((n, e) => n + e.quantity, 0);
        return deckTileHtml(`local:${i}`, s.name, total, commanders.map(e => e.card.name).join(' & '), commanders[0]?.card.image ?? null);
      }).join('');
      const savedTiles = savedDecks.filter(d => !sheets.some(s => s.backendId === d.id)).map(d =>
        deckTileHtml(`saved:${d.id}`, d.name, d.totalCards, d.commanders.map(c => c.name).join(' & '), d.commanders[0]?.imageUri ?? null),
      ).join('');
      const tiles = localTiles + savedTiles;
      get('.lab-builder').innerHTML = `<div class="lab-choose"><p class="lab-eyebrow">YOUR DECKS</p><h2>Every deck starts with your idea.</h2><p>Open one of your decks below, explore the sample workspace,<br>or begin with an empty sheet and your own categories.</p><button class="lab-primary" data-action="sample">Open sample · 140 candidates</button><button data-action="new">New empty sheet</button><button data-action="import">Import a deck</button></div>${tiles ? `<div class="deck-library">${tiles}</div>` : ''}`;
      return;
    }
    // Maybeboard is deliberately "not really in the deck" — excluded from the count, the mana
    // curve and every stat below, same as the backend excludes it from totalCards (deck-service.ts).
    const { entries, total, nonlands, spells, curve } = deckStatistics(active.groups);
    const commanderCount = active.groups.find(g => g.commander)!.entries.reduce((n,e) => n+e.quantity, 0);
    const commanderWarning = commanderCount === 0
      ? '<p class="lab-builder-warning" role="status">No commander yet — search or drag a card into the <strong>Commander</strong> category.</p>'
      : commanderCount > 2 ? `<p class="lab-builder-warning" role="status">The Commander category has <strong>${commanderCount}</strong> cards — most decks run just one (two with Partner).</p>` : '';
    const warning = total !== 100 ? `<p class="lab-builder-warning" role="status">This sheet has <strong>${total}</strong> card${total === 1 ? '' : 's'} — a Commander deck needs exactly 100.</p>` : '';
    const saveStatus = '<span class="lab-save-status" data-save-status role="status"></span><button data-action="retry-save" hidden>Réessayer</button>';
    const deckActions = historyButtons + (window.asphodelDesktop ? '<button data-action="prepare-artwork">Préparer hors ligne</button>' : '') + '<button data-action="export-deck">Exporter</button><button data-action="rename-deck">Rename</button><button data-action="delete-deck">Delete</button>';
    get('.lab-builder').innerHTML = `${commanderWarning}${warning}<div class="lab-deck-heading"><div><button class="lab-back" data-action="close-sheet" aria-label="Back to all decks">← All decks</button><p class="lab-eyebrow">COMMANDER / CANDIDATE SHEET</p><h2>${esc(active.name)}${saveStatus}</h2><p><strong>${total}</strong> candidate cards <span> / 100 final deck target</span></p></div><div><select class="lab-sheet-picker" aria-label="Open deck sheet">${sheets.map((s,i) => `<option value="${i}" ${s === active ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><button data-action="new">+ New sheet</button><button data-action="selection">+ From Selection</button>${deckActions}</div></div><div class="lab-builder-tools"><button type="button" data-action="manage-tags">Tags et cibles</button><span>Manual categories <span class="lab-muted">· drag a card, use its menu, or search a category to add one</span></span><form class="lab-new-category"><input aria-label="New category name" placeholder="Name your category" required maxlength="60" /><button>+ New category</button></form></div><div class="lab-categories">${active.groups.map(categoryHtml).join('')}</div><details class="lab-cuts"><summary>Cuts · ${active.cuts.length} <span>Keep discarded ideas nearby</span></summary>${active.cuts.map((c,i) => `<button data-restore="${i}">↶ ${esc(c.name)}</button>`).join('') || '<p>No cuts yet. Cut a card using its menu to keep it here.</p>'}</details><section class="lab-stats"><div><p class="lab-eyebrow">DECK STATISTICS</p><h2>The shape of your sheet.</h2><p class="lab-muted">All candidates · cuts excluded<br>Card types may overlap.</p><div class="lab-type-counts">${['Creature','Instant','Sorcery','Artifact','Enchantment','Planeswalker','Land'].map(type => `<div><span>${type}</span><strong>${entries.filter(e => e.card.type_line.includes(type)).reduce((n,e) => n+e.quantity,0)}</strong></div>`).join('')}</div></div><div><div class="lab-curve-heading"><h3>Mana curve</h3><span>${spells} nonland spells</span></div><div class="lab-curve">${curve.map((n,i) => `<div><span>${n}</span><i style="height:${n / Math.max(...curve,1) * 150}px"></i><label>${i === 7 ? '7+' : i}</label></div>`).join('')}</div><p class="lab-average">${spells ? (nonlands.reduce((n,e) => n+e.card.cmc*e.quantity,0)/spells).toFixed(2) : '—'} <span>Average mana value · nonlands</span></p></div></section>${commanderSummary(active, commanderCatalog.state(active))}${roleSummary(active)}`;
    setSaveStatus(persistence.status(active)); updateHistoryControls();
  }
  /** Debounced per-category "search the catalog, click to add" — lets you build a category without detouring through Search/Selection. */
  function scheduleAddSearch(gi: number, value: string) { clearTimeout(addSearchDebounce); addSearchDebounce = setTimeout(() => void runAddSearch(gi, value), 250); }
  async function runAddSearch(gi: number, value: string) {
    const resultsEl = get<HTMLElement>(`[data-add-results="${gi}"]`);
    const trimmed = value.trim();
    if (trimmed.length < 2) { resultsEl.hidden = true; resultsEl.innerHTML = ''; return; }
    addSearchController?.abort();
    const controller = addSearchController = new AbortController();
    try {
      const data = await apiRequest<LabSearchResult>('/cards/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: trimmed, limit: 8 }), signal: controller.signal });
      if (controller.signal.aborted) return;
      for (const card of data.cards) knownCards.set(card.name, card);
      resultsEl.innerHTML = data.cards.length
        ? data.cards.map(c => `<button type="button" class="lab-add-result" data-add-card-name="${esc(c.name)}" data-add-card-group="${gi}"><span>${esc(c.name)}</span><small>${esc(c.type_line)}</small></button>`).join('')
        : '<p class="lab-add-empty">No matches.</p>';
      resultsEl.hidden = false;
    } catch {
      if (!controller.signal.aborted) { resultsEl.innerHTML = '<p class="lab-add-empty">Search failed.</p>'; resultsEl.hidden = false; }
    }
  }
  function addCardToGroup(gi: number, cardName: string) {
    if (!active) return;
    const card = knownCards.get(cardName);
    const group = active.groups[gi];
    if (!card || !group) return;
    // Commander's singleton rule: only basic lands may have more than one copy anywhere in the
    // sheet. Search-add previously only checked the current category, so the same nonland card
    // could quietly pile up (quantity 2+) across categories — that's the bug being fixed here.
    if (!isBasicLand(card) && findEntryAnywhere(active, cardName)) {
      toast(`${cardName} is already in the deck.`);
      return;
    }
    editSheet('Ajouter ' + cardName, () => {
      const existing = group.entries.find(e => e.card.name === cardName);
      if (existing) existing.quantity += 1; else group.entries.push({ card, quantity: 1 });
    });
    toast(`${cardName} added to ${group.name}.`);
  }
  function setSaveStatus(status: 'pending' | 'saved' | 'error') {
    const container = root.querySelector<HTMLElement>(view === 'table' ? '.lab-table' : '.lab-builder');
    const el = container?.querySelector<HTMLElement>('[data-save-status]');
    if (!el) return;
    el.dataset.status = status;
    el.textContent = status === 'pending' ? 'Modifications en cours…' : status === 'saved' ? 'Enregistré' : 'Échec de l’enregistrement';
    const retry = container?.querySelector<HTMLElement>('[data-action=retry-save]');
    if (retry) retry.hidden = status !== 'error';
  }
  function scheduleAutoSave(sheet = active) {
    if (!sheet) return;
    try { historyFor(sheet).sync(); persistence.changed(sheet); if (active === sheet) { setSaveStatus(persistence.status(sheet)); updateHistoryControls(); } }
    catch (error) { setSaveStatus('error'); toast(error instanceof Error ? error.message : 'Projet non enregistré.'); }
  }
  /** Render saved metadata immediately; local catalog enrichment is optional and read-only. */
  function openInspect(name: string, entryId?: string) {
    table?.checkpoint();
    const sheet = active;
    const first = sheet?.groups.flatMap(g => g.entries).find(e => entryId ? e.id === entryId : e.card.name === name);
    const c = first?.card ?? knownCards.get(name);
    if (!c) return;
    const id = first?.id;
    const find = () => sheet?.groups.flatMap(group => group.entries.map(entry => ({group,entry}))).find(r => r.entry.id === id);
    const actions: InspectionActions | undefined = sheet && id ? {
      state: () => { const row = find(); return { quantity: row?.entry.quantity ?? 1, included: !row?.group.maybeboard }; },
      quantity: value => { if (active === sheet) editSheet('Modifier une quantité', () => { const row=find(); if(row)row.entry.quantity=value; }); },
      membership: included => { if (active === sheet) editSheet(included ? 'Inclure une carte dans le deck' : 'Mettre une carte de côté', () => {
        const row = reconcileWorkspace(sheet,sheet.workspace!).find(r => r.entry.id === id); if(row)setRowMembership(sheet,row,included);
      }); },
      printing: card => { if (active === sheet) editSheet('Changer l’illustration d’une carte', () => { const row=find(); if(row)row.entry.card=structuredClone(card); }); },
      note: () => { if(active !== sheet)return; inspect.close(); switchView('table'); table?.addNote(id); },
      tags: () => { if(active !== sheet)return; inspect.close(); editTags([c.name]); },
      tagNames: () => (sheet.tags?.definitions ?? []).filter(d => sheet.tags?.cards.find(r => r.name === c.name)?.tagIds.includes(d.id)).map(d => d.name),
    } : undefined;
    inspectionAbort?.abort(); inspection?.dispose();
    const instance = inspection = mountCardInspector(get('.lab-inspect > div'),c,actions);
    if (!inspect.open) inspect.showModal();
    if (c.otherPrintings !== undefined && (c.faces || !c.name.includes(' // '))) return;
    const controller = inspectionAbort = new AbortController();
    void apiRequest<LabSearchResult>('/cards/search', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({raw:`name:"${c.name.replace(/"/g,'')}"`,limit:24}),signal:controller.signal,
    }).then(data => {
      const full = data.cards.find(card => card.name === c.name);
      if (full && !controller.signal.aborted && inspection === instance && inspect.open) instance.update(enrichInspection(c,full));
    }).catch(() => { /* The saved text and illustration remain available without a catalog. */ });
  }
/** One category, one card at a time: rate it into one of the four TRIAGE_CATEGORIES. */
  function startTriage(gi: number) {
    const group = active?.groups[gi];
    if (!active || !group || group.entries.length === 0) { toast('Nothing to sort in this category.'); return; }
    triage = {
      groupIndex: gi,
      queue: [...group.entries],
      position: 0,
      buckets: { notInteresting: [], situational: [], interesting: [], mustHave: [] },
    };
    get('[data-triage-category]').textContent = `SORTING · ${group.name.toUpperCase()}`;
    renderTriage();
    triageDialog.showModal();
  }
  /** One recap column: cards reuse the same stack-card markup (image, hover-to-front, click-to-inspect)
   *  as a builder category, and the same "•••" move select — here it moves a card to another bucket
   *  instead of another sheet group, without leaving the recap. */
  function triageBucketHtml(key: TriageCategoryKey, label: string): string {
    const items = triage!.buckets[key];
    const stack = items.map((e, ei) => `<div class="lab-stack-card"><button class="lab-inspect-card" data-inspect="${esc(e.card.name)}" aria-label="Inspect ${esc(e.card.name)}">${image(e.card)}</button><select data-triage-move="${key}:${ei}" aria-label="Move ${esc(e.card.name)} to another category"><option value="">•••</option>${TRIAGE_CATEGORIES.filter(c => c.key !== key).map(c => `<option value="${c.key}">Move to ${esc(c.label)}</option>`).join('')}</select></div>`).join('')
      || '<p class="lab-category-empty">None</p>';
    return `<div class="lab-triage-recap-col" data-triage-col="${key}"><p class="lab-eyebrow">${esc(label)} · ${items.length}</p><div class="lab-stack">${stack}</div></div>`;
  }
  function renderTriage() {
    if (!triage) return;
    const body = get('.lab-triage-body');
    triageDialog.classList.toggle('lab-triage--recap', triage.position >= triage.queue.length);
    if (triage.position >= triage.queue.length) {
      body.innerHTML = `<div class="lab-triage-recap"><h3>Sorted ${triage.queue.length} card${triage.queue.length === 1 ? '' : 's'}</h3><div class="lab-triage-recap-cols">${TRIAGE_CATEGORIES.map(c => triageBucketHtml(c.key, c.label)).join('')}</div><button class="lab-primary" data-action="triage-apply">Done</button></div>`;
      return;
    }
    const entry = triage.queue[triage.position]!;
    body.innerHTML = `<p class="lab-triage-progress">${triage.position + 1} / ${triage.queue.length}</p><div class="lab-triage-stage">${cardStage(entry.card)}</div><div class="lab-triage-actions">${TRIAGE_CATEGORIES.map(c => `<button class="lab-triage-choice" data-triage-pick="${c.key}">${esc(c.label)}</button>`).join('')}</div>`;
  }
  function decideTriage(key: TriageCategoryKey) {
    if (!triage || triage.position >= triage.queue.length) return;
    const entry = triage.queue[triage.position]!;
    triage.buckets[key].push(entry);
    triage.position += 1;
    renderTriage();
  }
  /** Moves a card between two recap buckets before the triage is applied — used by each card's "•••" select. */
  function moveTriageBucket(fromKey: TriageCategoryKey, index: number, toKey: TriageCategoryKey) {
    if (!triage) return;
    const entry = triage.buckets[fromKey].splice(index, 1)[0];
    if (!entry) return;
    triage.buckets[toKey].push(entry);
    renderTriage();
  }
  /** Every non-empty bucket becomes (or joins) a regular mainboard category named after it — the
   *  category being sorted is emptied since every one of its cards was redistributed into a bucket. */
  function applyTriage() {
    if (!triage || !active) return;
    const decisions = triage;
    editSheet('Appliquer le tri', () => {
      const source = active!.groups[decisions.groupIndex];
      if (source) source.entries = [];
      for (const cat of TRIAGE_CATEGORIES) {
        const bucketEntries = decisions.buckets[cat.key];
        if (bucketEntries.length === 0) continue;
        let dest = active!.groups.find(g => g.name === cat.label && !g.commander && !g.maybeboard);
        if (!dest) { dest = { name: cat.label, entries: [] }; active!.groups.push(dest); }
        for (const entry of bucketEntries) {
          const existing = dest.entries.find(e => e.card.name === entry.card.name);
          if (existing) existing.quantity += entry.quantity; else dest.entries.push(entry);
        }
      }
    });
    triage = undefined;
    triageDialog.classList.remove('lab-triage--recap'); triageDialog.close();
  }
  function cancelTriage() { triage = undefined; triageDialog.classList.remove('lab-triage--recap'); triageDialog.close(); }
  root.addEventListener('click', event => {
    if (!(event.target as HTMLElement).closest('.lab-category-add')) {
      root.querySelectorAll<HTMLElement>('.lab-add-results:not([hidden])').forEach(el => { el.hidden = true; });
    }
    const b = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    if (b.dataset.view) switchView(b.dataset.view);
    if (b.dataset.mode) { mode = b.dataset.mode; renderLoaded(); }
    if (b.dataset.card) {
      if (selection.has(b.dataset.card)) selection.delete(b.dataset.card);
      else {
        selection.add(b.dataset.card);
        const chosen = resultCards.find(c => c.name === b.dataset.card && `${c.set}/${c.collector_number}` === b.dataset.print);
        if (chosen) knownCards.set(chosen.name, chosen);
      }
      counts();
      persistSelection();
    }
    if (b.dataset.remove) { selection.delete(b.dataset.remove); renderPool(); persistSelection(); }
    if (b.dataset.inspect) openInspect(b.dataset.inspect);
    if (b.dataset.commanderInspect) openInspect(b.dataset.commanderInspect);
    if (b.classList.contains('lab-flip-card')) { const flipped = b.classList.toggle('is-flipped'); b.setAttribute('aria-pressed', String(flipped)); }
    if (b.dataset.printingImage) {
      const stage = b.closest('.lab-full-card')?.querySelector<HTMLElement>('.lab-card-stage');
      if (stage) stage.outerHTML = cardStage({ name: b.dataset.printingName!, image: b.dataset.printingImage!, faces: b.dataset.printingFaces ? JSON.parse(b.dataset.printingFaces) as LabFace[] : undefined });
    }
    if (b.dataset.triage && active) startTriage(Number(b.dataset.triage));
    if (b.dataset.triagePick) decideTriage(b.dataset.triagePick as TriageCategoryKey);
    if (b.dataset.history) performHistory(b.dataset.history as 'undo' | 'redo');
    if (b.dataset.reorder && active) editSheet('Réordonner les catégories', () => { const i = Number(b.dataset.reorder); [active!.groups[i-1],active!.groups[i]] = [active!.groups[i]!,active!.groups[i-1]!]; });
    if (b.dataset.restore && active) editSheet('Restaurer une carte écartée', () => { const c = active!.cuts.splice(Number(b.dataset.restore),1)[0]!; defaultGroup(active!).entries.push({card:c,quantity:1}); });
    if (b.dataset.addCardName) addCardToGroup(Number(b.dataset.addCardGroup), b.dataset.addCardName);
    if (b.dataset.openDeck) {
      const [kind, key] = b.dataset.openDeck.split(':');
      if (kind === 'local') { active = sheets[Number(key)]; switchView('builder'); }
      else if (kind === 'saved') void openSavedDeck(Number(key));
    }
    switch (b.dataset.action) {
      case 'load-more': void renderSearch(true); break;
      case 'selection': drawerInvoker = b; renderPool(); drawer.showModal(); break;
      case 'close': drawer.close(); break;
      case 'close-inspect': inspect.close(); break;
      case 'triage-apply': applyTriage(); break;
      case 'triage-cancel': cancelTriage(); break;
      case 'filters': case 'advanced': { const panel = get(`.lab-${b.dataset.action}`); panel.hidden = !panel.hidden; b.setAttribute('aria-expanded',String(!panel.hidden)); break; }
      case 'sample': active = sample(); sheets.push(active); scheduleAutoSave(); renderBuilder(); break;
      case 'new': active = { name: `Untitled exploration ${sheets.length+1}`, groups: [commanderGroup(), {name:'Unsorted', entries:[]}], cuts:[] }; sheets.push(active); scheduleAutoSave(); switchView('builder'); break;
      case 'verify-commander': {
        if (active) { const sheet = active; void commanderCatalog.refresh(sheet, () => {
          if (active !== sheet) return;
          if (view === 'table' && tableSheet === sheet) table?.refreshAnalysis();
          else { const section = root.querySelector('.lab-builder .lab-commander-analysis'); if (section) section.outerHTML = commanderSummary(sheet, commanderCatalog.state(sheet)); }
        }); }
        break;
      }
      case 'manage-tags': editTags(); break;
      case 'export-deck': openExport(); break;
      case 'prepare-artwork': if(active){table?.checkpoint();openDeckArtwork(prepareProject(active,journalStorage));} break;
      case 'retry-save': if (active) void persistence.retry(active); break;
      case 'close-sheet': active = undefined; renderBuilder(); break;
      case 'import': openImportModal(); break;
      case 'transfer': { const value = get<HTMLSelectElement>('.lab-transfer select').value; if (!value) { toast('Choose a destination deck first.'); break; } if (!selection.size) { toast('Add cards to Selection first.'); break; } active = sheets[Number(value)]!; transfer(false); break; }
      case 'rename-deck': {
        if (!active) break;
        const name = window.prompt('New deck name', active.name)?.trim();
        if (!name || name === active.name) break;
        editSheet('Renommer le deck', () => { active!.name = name; });
        break;
      }
      case 'delete-deck': {
        if (!active?.backendId) break;
        if (!window.confirm(`Delete "${active.name}" permanently? This cannot be undone.`)) break;
        const sheet = active; const id = sheet.backendId;
        void persistence.flush().then(ok => { if (!ok) throw new Error('Enregistrement en échec. Réessaie avant de supprimer le deck.'); return apiRequest<null>(`/decks/${id}`, { method: 'DELETE' }); })
          .then(async () => {
            await persistence.remove(sheet);
            const idx = sheets.indexOf(sheet); if (idx >= 0) sheets.splice(idx, 1);
            if (active === sheet) active = undefined;
            renderBuilder(); void loadSavedDecks(); document.dispatchEvent(new Event('decks-changed'));
            toast(`"${sheet.name}" deleted.`);
          })
          .catch(error => toast(error instanceof ApiError ? error.message : 'Delete failed.'));
        break;
      }
    }
  });
  root.addEventListener('dragstart', event => {
    if ((event.target as HTMLElement).closest('input,select')) { event.preventDefault(); return; }
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-drag-group]');
    if (!card || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${card.dataset.dragGroup}:${card.dataset.dragEntry}`);
  });
  root.addEventListener('dragover', event => {
    const zone = (event.target as HTMLElement).closest<HTMLElement>('[data-drop-group]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.add('lab-drop-target');
  });
  root.addEventListener('dragleave', event => {
    (event.target as HTMLElement).closest<HTMLElement>('[data-drop-group]')?.classList.remove('lab-drop-target');
  });
  root.addEventListener('drop', event => {
    const zone = (event.target as HTMLElement).closest<HTMLElement>('[data-drop-group]');
    if (!zone || !active || !event.dataTransfer) return;
    event.preventDefault();
    zone.classList.remove('lab-drop-target');
    const [fromGroup, fromEntry] = event.dataTransfer.getData('text/plain').split(':').map(Number);
    const toGroup = Number(zone.dataset.dropGroup);
    if (fromGroup === undefined || fromEntry === undefined || fromGroup === toGroup) return;
    const source = active.groups[fromGroup]; const dest = active.groups[toGroup];
    if (!source || !dest) return;
    if (!source.entries[fromEntry]) return;
    editSheet('Déplacer une carte de catégorie', () => {
      const entry = source.entries.splice(fromEntry, 1)[0]!;
      const existing = dest.entries.find(e => e.card.name === entry.card.name);
      if (existing) existing.quantity += entry.quantity; else dest.entries.push(entry);
    });
  });
  function transfer(isNew: boolean) {
    const existing = new Set(active!.groups.flatMap(g => g.entries.map(e => e.card.name)));
    const added = [...knownCards.values()].filter(c => selection.has(c.name) && !existing.has(c.name));
    if (!isNew) editSheet('Ajouter la sélection au deck', () => { defaultGroup(active!).entries.push(...added.map(card => ({card,quantity:1}))); });
    else defaultGroup(active!).entries.push(...added.map(card => ({card,quantity:1})));
    drawer.close(); switchView('builder');
    if (!isNew) { toast('Selection added to ' + active!.name); return; }
    selection.clear(); persistSelection(); renderPool();
    scheduleAutoSave();
    toast('Deck créé. Enregistrement en cours.');
  }
  root.addEventListener('submit', event => {
    event.preventDefault(); const form = event.target as HTMLFormElement;
    if (form.matches('.lab-query')) { query = form.querySelector('input')!.value.trim(); void renderSearch(); }
    if (form.matches('.lab-advanced')) void renderSearch();
    if (form.matches('.lab-new-category') && active) {
      const input = form.querySelector('input')!;
      const name = input.value.trim();
      if (name) {
        if (name.toLowerCase() === MAYBEBOARD_NAME.toLowerCase() && active.groups.some(g => g.maybeboard)) { toast('A Maybeboard category already exists.'); return; }
        editSheet('Créer une catégorie', () => { active!.groups.push(name.toLowerCase() === MAYBEBOARD_NAME.toLowerCase() ? maybeGroup() : { name, entries: [] }); });
      }
    }
    if (form.matches('.lab-transfer')) { if (!selection.size) { toast('Add cards to Selection first.'); return; } active = {name: form.querySelector('input')!.value.trim() || `Untitled exploration ${sheets.length+1}`, groups:[commanderGroup(),{name:'Unsorted',entries:[]}],cuts:[]}; sheets.push(active); transfer(true); form.reset(); }
  });
  root.addEventListener('change', event => {
    const el = event.target as HTMLInputElement;
    if (el.matches('select[data-search-field]')) void renderSearch();
    if (el.matches('.lab-sheet-picker')) { active = sheets[Number(el.value)]; renderBuilder(); }
    if (el.dataset.rename && active) editSheet('Renommer une catégorie', () => { active!.groups[Number(el.dataset.rename)]!.name = el.value.trim() || 'Untitled category'; });
    if (el.dataset.move && el.value && active) editSheet(el.value === 'cut' ? 'Écarter une carte' : 'Déplacer une carte de catégorie', () => { const [g,i] = el.dataset.move!.split(':').map(Number); const entry = active!.groups[g!]!.entries.splice(i!,1)[0]!; if (el.value === 'cut') { for (let n=0;n<entry.quantity;n++) active!.cuts.push(entry.card); } else active!.groups[Number(el.value)]!.entries.push(entry); });
    if (el.dataset.quantity && active) {
      const [g,i] = el.dataset.quantity.split(':').map(Number), entry = active.groups[g!]!.entries[i!]!, quantity = Number(el.value);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) { el.value = String(entry.quantity); toast('Choisis une quantité entre 1 et 999.'); }
      else editSheet('Modifier une quantité', () => { entry.quantity = quantity; });
    }
    if (el.dataset.triageMove && el.value && triage) { const [fromKey, i] = el.dataset.triageMove.split(':'); moveTriageBucket(fromKey as TriageCategoryKey, Number(i), el.value as TriageCategoryKey); }
  });
  drawer.addEventListener('close', () => drawerInvoker?.focus());
  root.addEventListener('input', event => {
    if ((event.target as HTMLElement).matches('input[data-search-field]')) scheduleSearch();
    const addInput = (event.target as HTMLElement).closest<HTMLInputElement>('[data-add-search]');
    if (addInput) scheduleAddSearch(Number(addInput.dataset.addSearch), addInput.value);
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.target as HTMLElement).matches('input[data-search-field]')) { event.preventDefault(); void renderSearch(); }
    if (triageDialog.open && triage && triage.position < triage.queue.length) {
      const index = ['1', '2', '3', '4'].indexOf(event.key);
      if (index !== -1) { event.preventDefault(); decideTriage(TRIAGE_CATEGORIES[index]!.key); }
    }
  });
  async function loadCatalog() {
    if (catalogReady || catalogLoading) return;
    catalogLoading = true;
    try {
      const catalog = await apiRequest<LabCatalog>('/cards/search/catalog');
      const commonTypes = ['Creature', 'Legendary', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Land', 'Planeswalker', 'Battle', 'Basic', 'Snow', 'Kindred'];
      const typeOptions = [...new Set([...commonTypes, ...catalog.types])].map(value => ({value, label:value}));
      initFilterCombobox(get('[data-filter=type]'), typeOptions, values => { typeFilters = values; void renderSearch(); }, true);
      initFilterCombobox(get('[data-filter=set]'), catalog.sets, values => { setFilters = values; void renderSearch(); });
      const language = get<HTMLSelectElement>('[data-search-field=language]');
      for (const code of catalog.languages) { const option = document.createElement('option'); option.value = code; option.textContent = code.toUpperCase(); language.append(option); }
      root.querySelectorAll<HTMLInputElement>('.lab-filter-combobox input').forEach(input => input.disabled = false);
      catalogReady = true;
    } catch {
      toast('Filter suggestions unavailable. Reopen Deck Lab to retry.');
    } finally { catalogLoading = false; }
  }
  root.querySelectorAll<HTMLInputElement>('.lab-filter-combobox input').forEach(input => input.disabled = true);

  // Deck Lab is the only place decks are browsed, built and imported now — this dialog lives in
  // index.html (outside `root`) so both the header's "Importer un deck" button and this view can
  // reach it; wiring it here replaces the old, now-deleted Decks page.
  const deckModal = element<HTMLDialogElement>('#deck-modal');
  const deckForm = element<HTMLFormElement>('#deck-form');
  const deckNameInput = element<HTMLInputElement>('#deck-name');
  const deckInput = element<HTMLTextAreaElement>('#deck-input');
  const importFeedback = element<HTMLElement>('#import-feedback');
  const saveDeckButton = element<HTMLButtonElement>('#save-deck');

  const importModeLabel = document.createElement('label'); importModeLabel.className = 'field-label'; importModeLabel.textContent = 'Import from';
  const importMode = document.createElement('select'); importMode.className = 'text-input'; importMode.setAttribute('aria-label', 'Import mode');
  for (const [value, text] of [['text', 'Card list'], ['url', 'Public Archidekt URL']]) { const o = document.createElement('option'); o.value = value!; o.textContent = text!; importMode.append(o); }
  importModeLabel.append(importMode); deckForm.querySelector('.modal-content')!.prepend(importModeLabel);
  const urlLabel = document.createElement('label'); urlLabel.className = 'field-label field-label--spaced'; urlLabel.textContent = 'Archidekt URL'; urlLabel.hidden = true;
  const urlInput = document.createElement('input'); urlInput.type = 'url'; urlInput.className = 'text-input'; urlInput.placeholder = 'https://archidekt.com/decks/…'; urlInput.setAttribute('aria-label', 'Archidekt URL'); urlLabel.append(urlInput); importModeLabel.after(urlLabel);
  function updateImportMode() {
    const isUrl = importMode.value === 'url'; urlLabel.hidden = !isUrl; urlInput.required = isUrl;
    deckNameInput.required = !isUrl; deckInput.required = !isUrl;
    for (const node of [deckNameInput, deckInput, deckForm.querySelector('label[for="deck-name"]'), deckForm.querySelector('label[for="deck-input"]'), deckForm.querySelector('#deck-input-help')]) if (node instanceof HTMLElement) node.hidden = isUrl;
  }
  importMode.addEventListener('change', updateImportMode);

  function openImportModal() { importFeedback.hidden = true; deckModal.showModal(); deckNameInput.focus(); }
  function closeImportModal() { if (!saveDeckButton.disabled) deckModal.close(); }
  function renderImportError(error: ApiError) {
    importFeedback.replaceChildren();
    importFeedback.className = 'import-feedback import-feedback--error';
    const title = document.createElement('h3'); title.textContent = 'Import failed';
    const message = document.createElement('p'); message.textContent = error.message;
    importFeedback.append(title, message);
    const items = [
      ...(error.payload.issues?.map(issue => `Line ${issue.line}: ${issue.message} (${issue.content})`) ?? []),
      ...(error.payload.cardNames?.map(cardName => `Card not found: ${cardName}`) ?? []),
    ];
    if (items.length > 0) {
      const list = document.createElement('ul');
      items.forEach(item => { const line = document.createElement('li'); line.textContent = item; list.append(line); });
      importFeedback.append(list);
    }
    importFeedback.hidden = false;
  }
  deckForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = deckNameInput.value.trim();
    const decklist = deckInput.value.trim();
    const isUrl = importMode.value === 'url';
    if (isUrl ? !urlInput.value.trim() : (!name || !decklist)) return;
    importFeedback.className = 'import-feedback import-feedback--loading';
    importFeedback.textContent = 'Resolving cards with Scryfall and saving…';
    importFeedback.hidden = false;
    saveDeckButton.disabled = true;
    saveDeckButton.textContent = 'Importing…';
    try {
      const deck = await apiRequest<DeckDetailView>(isUrl ? '/decks/import/archidekt' : '/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUrl ? { url: urlInput.value.trim() } : { name, decklist }),
      });
      deckForm.reset(); updateImportMode();
      document.dispatchEvent(new Event('decks-changed'));
      deckModal.close();
      void loadSavedDecks();
      openDeckDetail(deck);
    } catch (error) {
      renderImportError(error instanceof ApiError ? error : new ApiError({ message: 'The backend is unreachable.' }));
    } finally {
      saveDeckButton.disabled = false;
      saveDeckButton.textContent = 'Import and save';
    }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-open-import]').forEach(button => button.addEventListener('click', openImportModal));
  element<HTMLButtonElement>('#close-deck-modal').addEventListener('click', closeImportModal);
  element<HTMLButtonElement>('#cancel-deck-modal').addEventListener('click', closeImportModal);
  deckModal.addEventListener('click', event => { if (event.target === deckModal) closeImportModal(); });

  let retired = false;
  window.addEventListener('pagehide', () => { if (retired) return; table?.checkpoint(); for (const sheet of sheets) scheduleAutoSave(sheet); });
  return { retire() { retired = true; commanderCatalog.retire(); }, async flush() { if (retired) return true; table?.checkpoint(); for (const sheet of sheets) scheduleAutoSave(sheet); return persistence.flush(); }, activate() {
    void loadCatalog();
    void loadSavedDecks();
    if (!activated) { activated = true; void renderSearch(); }
  } };
}
