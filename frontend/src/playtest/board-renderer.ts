import type { AgentCardObservation, AgentObservation, AgentPlayerObservation } from "./types.js";

/** Pure — safe to unit-test without a DOM. Mirrors the backend's describeCard (human-decision-render.ts) in spirit: name, P/T, tapped/summoning-sick/counters, never a hidden identity. */
export function describeCard(card: AgentCardObservation | undefined, cardRef: string | null): string {
  if (!card) return cardRef ?? "unknown";
  if (card.hidden || card.name === null) return card.faceDown ? "face-down card" : "hidden card";
  const parts = [card.name];
  const stats = card.power !== null && card.toughness !== null ? `${card.power}/${card.toughness}` : null;
  const tags = [
    stats,
    card.tapped ? "T" : null,
    card.summoningSick ? "summoning sick" : null,
    card.counters && Object.keys(card.counters).length
      ? Object.entries(card.counters).map(([type, n]) => `${n} ${type}`).join(", ")
      : null,
  ].filter((tag): tag is string => tag !== null);
  if (tags.length) parts.push(`[${tags.join(", ")}]`);
  return parts.join(" ");
}

/** Pure. "main1" -> "Main 1", "combat_damage" -> "Combat Damage". */
export function formatPhase(phase: string): string {
  return phase
    .replace(/([a-z])(\d)/i, "$1 $2")
    .split("_")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

export function findPlayer(observation: AgentObservation, playerId: string): AgentPlayerObservation | undefined {
  return observation.players.find((p) => p.playerId === playerId);
}

export function selfPlayer(observation: AgentObservation): AgentPlayerObservation | undefined {
  return findPlayer(observation, observation.selfPlayerId);
}

export function opponentPlayer(observation: AgentObservation): AgentPlayerObservation | undefined {
  return observation.players.find((p) => p.playerId !== observation.selfPlayerId);
}

function cardLine(card: AgentCardObservation): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "playtest-card";
  li.textContent = describeCard(card, card.cardRef);
  return li;
}

function zoneList(title: string, cards: AgentCardObservation[]): HTMLElement {
  const section = document.createElement("div");
  section.className = "playtest-zone";
  const heading = document.createElement("h4");
  heading.textContent = `${title} (${cards.length})`;
  section.append(heading);
  if (cards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "playtest-zone-empty";
    empty.textContent = "—";
    section.append(empty);
    return section;
  }
  const list = document.createElement("ul");
  list.className = "playtest-card-list";
  cards.forEach((card) => list.append(cardLine(card)));
  section.append(list);
  return section;
}

function countLine(label: string, count: number): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "playtest-count-line";
  p.textContent = `${label}: ${count}`;
  return p;
}

/** One player's full public/self panel: life, battlefield, graveyard, exile, command, library count, and (self only) hand names / (opponent) hand size only. */
export function renderPlayerPanel(player: AgentPlayerObservation, heading: string): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "playtest-player-panel";

  const title = document.createElement("h3");
  title.textContent = `${heading} — ${player.name} (${player.life} life)`;
  panel.append(title);

  if (player.role === "self") {
    panel.append(zoneList("Hand", player.hand));
  } else {
    panel.append(countLine("Hand", player.handSize));
  }
  panel.append(zoneList("Battlefield", player.battlefield));
  panel.append(zoneList("Graveyard", player.graveyard));
  if (player.exile.length) panel.append(zoneList("Exile", player.exile));
  if (player.command.length) panel.append(zoneList("Command", player.command));
  panel.append(countLine("Library", player.librarySize));
  return panel;
}

export function renderStack(observation: AgentObservation): HTMLElement | null {
  if (!observation.stack.length) return null;
  const section = document.createElement("section");
  section.className = "playtest-stack";
  const heading = document.createElement("h3");
  heading.textContent = "Stack";
  section.append(heading);
  const list = document.createElement("ol");
  observation.stack.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item.hidden || item.sourceCardName === null ? "hidden spell/ability" : item.description ?? item.sourceCardName;
    list.append(li);
  });
  section.append(list);
  return section;
}

export function renderHeader(observation: AgentObservation): HTMLElement {
  const self = selfPlayer(observation);
  const opponent = opponentPlayer(observation);
  const header = document.createElement("div");
  header.className = "playtest-header";
  const turnLine = document.createElement("p");
  turnLine.className = "playtest-turn-line";
  turnLine.textContent = `Turn ${observation.game.turn} — ${formatPhase(observation.game.phase)}`;
  const lifeLine = document.createElement("p");
  lifeLine.className = "playtest-life-line";
  lifeLine.textContent = `You ${self?.life ?? "?"}     Asphodel ${opponent?.life ?? "?"}`;
  header.append(turnLine, lifeLine);
  return header;
}

/** Full board: header, Asphodel panel, human panel, stack (when non-empty). Container is cleared and repopulated. */
export function renderBoard(container: HTMLElement, observation: AgentObservation): void {
  container.replaceChildren();
  container.append(renderHeader(observation));
  const opponent = opponentPlayer(observation);
  const self = selfPlayer(observation);
  if (opponent) container.append(renderPlayerPanel(opponent, "ASPHODEL"));
  if (self) container.append(renderPlayerPanel(self, "YOU"));
  const stack = renderStack(observation);
  if (stack) container.append(stack);
}
