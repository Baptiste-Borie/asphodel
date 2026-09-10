/**
 * V2h "CARD STATE ICONOGRAPHY": small, original, non-proprietary pictograms for the persistent
 * combat keywords Forge/the bridge already exposes on `AgentCardObservation.combatKeywords` — see
 * `AgentObservationBuilder.combatKeywords`'s own fixed allowlist (flying, reach, menace, vigilance,
 * deathtouch, first strike, double strike, trample, indestructible, lifelink, defender). Never adds
 * an icon for a keyword the backend does not report, and never infers one from a card's name/type
 * line — only ever from this exact already-authoritative list. Each icon is a minimal hand-drawn
 * SVG glyph (stroke-based, matching the line-icon style already used elsewhere in the app's own
 * icon sprite, `public/icons.svg`) — no third-party card-game icon assets are used or referenced.
 */

export interface KeywordIconSpec {
  /** Exact lowercase keyword string as reported by the bridge (see the allowlist above). */
  keyword: string;
  /** Full word, for the accessible name/tooltip — never abbreviated there, only the glyph is compact. */
  label: string;
  /** Inner SVG markup (paths only) for a 0 0 16 16 viewBox, stroke="currentColor" by convention. */
  path: string;
}

const ICONS: readonly KeywordIconSpec[] = [
  { keyword: "flying", label: "Flying", path: '<path d="M1.5 8.5 Q5 3 8 8.5 Q11 3 14.5 8.5" fill="none"/>' },
  { keyword: "reach", label: "Reach", path: '<path d="M8 14V3M4.2 7 8 3l3.8 4" fill="none"/>' },
  {
    keyword: "vigilance",
    label: "Vigilance",
    path: '<path d="M1.2 8c1.9-3.3 4.6-5 6.8-5s4.9 1.7 6.8 5c-1.9 3.3-4.6 5-6.8 5s-4.9-1.7-6.8-5Z" fill="none"/><circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none"/>',
  },
  {
    keyword: "menace",
    label: "Menace",
    path: '<path d="M4 3v6.2c0 2.3 1.5 4.1 3 4.8" fill="none"/><path d="M12 3v6.2c0 2.3-1.5 4.1-3 4.8" fill="none"/>',
  },
  {
    keyword: "deathtouch",
    label: "Deathtouch",
    path: '<path d="M8 1.6C10.6 5.4 13 8 13 10.5A5 5 0 0 1 3 10.5C3 8 5.4 5.4 8 1.6Z" fill="none"/>',
  },
  { keyword: "first_strike", label: "First strike", path: '<path d="M3.5 3 12 8l-8.5 5" fill="none"/>' },
  {
    keyword: "double_strike",
    label: "Double strike",
    path: '<path d="M1.5 3 8 8l-6.5 5" fill="none"/><path d="M8 3l6.5 5L8 13" fill="none"/>',
  },
  {
    keyword: "trample",
    label: "Trample",
    path: '<path d="M8 2v7.5M4.3 6.7 8 9.5l3.7-2.8" fill="none"/><path d="M2.5 13.5h11" fill="none"/>',
  },
  {
    keyword: "indestructible",
    label: "Indestructible",
    path: '<path d="M8 1.4 13.5 3.6v4.2c0 3.6-2.4 6.4-5.5 7.4-3.1-1-5.5-3.8-5.5-7.4V3.6Z" fill="none"/>',
  },
  {
    keyword: "lifelink",
    label: "Lifelink",
    path: '<path d="M8 13.6C4 11 1.8 8.7 1.8 6.1a3.1 3.1 0 0 1 5.6-1.8L8 5l.6-.7a3.1 3.1 0 0 1 5.6 1.8c0 2.6-2.2 4.9-6.2 7.5Z" fill="none"/>',
  },
  {
    keyword: "defender",
    label: "Defender",
    path: '<path d="M8 1.4 13.5 3.6v4.2c0 3.6-2.4 6.4-5.5 7.4-3.1-1-5.5-3.8-5.5-7.4V3.6Z" fill="none"/><path d="M5.2 8.4h5.6" fill="none"/>',
  },
];

const BY_KEYWORD = new Map(ICONS.map((icon) => [icon.keyword, icon]));

/** Pure lookup — `undefined` for anything not in the fixed allowlist above (nothing is ever guessed). */
export function keywordIconSpec(keyword: string): KeywordIconSpec | undefined {
  return BY_KEYWORD.get(keyword);
}

/**
 * Pure. Which of `keywords` are recognized, in a stable/deterministic order (the allowlist's own
 * order, never input order) — the DOM-building `keywordIcons` below is a thin wrapper over this so
 * the selection/ordering logic stays unit-testable without a DOM.
 */
export function keywordIconSpecs(keywords: readonly string[] | null | undefined): KeywordIconSpec[] {
  if (!keywords || keywords.length === 0) return [];
  const present = new Set(keywords);
  return ICONS.filter((icon) => present.has(icon.keyword));
}

/**
 * Builds the compact icon row for whichever of `keywords` are recognized. Returns `null` when
 * nothing is recognized — callers should render no row at all rather than an empty one. Each icon
 * carries a full-word `title`/`aria-label` (e.g. "Vigilance") so the compact glyph is never the only
 * way to identify it.
 */
export function keywordIcons(keywords: readonly string[] | null | undefined): HTMLElement | null {
  const specs = keywordIconSpecs(keywords);
  if (specs.length === 0) return null;
  const row = document.createElement("span");
  row.className = "table-card-keywords";
  for (const spec of specs) {
    const badge = document.createElement("span");
    badge.className = "table-card-keyword";
    badge.title = spec.label;
    badge.setAttribute("aria-label", spec.label);
    badge.innerHTML = `<svg viewBox="0 0 16 16" width="11" height="11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${spec.path}</svg>`;
    row.append(badge);
  }
  return row;
}
