import { cardDisplayName, formatCounters } from "./card-format.js";
import type { AgentCardObservation, CardPresentation } from "./types.js";

export interface CardViewOptions {
  /** Fired on hover (desktop) — never the only way to read a card; click always works too. */
  onHover?: (card: AgentCardObservation) => void;
  onHoverEnd?: () => void;
  /** Click or Enter/Space — pins/unpins the full preview. */
  onActivate?: (card: AgentCardObservation) => void;
}

function badge(text: string, className: string, title?: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `card-badge ${className}`;
  span.textContent = text;
  if (title) span.title = title;
  return span;
}

/**
 * One compact, clickable card component — used for every zone (hand, battlefield, command,
 * expanded graveyard/exile). Renders only fields already present in `AgentCardObservation`
 * (never invents anything) plus optional presentation metadata (art/mana cost) fetched separately.
 */
export function createCardView(
  card: AgentCardObservation,
  presentation: CardPresentation | null | undefined,
  options: CardViewOptions = {},
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card-view";
  if (card.tapped) button.classList.add("card-view--tapped");
  const name = cardDisplayName(card);
  button.setAttribute("aria-label", name);

  const art = document.createElement("div");
  art.className = "card-view-art";
  if (presentation?.imageUri) {
    const img = document.createElement("img");
    img.src = presentation.imageUri;
    img.alt = "";
    img.loading = "lazy";
    art.append(img);
  } else {
    art.classList.add("card-view-art--placeholder");
    art.textContent = "●";
  }
  button.append(art);

  const body = document.createElement("div");
  body.className = "card-view-body";

  const nameRow = document.createElement("div");
  nameRow.className = "card-view-name";
  nameRow.textContent = name;
  body.append(nameRow);

  if (card.typeLine) {
    const type = document.createElement("div");
    type.className = "card-view-type";
    type.textContent = card.typeLine;
    body.append(type);
  }

  const badges: HTMLElement[] = [];
  if (card.tapped) badges.push(badge("T", "card-badge--tapped", "Tapped"));
  if (card.summoningSick) badges.push(badge("SS", "card-badge--sick", "Summoning sick"));
  const counters = formatCounters(card.counters);
  if (counters) badges.push(badge(counters, "card-badge--counter"));
  if (badges.length) {
    const badgeRow = document.createElement("div");
    badgeRow.className = "card-view-badges";
    badgeRow.append(...badges);
    body.append(badgeRow);
  }

  if (card.power !== null && card.toughness !== null) {
    const pt = document.createElement("div");
    pt.className = "card-view-pt";
    pt.textContent = `${card.power}/${card.toughness}`;
    body.append(pt);
  }

  button.append(body);

  if (options.onHover) button.addEventListener("mouseenter", () => options.onHover!(card));
  if (options.onHoverEnd) button.addEventListener("mouseleave", () => options.onHoverEnd!());
  if (options.onActivate) button.addEventListener("click", () => options.onActivate!(card));

  return button;
}
