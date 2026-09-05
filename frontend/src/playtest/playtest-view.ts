import { apiRequest } from "../api/api-client.js";
import { endPlaytest, getPlaytestReport, getPlaytestState, startPlaytest, submitPlaytestChoice } from "../api/playtest-api.js";
import { element } from "../dom.js";
import { renderBoard } from "./board-renderer.js";
import { createCardSearch, type CardSearchCandidate } from "./card-search.js";
import { renderDecision } from "./decision-renderer.js";
import type { AgentChoice, DeckInput, PublicGameEvent, StartPlaytestRequest, WebPlaytestStateDTO } from "./types.js";

const POLL_INTERVAL_MS = 300;
const TERMINAL_STATUSES = new Set(["completed", "ended_by_human", "failed"]);

interface DeckOption {
  id: number;
  name: string;
}

function createDeckPicker(labelText: string): { element: HTMLElement; getValue: () => DeckInput; setOptions: (decks: DeckOption[]) => void } {
  const wrap = document.createElement("div");
  wrap.className = "playtest-deck-picker";

  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = labelText;
  wrap.append(label);

  const select = document.createElement("select");
  select.className = "text-input";
  const fixtureOption = document.createElement("option");
  fixtureOption.value = "fixture";
  fixtureOption.textContent = "Fixture (default)";
  select.append(fixtureOption);
  label.append(select);

  const urlLabel = document.createElement("label");
  urlLabel.className = "field-label field-label--spaced";
  urlLabel.textContent = "…or an Archidekt deck URL";
  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.className = "text-input";
  urlInput.placeholder = "https://archidekt.com/decks/123456/my-deck";
  urlLabel.append(urlInput);
  wrap.append(urlLabel);

  return {
    element: wrap,
    setOptions(decks) {
      select.replaceChildren(fixtureOption);
      for (const deck of decks) {
        const option = document.createElement("option");
        option.value = String(deck.id);
        option.textContent = deck.name;
        select.append(option);
      }
    },
    getValue(): DeckInput {
      const url = urlInput.value.trim();
      if (url) return { type: "archidekt", value: url };
      if (select.value !== "fixture") return { type: "library", value: select.value };
      return { type: "fixture" };
    },
  };
}

function renderPublicEvents(container: HTMLElement, events: PublicGameEvent[]): void {
  container.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Asphodel";
  container.append(heading);
  const list = document.createElement("ul");
  list.className = "playtest-events";
  for (const event of events.slice(-20)) {
    const li = document.createElement("li");
    li.textContent = `Turn ${event.turn}: ${event.text}`;
    list.append(li);
  }
  container.append(list);
}

