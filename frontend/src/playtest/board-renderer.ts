import { cardDisplayName, categorizeCard } from "./card-format.js";
import { createCardView } from "./card-view.js";
import type { AgentCardObservation, AgentObservation, AgentPlayerObservation, CardPresentation } from "./types.js";

export interface BoardCallbacks {
  getPresentation: (name: string) => CardPresentation | null | undefined;
  onCardHover: (card: AgentCardObservation) => void;
  onCardHoverEnd: () => void;
  onCardActivate: (card: AgentCardObservation) => void;
}

/** Pure. "main1" -> "Main 1", "combat_damage" -> "Combat Damage". */
export function formatPhase(phase: string): string {
  return phase
    .replace(/([a-z])(\d)/i, "$1 $2")
    .split("_")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

export function selfPlayer(observation: AgentObservation): AgentPlayerObservation | undefined {
  return observation.players.find((p) => p.playerId === observation.selfPlayerId);
}

export function opponentPlayer(observation: AgentObservation): AgentPlayerObservation | undefined {
  return observation.players.find((p) => p.playerId !== observation.selfPlayerId);
}

/** Pure. Every publicly-named card in the observation (never a hidden/null name) — the exact and only set of names the card-presentation batch endpoint is ever asked about. */
export function collectVisibleCardNames(observation: AgentObservation): string[] {
  const names = new Set<string>();
  for (const player of observation.players) {
    const zones = [player.battlefield, player.graveyard, player.exile, player.command, ...(player.role === "self" ? [player.hand] : [])];
    for (const zone of zones) for (const card of zone) if (card.name) names.add(card.name);
  }
  return [...names];
}

function presentationFor(card: AgentCardObservation, callbacks: BoardCallbacks): CardPresentation | null | undefined {
  return card.name ? callbacks.getPresentation(card.name) : null;
}

function cardRow(cards: AgentCardObservation[], callbacks: BoardCallbacks): HTMLElement {
  const row = document.createElement("div");
  row.className = "board-card-row";
  for (const card of cards) {
    row.append(createCardView(card, presentationFor(card, callbacks), {
      onHover: callbacks.onCardHover, onHoverEnd: callbacks.onCardHoverEnd, onActivate: callbacks.onCardActivate,
    }));
  }
  return row;
}

/** Groups a battlefield into PERMANENTS / LANDS purely from the printed type line — no rules engine. */
function renderBattlefield(cards: AgentCardObservation[], callbacks: BoardCallbacks): HTMLElement {
  const section = document.createElement("div");
  section.className = "board-battlefield";
  const permanents = cards.filter((c) => categorizeCard(c.typeLine) === "other");
  const lands = cards.filter((c) => categorizeCard(c.typeLine) === "land");
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "board-zone-empty";
    empty.textContent = "Battlefield empty";
    section.append(empty);
    return section;
  }
  if (permanents.length) {
    const group = document.createElement("div");
    group.className = "board-battlefield-group";
    const heading = document.createElement("h4");
    heading.textContent = "Permanents";
    group.append(heading, cardRow(permanents, callbacks));
    section.append(group);
  }
  if (lands.length) {
    const group = document.createElement("div");
    group.className = "board-battlefield-group";
    const heading = document.createElement("h4");
    heading.textContent = "Lands";
    group.append(heading, cardRow(lands, callbacks));
    section.append(group);
  }
  return section;
}

/** Compact zone: a one-line summary, "click to expand" into a full card row when there is anything to show. */
function renderCompactZone(title: string, cards: AgentCardObservation[], callbacks: BoardCallbacks): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "board-compact-zone";
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "board-compact-summary";
  summary.disabled = cards.length === 0;
  const names = cards.slice(0, 3).map(cardDisplayName).join(" · ");
  const overflow = cards.length > 3 ? ` · +${cards.length - 3}` : "";
  summary.textContent = `${title} · ${cards.length}${cards.length ? `\n${names}${overflow}` : ""}`;
  const expanded = document.createElement("div");
  expanded.className = "board-card-row";
  expanded.hidden = true;
  let open = false;
  summary.addEventListener("click", () => {
    if (!cards.length) return;
    open = !open;
    expanded.hidden = !open;
    if (open && !expanded.childElementCount) expanded.append(cardRow(cards, callbacks));
  });
  wrap.append(summary, expanded);
  return wrap;
}

