import sampleCards from './cards.json';
import { apiRequest } from '../api/api-client';
import type { LabCard, LabCatalog, LabSearchQuery, LabSearchResult } from '../../../shared/deck-lab';
import { initFilterCombobox } from './filter-combobox';
import './deck-lab.css';

type Card = LabCard;
type Group = { name: string; entries: { card: Card; quantity: number }[] };
type Sheet = { name: string; groups: Group[]; cuts: Card[] };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const mana = (s: string | null) => (s ?? '').replace(/\{([^}]+)\}/g, (_, x: string) => `<span class="lab-mana" data-color="${esc(x)}">${esc(x)}</span>`);
const image = (c: Card) => c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy" width="488" height="680" />` : `<div class="lab-no-image">${esc(c.name)}<span>Image unavailable</span></div>`;

/** Complete local catalog search; deck sheets and Selection remain session-only. */
export function initDeckLabView(root: HTMLElement) {
  const selection = new Set<string>();
  const knownCards = new Map<string, Card>(sampleCards.map(c => [c.name, c]));
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
  const filterField = (label: string, kind: string, placeholder: string) => `<div class="lab-filter-combobox" data-filter="${kind}"><label for="lab-filter-${kind}">${label}</label><div class="lab-filter-chips"></div><input id="lab-filter-${kind}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="lab-options-${kind}" autocomplete="off" placeholder="${placeholder}" /><div class="lab-filter-options" id="lab-options-${kind}" role="listbox" aria-label="${label} suggestions" hidden></div><span class="lab-sr-only" role="status"></span></div>`;
  const scrollPositions: Record<string, number> = { search: 0, builder: 0 };
  let active: Sheet | undefined;
  const sheets: Sheet[] = [];
  let drawerInvoker: HTMLElement | null = null;
  const sample = (): Sheet => {
    const sections: [string, number, number][] = [['Unsorted', 0, 10], ['Early development', 10, 18], ['Keep the cards coming', 18, 23], ['Protect the board', 23, 28], ['Counters & company', 28, 45], ['Closing the game', 45, 48], ['Lands', 48, 55], ['Second pass', 55, 71], ['Try next', 71, 86], ['Other possibilities', 86, 101]];
    return { name: 'Growing wild · sample', cuts: [], groups: sections.map(([name, start, end]) => ({ name, entries: sampleCards.slice(start, end).map(card => ({ card, quantity: card.name === 'Forest' ? 40 : 1 })) })) };
  };
  root.innerHTML = `
    <div class="lab-heading"><div><p class="lab-eyebrow">ASPHODEL / DECK LAB</p><h1>A place to think in cards.</h1></div><span class="lab-prototype">Local catalog · sheets kept for this session</span></div>
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
      <div class="lab-results-bar"><div><strong data-results></strong><span data-catalog-scope></span></div><div class="lab-result-controls"><select aria-label="Result uniqueness" class="lab-unique"><option value="cards">Unique cards</option><option value="prints">All printings</option></select><div class="lab-modes"><button data-mode="images" aria-pressed="true">▦ Images</button><button data-mode="full" aria-pressed="false">☰ Full</button></div></div></div>
      <p class="lab-search-status" role="status" hidden></p>
      <div class="lab-results"></div>
      <div class="lab-end"><button data-action="load-more" hidden>Load 60 more</button><p data-loaded></p><span>Selection stays with you as you explore.</span></div>
    </section>
    <section class="lab-builder" hidden></section>
    <dialog class="lab-drawer" aria-labelledby="lab-selection-title"><div class="lab-drawer-head"><div><p class="lab-eyebrow">YOUR WORKING POOL</p><h2 id="lab-selection-title">Selection <span data-count>0</span></h2></div><button data-action="close" aria-label="Close selection">✕</button></div><p class="lab-muted">Collected ideas, independent of any deck.</p><div class="lab-pool"></div><form class="lab-transfer"><label>New deck name<input name="deckName" placeholder="Untitled exploration" /></label><button class="lab-primary" type="submit">Create a new deck from these cards</button><div class="lab-or">or add to a deck sheet</div><select aria-label="Choose destination deck"><option value="">Choose a deck explicitly…</option></select><button type="button" data-action="transfer">Add Selection to chosen deck</button><small>Cards stay in Selection until you remove them.</small></form></dialog>
    <dialog class="lab-inspect"><button data-action="close-inspect" aria-label="Close card inspection">✕</button><div></div></dialog>
    <p class="lab-toast" role="status" hidden></p>`;
  const get = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const drawer = get<HTMLDialogElement>('.lab-drawer');
  const inspect = get<HTMLDialogElement>('.lab-inspect');
  function toast(message: string) { const el = get('.lab-toast'); el.textContent = message; el.hidden = false; setTimeout(() => el.hidden = true, 3200); }
  function selectedButton(c: Card) { return `<button class="lab-add" data-card="${esc(c.name)}" data-print="${esc(c.set + '/' + c.collector_number)}" aria-pressed="${selection.has(c.name)}">${selection.has(c.name) ? '✓ Selected' : '+ Selection'}</button>`; }
  function searchBody(): LabSearchQuery {
    const fields: Record<string,string> = {};
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-search-field]').forEach(input => fields[input.dataset.searchField!] = input.value.trim());
    return {...fields,query,types:typeFilters,sets:setFilters,raw:get<HTMLInputElement>('.lab-advanced input').value.trim(),unique:get<HTMLSelectElement>('.lab-unique').value as 'cards' | 'prints'};
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
      get('[data-results]').textContent = `${total.toLocaleString()} ${currentQuery.unique === 'prints' ? 'printings' : 'unique cards'}`;
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
    const html = matches.map(c => mode === 'images' ? `<article class="lab-tile">${image(c)}${selectedButton(c)}</article>` : `<article class="lab-full-card"><div>${image(c)}</div><div class="lab-oracle"><div class="lab-card-title"><h2>${esc(c.name)}</h2><span>${mana(c.mana_cost)}</span></div><p class="lab-type">${esc(c.type_line)}</p><div class="lab-rules">${esc(c.oracle_text ?? '').split('\n').map(p => `<p>${p}</p>`).join('')}</div>${c.power ? `<strong class="lab-pt">${c.power} / ${c.toughness}</strong>` : c.loyalty ? `<strong>Loyalty ${c.loyalty}</strong>` : ''}</div><aside><p class="lab-eyebrow">PRINTING</p><strong>${esc(c.set_name)}</strong><p>${c.set.toUpperCase()} · #${c.collector_number} · ${c.rarity}</p><p>${esc(c.lang.toUpperCase())}</p><span class="lab-legal">Commander · ${esc((c.commander_legal ?? 'legal').replaceAll('_',' '))}</span><details><summary>Related cards · ${c.related.length}</summary>${c.related.length ? c.related.map(esc).join('<br>') : 'No related cards listed.'}</details><details><summary>Other printings</summary>Choose “All printings” above to browse alternate versions. Use the card-name filter to narrow the results.</details>${selectedButton(c)}</aside></article>`).join('');
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
  function switchView(next: string) {
    scrollPositions[view] = window.scrollY;
    const previous = view;
    view = next;
    get('.lab-search').hidden = view !== 'search'; get('.lab-builder').hidden = view !== 'builder';
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    if (view === 'builder') renderBuilder();
    if (previous !== view) window.scrollTo(0, scrollPositions[view] ?? 0);
  }
  function renderBuilder() {
    if (!active) { get('.lab-builder').innerHTML = `<div class="lab-choose"><p class="lab-eyebrow">YOUR DECK SHEETS</p><h2>Every deck starts with your idea.</h2><p>Open the sample workspace to explore a large candidate pool,<br>or begin with an empty sheet and your own categories.</p><button class="lab-primary" data-action="sample">Open sample · 140 candidates</button><button data-action="new">New empty sheet</button></div>`; return; }
    const entries = active.groups.flatMap(g => g.entries);
    const total = entries.reduce((n, e) => n + e.quantity, 0);
    const nonlands = entries.filter(e => !e.card.type_line.includes('Land'));
    const spells = nonlands.reduce((n, e) => n + e.quantity, 0);
    const curve = Array.from({ length: 8 }, (_, i) => nonlands.filter(e => Math.min(7, e.card.cmc) === i).reduce((n, e) => n + e.quantity, 0));
    get('.lab-builder').innerHTML = `<div class="lab-deck-heading"><div><p class="lab-eyebrow">COMMANDER / CANDIDATE SHEET</p><h2>${esc(active.name)}</h2><p><strong>${total}</strong> candidate cards <span> / 100 final deck target</span></p></div><div><select class="lab-sheet-picker" aria-label="Open deck sheet">${sheets.map((s,i) => `<option value="${i}" ${s === active ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><button data-action="new">+ New sheet</button><button data-action="selection">+ From Selection</button></div></div><div class="lab-builder-tools"><span>Manual categories <span class="lab-muted">· use a card’s menu to move or cut</span></span><form class="lab-new-category"><input aria-label="New category name" placeholder="Name your category" required maxlength="60" /><button>+ New category</button></form></div><div class="lab-categories">${active.groups.map((g, gi) => `<section class="lab-category"><header><input aria-label="Rename category ${esc(g.name)}" data-rename="${gi}" value="${esc(g.name)}" maxlength="60" /><span>${g.entries.reduce((n,e) => n+e.quantity,0)}</span><button data-reorder="${gi}" aria-label="Move ${esc(g.name)} category left" ${gi === 0 ? 'disabled' : ''}>←</button></header><div class="lab-stack">${g.entries.map((e, ei) => `<div class="lab-stack-card"><button class="lab-inspect-card" data-inspect="${esc(e.card.name)}" aria-label="Inspect ${esc(e.card.name)}">${image(e.card)}<span>${e.quantity > 1 ? e.quantity + ' × ' : ''}${esc(e.card.name)}</span></button><select data-move="${gi}:${ei}" aria-label="Move or cut ${esc(e.card.name)}"><option value="">•••</option>${active!.groups.map((dest, di) => di !== gi ? `<option value="${di}">Move to ${esc(dest.name)}</option>` : '').join('')}<option value="cut">Cut card</option></select></div>`).join('') || '<p class="lab-category-empty">Room for a new idea.<br>Add cards from Selection.</p>'}</div></section>`).join('')}</div><details class="lab-cuts"><summary>Cuts · ${active.cuts.length} <span>Keep discarded ideas nearby</span></summary>${active.cuts.map((c,i) => `<button data-restore="${i}">↶ ${esc(c.name)}</button>`).join('') || '<p>No cuts yet. Cut a card using its menu to keep it here.</p>'}</details><section class="lab-stats"><div><p class="lab-eyebrow">DECK STATISTICS</p><h2>The shape of your sheet.</h2><p class="lab-muted">All candidates · cuts excluded<br>Card types may overlap.</p><div class="lab-type-counts">${['Creature','Instant','Sorcery','Artifact','Enchantment','Planeswalker','Land'].map(type => `<div><span>${type}</span><strong>${entries.filter(e => e.card.type_line.includes(type)).reduce((n,e) => n+e.quantity,0)}</strong></div>`).join('')}</div></div><div><div class="lab-curve-heading"><h3>Mana curve</h3><span>${spells} nonland spells</span></div><div class="lab-curve">${curve.map((n,i) => `<div><span>${n}</span><i style="height:${n / Math.max(...curve,1) * 150}px"></i><label>${i === 7 ? '7+' : i}</label></div>`).join('')}</div><p class="lab-average">${spells ? (nonlands.reduce((n,e) => n+e.card.cmc*e.quantity,0)/spells).toFixed(2) : '—'} <span>Average mana value · nonlands</span></p></div></section>`;
  }
  root.addEventListener('click', event => {
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
    }
    if (b.dataset.remove) { selection.delete(b.dataset.remove); renderPool(); }
    if (b.dataset.inspect) { const c = knownCards.get(b.dataset.inspect)!; get('.lab-inspect div').innerHTML = image(c); inspect.showModal(); }
    if (b.dataset.reorder && active) { const i = Number(b.dataset.reorder); [active.groups[i-1],active.groups[i]] = [active.groups[i]!,active.groups[i-1]!]; renderBuilder(); }
    if (b.dataset.restore && active) { const c = active.cuts.splice(Number(b.dataset.restore),1)[0]!; active.groups[0]!.entries.push({card:c,quantity:1}); renderBuilder(); }
    switch (b.dataset.action) {
      case 'load-more': void renderSearch(true); break;
      case 'selection': drawerInvoker = b; renderPool(); drawer.showModal(); break;
      case 'close': drawer.close(); break;
      case 'close-inspect': inspect.close(); break;
      case 'filters': case 'advanced': { const panel = get(`.lab-${b.dataset.action}`); panel.hidden = !panel.hidden; b.setAttribute('aria-expanded',String(!panel.hidden)); break; }
      case 'sample': active = sample(); sheets.push(active); renderBuilder(); break;
      case 'new': active = { name: `Untitled exploration ${sheets.length+1}`, groups: [{name:'Unsorted', entries:[]}], cuts:[] }; sheets.push(active); switchView('builder'); break;
      case 'transfer': { const value = get<HTMLSelectElement>('.lab-transfer select').value; if (!value) { toast('Choose a destination deck first.'); break; } if (!selection.size) { toast('Add cards to Selection first.'); break; } active = sheets[Number(value)]!; transfer(); break; }
    }
  });
  function transfer() { const existing = new Set(active!.groups.flatMap(g => g.entries.map(e => e.card.name))); active!.groups[0]!.entries.push(...[...knownCards.values()].filter(c => selection.has(c.name) && !existing.has(c.name)).map(card => ({card,quantity:1}))); drawer.close(); switchView('builder'); toast('Selection added to ' + active!.name); }
  root.addEventListener('submit', event => {
    event.preventDefault(); const form = event.target as HTMLFormElement;
    if (form.matches('.lab-query')) { query = form.querySelector('input')!.value.trim(); void renderSearch(); }
    if (form.matches('.lab-advanced')) void renderSearch();
    if (form.matches('.lab-new-category') && active) { const input = form.querySelector('input')!; if (input.value.trim()) { active.groups.push({name:input.value.trim(), entries:[]}); renderBuilder(); } }
    if (form.matches('.lab-transfer')) { if (!selection.size) { toast('Add cards to Selection first.'); return; } active = {name: form.querySelector('input')!.value.trim() || `Untitled exploration ${sheets.length+1}`, groups:[{name:'Unsorted',entries:[]}],cuts:[]}; sheets.push(active); transfer(); }
  });
  root.addEventListener('change', event => {
    const el = event.target as HTMLInputElement;
    if (el.matches('select[data-search-field], .lab-unique')) void renderSearch();
    if (el.matches('.lab-sheet-picker')) { active = sheets[Number(el.value)]; renderBuilder(); }
    if (el.dataset.rename && active) { el.value = el.value.trim() || 'Untitled category'; active.groups[Number(el.dataset.rename)]!.name = el.value; renderBuilder(); }
    if (el.dataset.move && el.value && active) { const [g,i] = el.dataset.move.split(':').map(Number); const entry = active.groups[g!]!.entries.splice(i!,1)[0]!; if (el.value === 'cut') { for (let n=0;n<entry.quantity;n++) active.cuts.push(entry.card); } else active.groups[Number(el.value)]!.entries.push(entry); renderBuilder(); }
  });
  drawer.addEventListener('close', () => drawerInvoker?.focus());
  root.addEventListener('input', event => {
    if ((event.target as HTMLElement).matches('input[data-search-field]')) scheduleSearch();
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.target as HTMLElement).matches('input[data-search-field]')) { event.preventDefault(); void renderSearch(); }
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
  return { activate() {
    void loadCatalog();
    if (!activated) { activated = true; void renderSearch(); }
  } };
}
