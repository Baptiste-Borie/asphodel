import sampleCards from './cards.json';
import { apiRequest, ApiError } from '../api/api-client';
import { element } from '../dom';
import type { LabCard, LabCatalog, LabFace, LabSearchQuery, LabSearchResult } from '../../../shared/deck-lab';
import { initFilterCombobox } from './filter-combobox';
import './deck-lab.css';

type Card = LabCard;
/** `maybeboard` groups (born from the triage feature, or manually named "Maybeboard") hold cards
 *  that are deliberately excluded from the deck's card count and from what an actual game receives. */
type Group = { name: string; entries: { card: Card; quantity: number }[]; commander?: boolean; maybeboard?: boolean };
/** `backendId` is set once a sheet corresponds to a persisted deck (created here, imported, or opened from the library) — its presence is what turns on auto-save. */
type Sheet = { name: string; groups: Group[]; cuts: Card[]; backendId?: number };
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

type DeckSection = 'commander' | 'mainboard' | 'maybeboard';
interface DeckCardView { name: string; manaCost: string | null; manaValue: number; typeLine: string; oracleText: string | null; colorIdentity: string[]; imageUri: string | null; quantity: number; section: DeckSection; category: string; categoryPosition: number; }
interface DeckSummary { id: number; name: string; totalCards: number; commanders: { name: string; imageUri: string | null }[]; }
interface DeckDetailView { id: number; name: string; totalCards: number; cards: DeckCardView[]; }
/** What `PUT /decks/:id/cards` expects — mirrors backend/src/decks/deck-service.ts's DeckEntryGroupInput. */
interface DeckEntryGroupInput { name: string; section: DeckSection; entries: { name: string; quantity: number }[]; }

/** The backend's deck cards are a flatter, camelCase shape (see backend/src/decks/deck-service.ts DeckCardView) —
 *  this fills in the Scryfall-shaped fields the Builder's rendering/stats code reads but the backend never stored. */
function deckCardToLabCard(c: DeckCardView): Card {
  return {
    name: c.name, mana_cost: c.manaCost, cmc: c.manaValue, type_line: c.typeLine, oracle_text: c.oracleText,
    power: null, toughness: null, loyalty: null, set_name: '', set: '', collector_number: '', rarity: '', lang: 'en',
    color_identity: c.colorIdentity, image: c.imageUri ?? '', related: [],
  };
}
/** The inverse direction: every category round-trips now, not just Commander vs. everything-else — the backend stores a category + its position per card (see deck-service.ts). Cuts are excluded (a cut card isn't in the deck); Maybeboard is included (so it survives a reload) but flagged with its own section so the backend never counts it. */
function sheetToGroups(sheet: Sheet): DeckEntryGroupInput[] {
  return sheet.groups
    .filter(g => g.entries.length > 0)
    .map(g => ({
      name: g.name,
      section: g.commander ? 'commander' : g.maybeboard ? 'maybeboard' : 'mainboard',
      entries: g.entries.map(e => ({ name: e.card.name, quantity: e.quantity })),
    }));
}
/** Persists a Deck Lab selection as a brand-new deck, via the same decklist-import route the old Decks page used — everything lands under Mainboard since a freshly-created sheet has no Commander category filled in yet. */
function createPersistedDeck(name: string, cards: Card[]): Promise<DeckDetailView> {
  const decklist = 'Mainboard\n' + cards.map(c => `1x ${c.name}`).join('\n');
  return apiRequest<DeckDetailView>('/decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, decklist }),
  });
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