function statLine(label: string, value: number): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "board-stat-line";
  p.textContent = `${label} ${value}`;
  return p;
}

function renderPlayerSection(player: AgentPlayerObservation, heading: string, callbacks: BoardCallbacks): HTMLElement {
  const section = document.createElement("section");
  section.className = `board-player-section board-player-section--${heading === "YOU" ? "human" : "asphodel"}`;

  const title = document.createElement("div");
  title.className = "board-player-heading";
  const name = document.createElement("h2");
  name.textContent = heading;
  const life = document.createElement("span");
  life.className = "board-life";
  life.textContent = `${player.life}`;
  title.append(name, life);
  section.append(title);

  const top = document.createElement("div");
  top.className = "board-player-top";
  if (player.commanders.length || player.command.length) {
    const command = document.createElement("div");
    command.className = "board-command";
    const commandHeading = document.createElement("h4");
    commandHeading.textContent = "Command";
    command.append(commandHeading, cardRow(player.command, callbacks));
    top.append(command);
  }
  top.append(renderBattlefield(player.battlefield, callbacks));
  section.append(top);

  if (player.role === "self") {
    const handHeading = document.createElement("h4");
    handHeading.className = "board-hand-heading";
    handHeading.textContent = `Hand · ${player.hand.length}`;
    section.append(handHeading, cardRow(player.hand, callbacks));
  }

  const stats = document.createElement("div");
  stats.className = "board-stats-row";
  stats.append(renderCompactZone("Graveyard", player.graveyard, callbacks));
  if (player.exile.length) stats.append(renderCompactZone("Exile", player.exile, callbacks));
  if (player.role === "opponent") stats.append(statLine("Hand", player.handSize));
  stats.append(statLine("Library", player.librarySize));
  section.append(stats);

  return section;
}

export function renderStack(observation: AgentObservation): HTMLElement | null {
  if (!observation.stack.length) return null;
  const section = document.createElement("section");
  section.className = "board-stack";
  const heading = document.createElement("h3");
  heading.textContent = "Stack";
  section.append(heading);
  const list = document.createElement("ol");
  observation.stack.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item.hidden || item.sourceCardName === null ? "Hidden spell/ability" : item.description ?? item.sourceCardName;
    list.append(li);
  });
  section.append(list);
  return section;
}

export function renderHeader(observation: AgentObservation): HTMLElement {
  const self = selfPlayer(observation);
  const opponent = opponentPlayer(observation);
  const header = document.createElement("div");
  header.className = "board-header";
  const turn = document.createElement("span");
  turn.className = "board-turn";
  turn.textContent = `Turn ${observation.game.turn}`;
  const phase = document.createElement("span");
  phase.className = "board-phase";
  phase.textContent = formatPhase(observation.game.phase);
  const lifeTotals = document.createElement("span");
  lifeTotals.className = "board-header-life";
  lifeTotals.innerHTML = "";
  const you = document.createElement("span");
  you.textContent = `YOU ${self?.life ?? "?"}`;
  const asphodel = document.createElement("span");
  asphodel.textContent = `ASPHODEL ${opponent?.life ?? "?"}`;
  lifeTotals.append(you, asphodel);
  header.append(turn, phase, lifeTotals);
  return header;
}

/** Full board (header, Asphodel section, stack, human section). Container is fully rebuilt only when the caller decides the observation actually changed — see playtest-view.ts's change detection. */
export function renderBoard(container: HTMLElement, observation: AgentObservation, callbacks: BoardCallbacks): void {
  container.replaceChildren();
  container.append(renderHeader(observation));
  const opponent = opponentPlayer(observation);
  const self = selfPlayer(observation);
  if (opponent) container.append(renderPlayerSection(opponent, "ASPHODEL", callbacks));
  const stack = renderStack(observation);
  if (stack) container.append(stack);
  if (self) container.append(renderPlayerSection(self, "YOU", callbacks));
}