/** Wires the whole Play screen (setup, live game, end) into #play-view. Talks only to the backend playtest API — never to Forge directly. */
export function initPlaytestView(): void {
  const root = element<HTMLElement>("#play-view");
  const setupSection = document.createElement("div");
  const gameSection = document.createElement("div");
  const endSection = document.createElement("div");
  gameSection.hidden = true;
  endSection.hidden = true;
  root.append(setupSection, gameSection, endSection);

  let sessionId: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function showSetup(): void {
    stopPolling();
    sessionId = null;
    setupSection.hidden = false;
    gameSection.hidden = true;
    endSection.hidden = true;
    renderSetup();
  }

  function showGameScreen(): void {
    setupSection.hidden = true;
    gameSection.hidden = false;
    endSection.hidden = true;
  }

  function showEndScreen(): void {
    setupSection.hidden = true;
    gameSection.hidden = true;
    endSection.hidden = false;
  }

  function renderSetup(): void {
    setupSection.replaceChildren();

    const heading = document.createElement("h1");
    heading.textContent = "New playtest";
    const description = document.createElement("p");
    description.className = "page-description";
    description.textContent = "Play a real Forge Commander 1v1 against Asphodel (V2b) in your browser.";

    const humanPicker = createDeckPicker("Your deck");
    const agentPicker = createDeckPicker("Asphodel deck");

    const seedLabel = document.createElement("label");
    seedLabel.className = "field-label field-label--spaced";
    seedLabel.textContent = "Seed";
    const seedInput = document.createElement("input");
    seedInput.type = "number";
    seedInput.className = "text-input";
    seedInput.value = "42";
    seedLabel.append(seedInput);

    const feedback = document.createElement("p");
    feedback.className = "page-feedback";
    feedback.hidden = true;

    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "primary-button";
    startButton.textContent = "Start game";
    startButton.addEventListener("click", () => {
      const seed = Number(seedInput.value);
      const request: StartPlaytestRequest = {
        humanDeck: humanPicker.getValue(),
        asphodelDeck: agentPicker.getValue(),
        ...(Number.isSafeInteger(seed) ? { seed } : {}),
      };
      void startGame(request, startButton, feedback);
    });

    const searchPreviewHeading = document.createElement("h2");
    searchPreviewHeading.className = "eyebrow";
    searchPreviewHeading.textContent = "Card search (preview — not yet connected to Forge)";
    const searchPreview = createCardSearch({
      label: "Search card",
      getCandidates: (): CardSearchCandidate[] => [
        { id: "1", name: "Zuran Orb", remaining: 1 },
        { id: "2", name: "Zulaport Cutthroat", remaining: 1 },
        { id: "3", name: "Uurg, Spawn of Turg", remaining: 1 },
        { id: "4", name: "Krenko, Tin Street Kingpin", remaining: 1 },
      ],
      onSelect: (candidate) => { feedback.hidden = false; feedback.textContent = `Selected (preview only): ${candidate.name}`; },
    });

    setupSection.append(heading, description, humanPicker.element, agentPicker.element, seedLabel, feedback, startButton, searchPreviewHeading, searchPreview);

    void apiRequest<{ decks: DeckOption[] }>("/decks")
      .then((result) => {
        humanPicker.setOptions(result.decks);
        agentPicker.setOptions(result.decks);
      })
      .catch(() => { /* Deck Library is optional here — fixtures/Archidekt still work without it. */ });
  }

  async function startGame(request: StartPlaytestRequest, button: HTMLButtonElement, feedback: HTMLParagraphElement): Promise<void> {
    button.disabled = true;
    button.textContent = "Starting…";
    feedback.hidden = true;
    try {
      const started = await startPlaytest(request);
      sessionId = started.sessionId;
      showGameScreen();
      renderGamePlaceholder();
      pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
      await poll();
    } catch (error) {
      feedback.hidden = false;
      feedback.textContent = error instanceof Error ? error.message : "Could not start the playtest.";
    } finally {
      button.disabled = false;
      button.textContent = "Start game";
    }
  }

  function renderGamePlaceholder(): void {
    gameSection.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "page-feedback";
    loading.textContent = "Starting the Forge bridge…";
    gameSection.append(loading);
  }

  async function poll(): Promise<void> {
    if (!sessionId) return;
    try {
      const state = await getPlaytestState(sessionId);
      renderGame(state);
      if (TERMINAL_STATUSES.has(state.status)) {
        stopPolling();
        await renderEnd(state);
        showEndScreen();
      }
    } catch (error) {
      stopPolling();
      renderGameError(error instanceof Error ? error.message : "Lost contact with the playtest.");
    }
  }

  function renderGame(state: WebPlaytestStateDTO): void {
    gameSection.replaceChildren();

    const deckHeading = document.createElement("p");
    deckHeading.className = "eyebrow";
    deckHeading.textContent = `${state.humanDeckName} vs ${state.asphodelDeckName}`;
    gameSection.append(deckHeading);

    const boardContainer = document.createElement("div");
    boardContainer.className = "playtest-board";
    if (state.observation) renderBoard(boardContainer, state.observation);
    else {
      const waiting = document.createElement("p");
      waiting.className = "page-feedback";
      waiting.textContent = state.status === "starting" ? "Starting…" : "Asphodel is thinking…";
      boardContainer.append(waiting);
    }
    gameSection.append(boardContainer);

    const eventsContainer = document.createElement("div");
    eventsContainer.className = "playtest-events-panel";
    renderPublicEvents(eventsContainer, state.publicEvents);
    gameSection.append(eventsContainer);

    const decisionContainer = document.createElement("div");
    decisionContainer.className = "playtest-decision-panel";
    if (state.pendingDecision) {
      renderDecision(decisionContainer, state.pendingDecision, (choice) => void submitChoice(choice));
    }
    gameSection.append(decisionContainer);

    const endButton = document.createElement("button");
    endButton.type = "button";
    endButton.className = "danger-button playtest-end-button";
    endButton.textContent = "End playtest";
    endButton.addEventListener("click", () => void endGame());
    gameSection.append(endButton);
  }

  function renderGameError(message: string): void {
    const error = document.createElement("p");
    error.className = "page-feedback";
    error.textContent = message;
    gameSection.append(error);
  }

  async function submitChoice(choice: AgentChoice): Promise<void> {
    if (!sessionId) return;
    try {
      await submitPlaytestChoice(sessionId, choice);
      await poll();
    } catch (error) {
      renderGameError(error instanceof Error ? error.message : "That choice was not accepted.");
    }
  }

  async function endGame(): Promise<void> {
    if (!sessionId) return;
    stopPolling();
    try {
      const state = await endPlaytest(sessionId);
      await renderEnd(state);
      showEndScreen();
    } catch (error) {
      renderGameError(error instanceof Error ? error.message : "Could not end the playtest.");
      pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    }
  }

  async function renderEnd(state: WebPlaytestStateDTO): Promise<void> {
    endSection.replaceChildren();
    const heading = document.createElement("h1");
    heading.textContent = state.endedByHuman ? "PLAYTEST ENDED" : "GAME OVER";
    endSection.append(heading);

    if (state.endedByHuman) {
      const turn = document.createElement("p");
      turn.textContent = `Turn reached: ${state.pendingDecision?.context.turn ?? state.observation?.game.turn ?? "unknown"}`;
      const decisions = document.createElement("p");
      decisions.textContent = `Asphodel decisions recorded: ${state.asphodelDecisionCount}`;
      endSection.append(turn, decisions);
    } else if (state.result) {
      const winner = state.result.draw ? "Draw" : state.result.winnerId === "player-1" ? "Human" : "Asphodel";
      const winnerLine = document.createElement("p");
      winnerLine.textContent = `Winner: ${winner}`;
      const turns = document.createElement("p");
      turns.textContent = `Turns: ${state.result.turns}`;
      const reason = document.createElement("p");
      reason.textContent = `Terminal reason: ${state.result.terminalReason}`;
      endSection.append(winnerLine, turns, reason);
    } else if (state.error) {
      const error = document.createElement("p");
      error.className = "page-feedback";
      error.textContent = `The playtest failed: ${state.error}`;
      endSection.append(error);
    }

    try {
      const report = await getPlaytestReport(state.sessionId);
      const reportHeading = document.createElement("h2");
      reportHeading.textContent = "Report";
      const summary = document.createElement("p");
      summary.textContent = report.summaryPath;
      const decisions = document.createElement("p");
      decisions.textContent = report.decisionsPath;
      endSection.append(reportHeading, summary, decisions);
    } catch {
      /* No report yet (e.g. the playtest failed before completing) — nothing to show. */
    }

    const newGameButton = document.createElement("button");
    newGameButton.type = "button";
    newGameButton.className = "primary-button";
    newGameButton.textContent = "New playtest";
    newGameButton.addEventListener("click", showSetup);
    endSection.append(newGameButton);
  }

  showSetup();
}