/** Complete local catalog search; deck sheets remain session-only, Selection persists locally (see selection-storage). */
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
  let autoSaveDebounce: ReturnType<typeof setTimeout> | undefined;
  let autoSaveVersion = 0;
  let triage: { groupIndex: number; queue: { card: Card; quantity: number }[]; position: number; kept: { card: Card; quantity: number }[]; setAside: { card: Card; quantity: number }[] } | undefined;
  const filterField = (label: string, kind: string, placeholder: string) => `<div class="lab-filter-combobox" data-filter="${kind}"><label for="lab-filter-${kind}">${label}</label><div class="lab-filter-chips"></div><input id="lab-filter-${kind}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="lab-options-${kind}" autocomplete="off" placeholder="${placeholder}" /><div class="lab-filter-options" id="lab-options-${kind}" role="listbox" aria-label="${label} suggestions" hidden></div><span class="lab-sr-only" role="status"></span></div>`;
  const scrollPositions: Record<string, number> = { search: 0, builder: 0 };
  let active: Sheet | undefined;
  const sheets: Sheet[] = [];
  let drawerInvoker: HTMLElement | null = null;
  const sample = (): Sheet => {
    const sections: [string, number, number][] = [['Unsorted', 0, 10], ['Early development', 10, 18], ['Keep the cards coming', 18, 23], ['Protect the board', 23, 28], ['Counters & company', 28, 45], ['Closing the game', 45, 48], ['Lands', 48, 55], ['Second pass', 55, 71], ['Try next', 71, 86], ['Other possibilities', 86, 101]];
    return { name: 'Growing wild · sample', cuts: [], groups: [commanderGroup(), ...sections.map(([name, start, end]) => ({ name, entries: sampleCards.slice(start, end).map(card => ({ card, quantity: card.name === 'Forest' ? 40 : 1 })) }))] };
  };
  root.innerHTML = `
    <div class="lab-heading"><div><p class="lab-eyebrow">ASPHODEL / DECK LAB</p><h1>A place to think in cards.</h1></div><span class="lab-prototype">Local catalog · Selection saved on this device · sheets kept for this session</span></div>
    <div class="lab-workbar"><div class="lab-tabs"><button data-view="search" aria-pressed="true">Search</button><button data-view="builder" aria-pressed="false">Builder</button></div><p>Discover. Collect. Make it yours.</p><button class="lab-selection" data-action="selection">Selection <span data-count>0</span> ↗</button></div>
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
    <dialog class="lab-drawer" aria-labelledby="lab-selection-title"><div class="lab-drawer-head"><div><p class="lab-eyebrow">YOUR WORKING POOL</p><h2 id="lab-selection-title">Selection <span data-count>0</span></h2></div><button data-action="close" aria-label="Close selection">✕</button></div><p class="lab-muted">Collected ideas, independent of any deck.</p><div class="lab-pool"></div><form class="lab-transfer"><label>New deck name<input name="deckName" placeholder="Untitled exploration" /></label><button class="lab-primary" type="submit">Create a new deck from these cards</button><div class="lab-or">or add to a deck sheet</div><select aria-label="Choose destination deck"><option value="">Choose a deck explicitly…</option></select><button type="button" data-action="transfer">Add Selection to chosen deck</button><small>Cards stay in Selection until you remove them.</small></form></dialog>
    <dialog class="lab-inspect"><button data-action="close-inspect" aria-label="Close card inspection">✕</button><div></div></dialog>
    <dialog class="lab-triage" aria-labelledby="lab-triage-title"><div class="lab-triage-head"><div><p class="lab-eyebrow" data-triage-category></p><h2 id="lab-triage-title">Keep or set aside?</h2></div><button data-action="triage-cancel" aria-label="Close sorting">✕</button></div><div class="lab-triage-body"></div></dialog>
    <p class="lab-toast" role="status" hidden></p>`;
  const get = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const drawer = get<HTMLDialogElement>('.lab-drawer');
  const inspect = get<HTMLDialogElement>('.lab-inspect');
  const triageDialog = get<HTMLDialogElement>('.lab-triage');
  function toast(message: string) { const el = get('.lab-toast'); el.textContent = message; el.hidden = false; setTimeout(() => el.hidden = true, 3200); }
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
    switchView('builder');
  }
  async function openSavedDeck(id: number) {
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
    scrollPositions[view] = window.scrollY;
    const previous = view;
    view = next;
    get('.lab-search').hidden = view !== 'search'; get('.lab-builder').hidden = view !== 'builder';
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    if (view === 'builder') renderBuilder();
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
    const stack = g.entries.map((e, ei) => `<div class="lab-stack-card" draggable="true" data-drag-group="${gi}" data-drag-entry="${ei}"><button class="lab-inspect-card" data-inspect="${esc(e.card.name)}" aria-label="Inspect ${esc(e.card.name)}">${image(e.card)}</button><select data-move="${gi}:${ei}" aria-label="Move or cut ${esc(e.card.name)}"><option value="">•••</option>${active!.groups.map((dest, di) => di !== gi ? `<option value="${di}">Move to ${esc(dest.name)}</option>` : '').join('')}<option value="cut">Cut card</option></select></div>`).join('') || '<p class="lab-category-empty">Room for a new idea.<br>Search or drag a card in.</p>';
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
  function renderBuilder() {
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
    const entries = active.groups.filter(g => !g.maybeboard).flatMap(g => g.entries);
    const total = entries.reduce((n, e) => n + e.quantity, 0);
    const nonlands = entries.filter(e => !e.card.type_line.includes('Land'));
    const spells = nonlands.reduce((n, e) => n + e.quantity, 0);
    const curve = Array.from({ length: 8 }, (_, i) => nonlands.filter(e => Math.min(7, e.card.cmc) === i).reduce((n, e) => n + e.quantity, 0));
    const commanderCount = active.groups.find(g => g.commander)!.entries.reduce((n,e) => n+e.quantity, 0);
    const commanderWarning = commanderCount === 0
      ? '<p class="lab-builder-warning" role="status">No commander yet — search or drag a card into the <strong>Commander</strong> category.</p>'
      : commanderCount > 2 ? `<p class="lab-builder-warning" role="status">The Commander category has <strong>${commanderCount}</strong> cards — most decks run just one (two with Partner).</p>` : '';
    const warning = total !== 100 ? `<p class="lab-builder-warning" role="status">This sheet has <strong>${total}</strong> card${total === 1 ? '' : 's'} — a Commander deck needs exactly 100.</p>` : '';
    const saveStatus = active.backendId ? '<span class="lab-save-status" data-save-status data-status="saved">Saved</span>' : '';
    const deckActions = active.backendId ? '<button data-action="rename-deck">Rename</button><button data-action="delete-deck">Delete</button>' : '';
    get('.lab-builder').innerHTML = `${commanderWarning}${warning}<div class="lab-deck-heading"><div><button class="lab-back" data-action="close-sheet" aria-label="Back to all decks">← All decks</button><p class="lab-eyebrow">COMMANDER / CANDIDATE SHEET</p><h2>${esc(active.name)}${saveStatus}</h2><p><strong>${total}</strong> candidate cards <span> / 100 final deck target</span></p></div><div><select class="lab-sheet-picker" aria-label="Open deck sheet">${sheets.map((s,i) => `<option value="${i}" ${s === active ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><button data-action="new">+ New sheet</button><button data-action="selection">+ From Selection</button>${deckActions}</div></div><div class="lab-builder-tools"><span>Manual categories <span class="lab-muted">· drag a card, use its menu, or search a category to add one</span></span><form class="lab-new-category"><input aria-label="New category name" placeholder="Name your category" required maxlength="60" /><button>+ New category</button></form></div><div class="lab-categories">${active.groups.map(categoryHtml).join('')}</div><details class="lab-cuts"><summary>Cuts · ${active.cuts.length} <span>Keep discarded ideas nearby</span></summary>${active.cuts.map((c,i) => `<button data-restore="${i}">↶ ${esc(c.name)}</button>`).join('') || '<p>No cuts yet. Cut a card using its menu to keep it here.</p>'}</details><section class="lab-stats"><div><p class="lab-eyebrow">DECK STATISTICS</p><h2>The shape of your sheet.</h2><p class="lab-muted">All candidates · cuts excluded<br>Card types may overlap.</p><div class="lab-type-counts">${['Creature','Instant','Sorcery','Artifact','Enchantment','Planeswalker','Land'].map(type => `<div><span>${type}</span><strong>${entries.filter(e => e.card.type_line.includes(type)).reduce((n,e) => n+e.quantity,0)}</strong></div>`).join('')}</div></div><div><div class="lab-curve-heading"><h3>Mana curve</h3><span>${spells} nonland spells</span></div><div class="lab-curve">${curve.map((n,i) => `<div><span>${n}</span><i style="height:${n / Math.max(...curve,1) * 150}px"></i><label>${i === 7 ? '7+' : i}</label></div>`).join('')}</div><p class="lab-average">${spells ? (nonlands.reduce((n,e) => n+e.card.cmc*e.quantity,0)/spells).toFixed(2) : '—'} <span>Average mana value · nonlands</span></p></div></section>`;
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
    const existing = group.entries.find(e => e.card.name === cardName);
    if (existing) existing.quantity += 1; else group.entries.push({ card, quantity: 1 });
    renderBuilder();
    scheduleAutoSave();
    toast(`${cardName} added to ${group.name}.`);
  }
  function setSaveStatus(status: 'pending' | 'saved' | 'error') {
    const el = root.querySelector<HTMLElement>('[data-save-status]');
    if (!el) return;
    el.dataset.status = status;
    el.textContent = status === 'pending' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  }
  /** Debounced whole-deck auto-save — any Builder edit to a sheet that already has a backendId (created, imported, or opened from the library) gets pushed back with `PUT /decks/:id/cards`. Local-only sheets (no backendId yet) are silently skipped. */
  function scheduleAutoSave() {
    if (!active?.backendId) return;
    setSaveStatus('pending');
    clearTimeout(autoSaveDebounce);
    autoSaveDebounce = setTimeout(() => void runAutoSave(active!), 700);
  }
  async function runAutoSave(sheet: Sheet) {
    if (!sheet.backendId) return;
    const version = ++autoSaveVersion;
    try {
      await apiRequest<DeckDetailView>(`/decks/${sheet.backendId}/cards`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: sheetToGroups(sheet) }),
      });
      // No reconciliation from the response on purpose: the Builder's local state is already what
      // the user sees, and pulling the just-saved snapshot back in would risk clobbering a newer
      // edit made while this request was in flight. An empty category not surviving a save is only
      // visible after a reload (see sheetToGroups), which is an acceptable, rare edge.
      if (version === autoSaveVersion && active === sheet) setSaveStatus('saved');
      document.dispatchEvent(new Event('decks-changed'));
    } catch (error) {
      if (version === autoSaveVersion && active === sheet) setSaveStatus('error');
      toast(error instanceof ApiError ? error.message : `Could not save "${sheet.name}" — your changes stay local for now.`);
    }
  }
  /** Opens the inspect dialog immediately with whatever card data is on hand, then — for a card whose
   *  name shows it's double-faced ("Front // Back") but that arrived from a saved deck (see
   *  deckCardToLabCard, which never gets back-face art from the backend) — quietly fetches the full
   *  local-catalog entry so the flip button appears, same as it already does for Search results. */
  function openInspect(name: string) {
    const c = knownCards.get(name);
    if (!c) return;
    const stage = get('.lab-inspect div');
    stage.dataset.inspecting = name;
    stage.innerHTML = cardStage(c);
    inspect.showModal();
    if (c.faces || !c.name.includes(' // ')) return;
    void apiRequest<LabSearchResult>('/cards/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: `name:"${c.name.replace(/"/g, '')}"`, limit: 3 }),
    })
      .then(data => {
        const full = data.cards.find(card => card.name === c.name && card.faces && card.faces.length >= 2);
        if (!full) return;
        knownCards.set(full.name, full);
        if (stage.dataset.inspecting === name) stage.innerHTML = cardStage(full);
      })
      .catch(() => { /* best-effort enrichment only — the single-face view already rendered */ });
  }
  /** One category, one card at a time: swipe left ("Set aside" → Maybeboard) or right ("Keep" → stays put). */
  function startTriage(gi: number) {
    const group = active?.groups[gi];
    if (!active || !group || group.entries.length === 0) { toast('Nothing to sort in this category.'); return; }
    triage = { groupIndex: gi, queue: [...group.entries], position: 0, kept: [], setAside: [] };
    get('[data-triage-category]').textContent = `SORTING · ${group.name.toUpperCase()}`;
    renderTriage();
    triageDialog.showModal();
  }
  function renderTriage() {
    if (!triage) return;
    const body = get('.lab-triage-body');
    if (triage.position >= triage.queue.length) {
      const list = (label: string, items: { card: Card; quantity: number }[]) =>
        `<div><p class="lab-eyebrow">${label} · ${items.length}</p><ul>${items.map(e => `<li>${esc(e.card.name)}</li>`).join('') || '<li class="lab-muted">None</li>'}</ul></div>`;
      body.innerHTML = `<div class="lab-triage-recap"><h3>Sorted ${triage.queue.length} card${triage.queue.length === 1 ? '' : 's'}</h3><div class="lab-triage-recap-cols">${list('Kept', triage.kept)}${list(MAYBEBOARD_NAME, triage.setAside)}</div><button class="lab-primary" data-action="triage-apply">Done</button></div>`;
      return;
    }
    const entry = triage.queue[triage.position]!;
    body.innerHTML = `<p class="lab-triage-progress">${triage.position + 1} / ${triage.queue.length}</p><div class="lab-triage-stage">${cardStage(entry.card)}</div><div class="lab-triage-actions"><button class="lab-triage-aside" data-action="triage-aside">✕ Set aside</button><button class="lab-triage-keep" data-action="triage-keep">Keep ✓</button></div>`;
  }
  function decideTriage(keep: boolean) {
    if (!triage || triage.position >= triage.queue.length) return;
    const entry = triage.queue[triage.position]!;
    (keep ? triage.kept : triage.setAside).push(entry);
    triage.position += 1;
    renderTriage();
  }
  function applyTriage() {
    if (!triage || !active) return;
    const group = active.groups[triage.groupIndex];
    if (group) group.entries = triage.kept;
    if (triage.setAside.length > 0) {
      let maybe = active.groups.find(g => g.maybeboard);
      if (!maybe) { maybe = maybeGroup(); active.groups.push(maybe); }
      for (const entry of triage.setAside) {
        const existing = maybe.entries.find(e => e.card.name === entry.card.name);
        if (existing) existing.quantity += entry.quantity; else maybe.entries.push(entry);
      }
    }
    triage = undefined;
    triageDialog.close();
    renderBuilder();
    scheduleAutoSave();
  }
  function cancelTriage() { triage = undefined; triageDialog.close(); }
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
    if (b.classList.contains('lab-flip-card')) { const flipped = b.classList.toggle('is-flipped'); b.setAttribute('aria-pressed', String(flipped)); }
    if (b.dataset.printingImage) {
      const stage = b.closest('.lab-full-card')?.querySelector<HTMLElement>('.lab-card-stage');
      if (stage) stage.outerHTML = cardStage({ name: b.dataset.printingName!, image: b.dataset.printingImage!, faces: b.dataset.printingFaces ? JSON.parse(b.dataset.printingFaces) as LabFace[] : undefined });
    }
    if (b.dataset.triage && active) startTriage(Number(b.dataset.triage));
    if (b.dataset.reorder && active) { const i = Number(b.dataset.reorder); [active.groups[i-1],active.groups[i]] = [active.groups[i]!,active.groups[i-1]!]; renderBuilder(); }
    if (b.dataset.restore && active) { const c = active.cuts.splice(Number(b.dataset.restore),1)[0]!; defaultGroup(active).entries.push({card:c,quantity:1}); renderBuilder(); scheduleAutoSave(); }
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
      case 'triage-keep': decideTriage(true); break;
      case 'triage-aside': decideTriage(false); break;
      case 'triage-apply': applyTriage(); break;
      case 'triage-cancel': cancelTriage(); break;
      case 'filters': case 'advanced': { const panel = get(`.lab-${b.dataset.action}`); panel.hidden = !panel.hidden; b.setAttribute('aria-expanded',String(!panel.hidden)); break; }
      case 'sample': active = sample(); sheets.push(active); renderBuilder(); break;
      case 'new': active = { name: `Untitled exploration ${sheets.length+1}`, groups: [commanderGroup(), {name:'Unsorted', entries:[]}], cuts:[] }; sheets.push(active); switchView('builder'); break;
      case 'close-sheet': active = undefined; renderBuilder(); break;
      case 'import': openImportModal(); break;
      case 'transfer': { const value = get<HTMLSelectElement>('.lab-transfer select').value; if (!value) { toast('Choose a destination deck first.'); break; } if (!selection.size) { toast('Add cards to Selection first.'); break; } active = sheets[Number(value)]!; transfer(false); break; }
      case 'rename-deck': {
        if (!active?.backendId) break;
        const name = window.prompt('New deck name', active.name)?.trim();
        if (!name || name === active.name) break;
        const sheet = active; const id = sheet.backendId;
        void apiRequest<DeckDetailView>(`/decks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
          .then(() => { sheet.name = name; if (active === sheet) renderBuilder(); void loadSavedDecks(); document.dispatchEvent(new Event('decks-changed')); })
          .catch(error => toast(error instanceof ApiError ? error.message : 'Rename failed.'));
        break;
      }
      case 'delete-deck': {
        if (!active?.backendId) break;
        if (!window.confirm(`Delete "${active.name}" permanently? This cannot be undone.`)) break;
        const sheet = active; const id = sheet.backendId;
        void apiRequest<null>(`/decks/${id}`, { method: 'DELETE' })
          .then(() => {
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
    const entry = source.entries.splice(fromEntry, 1)[0]; if (!entry) return;
    const existing = dest.entries.find(e => e.card.name === entry.card.name);
    if (existing) existing.quantity += entry.quantity; else dest.entries.push(entry);
    renderBuilder();
    scheduleAutoSave();
  });
  function transfer(isNew: boolean) {
    const existing = new Set(active!.groups.flatMap(g => g.entries.map(e => e.card.name)));
    const added = [...knownCards.values()].filter(c => selection.has(c.name) && !existing.has(c.name));
    defaultGroup(active!).entries.push(...added.map(card => ({card,quantity:1})));
    drawer.close(); switchView('builder');
    if (!isNew) { scheduleAutoSave(); toast('Selection added to ' + active!.name); return; }
    const sheet = active!;
    toast(`Creating "${sheet.name}"…`);
    selection.clear(); persistSelection(); renderPool();
    void createPersistedDeck(sheet.name, added)
      .then(deck => {
        sheet.backendId = deck.id;
        void loadSavedDecks();
        if (active === sheet) renderBuilder();
        document.dispatchEvent(new Event('decks-changed'));
        toast(`"${sheet.name}" saved to your Decks library.`);
      })
      .catch(error => toast(error instanceof ApiError ? error.message : `Could not save "${sheet.name}" to your Decks library. It stays in Deck Lab for now.`));
  }
  root.addEventListener('submit', event => {
    event.preventDefault(); const form = event.target as HTMLFormElement;
    if (form.matches('.lab-query')) { query = form.querySelector('input')!.value.trim(); void renderSearch(); }
    if (form.matches('.lab-advanced')) void renderSearch();
    if (form.matches('.lab-new-category') && active) {
      const input = form.querySelector('input')!;
      const name = input.value.trim();
      if (name) {
        if (name.toLowerCase() === MAYBEBOARD_NAME.toLowerCase()) {
          if (active.groups.some(g => g.maybeboard)) { toast('A Maybeboard category already exists.'); return; }
          active.groups.push(maybeGroup());
        } else {
          active.groups.push({ name, entries: [] });
        }
        input.value = '';
        renderBuilder();
      }
    }
    if (form.matches('.lab-transfer')) { if (!selection.size) { toast('Add cards to Selection first.'); return; } active = {name: form.querySelector('input')!.value.trim() || `Untitled exploration ${sheets.length+1}`, groups:[commanderGroup(),{name:'Unsorted',entries:[]}],cuts:[]}; sheets.push(active); transfer(true); form.reset(); }
  });
  root.addEventListener('change', event => {
    const el = event.target as HTMLInputElement;
    if (el.matches('select[data-search-field]')) void renderSearch();
    if (el.matches('.lab-sheet-picker')) { active = sheets[Number(el.value)]; renderBuilder(); }
    if (el.dataset.rename && active) { el.value = el.value.trim() || 'Untitled category'; active.groups[Number(el.dataset.rename)]!.name = el.value; renderBuilder(); }
    if (el.dataset.move && el.value && active) { const [g,i] = el.dataset.move.split(':').map(Number); const entry = active.groups[g!]!.entries.splice(i!,1)[0]!; if (el.value === 'cut') { for (let n=0;n<entry.quantity;n++) active.cuts.push(entry.card); } else active.groups[Number(el.value)]!.entries.push(entry); renderBuilder(); scheduleAutoSave(); }
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
      if (event.key === 'ArrowLeft') { event.preventDefault(); decideTriage(false); }
      if (event.key === 'ArrowRight') { event.preventDefault(); decideTriage(true); }
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

  return { activate() {
    void loadCatalog();
    void loadSavedDecks();
    if (!activated) { activated = true; void renderSearch(); }
  } };
}
