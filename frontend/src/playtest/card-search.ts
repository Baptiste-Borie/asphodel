/**
 * Generic, standalone card-search widget prepared for the future physical-library milestone
 * (`PhysicalCardProvider`). It is NOT wired to any Forge draw/zone in V2e — Forge remains the only
 * source of truth for cards, and this component never fakes a physical operation Forge cannot yet
 * externalize (draw, mill, tutor, scry, surveil). Candidates are supplied by the caller; this
 * module never queries Scryfall or anything else on every keystroke.
 */
export interface CardSearchCandidate {
  id: string;
  name: string;
  remaining?: number;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/** Pure: case-insensitive, accent-insensitive substring match; prefix matches rank first; stable for ties. */
export function rankCardSearchResults(
  candidates: readonly CardSearchCandidate[],
  query: string,
): CardSearchCandidate[] {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) return [];
  return candidates
    .map((candidate, index) => ({ candidate, index, normalizedName: normalize(candidate.name) }))
    .filter(({ normalizedName }) => normalizedName.includes(normalizedQuery))
    .sort((a, b) => {
      const aPrefix = a.normalizedName.startsWith(normalizedQuery) ? 0 : 1;
      const bPrefix = b.normalizedName.startsWith(normalizedQuery) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      const positionDelta = a.normalizedName.indexOf(normalizedQuery) - b.normalizedName.indexOf(normalizedQuery);
      if (positionDelta !== 0) return positionDelta;
      return a.index - b.index;
    })
    .map(({ candidate }) => candidate);
}

export interface CardSearchOptions {
  /** Called on every keystroke — return the current candidate pool (e.g. remaining physical deck cards, later). Never fetched here. */
  getCandidates: () => readonly CardSearchCandidate[];
  onSelect: (candidate: CardSearchCandidate) => void;
  label?: string;
  placeholder?: string;
}

/** Builds the DOM widget: text input + results list, arrow-key navigation, Enter to select, Escape to close. */
export function createCardSearch(options: CardSearchOptions): HTMLElement {
  const root = document.createElement("div");
  root.className = "card-search";

  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = options.label ?? "Search card";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-input card-search-input";
  input.placeholder = options.placeholder ?? "";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  label.append(input);

  const list = document.createElement("ul");
  list.className = "card-search-results";
  list.hidden = true;
  root.append(label, list);

  let results: CardSearchCandidate[] = [];
  let activeIndex = -1;

  function select(index: number): void {
    const candidate = results[index];
    if (!candidate) return;
    options.onSelect(candidate);
    input.value = "";
    results = [];
    activeIndex = -1;
    renderResults();
  }

  function renderResults(): void {
    list.replaceChildren();
    results.forEach((candidate, index) => {
      const item = document.createElement("li");
      item.className = index === activeIndex ? "card-search-result card-search-result--active" : "card-search-result";
      const name = document.createElement("span");
      name.textContent = candidate.name;
      item.append(name);
      if (candidate.remaining !== undefined) {
        const remaining = document.createElement("span");
        remaining.className = "card-search-remaining";
        remaining.textContent = `×${candidate.remaining} remaining`;
        item.append(remaining);
      }
      // mousedown (not click) fires before the input's blur, so a click still resolves to a selection.
      item.addEventListener("mousedown", (event) => { event.preventDefault(); select(index); });
      list.append(item);
    });
    list.hidden = results.length === 0;
    input.setAttribute("aria-expanded", String(results.length > 0));
  }

  function close(): void {
    results = [];
    activeIndex = -1;
    renderResults();
  }

  input.addEventListener("input", () => {
    results = rankCardSearchResults(options.getCandidates(), input.value);
    activeIndex = results.length ? 0 : -1;
    renderResults();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) activeIndex = (activeIndex + 1) % results.length;
      renderResults();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) activeIndex = (activeIndex - 1 + results.length) % results.length;
      renderResults();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0) select(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  input.addEventListener("blur", () => { setTimeout(close, 100); });

  return root;
}
