import "../styles/playtest.css";
import { apiRequest } from "../api/api-client.js";
import { endPlaytest, getActivePlaytest, getPlaytestReport, getPlaytestState, startPlaytest, submitPlaytestChoice } from "../api/playtest-api.js";
import { element } from "../dom.js";
import { collectVisibleCardNames, renderBoard, type BoardCallbacks } from "./board-renderer.js";
import { createCardPreviewPanel } from "./card-preview.js";
import { CardPresentationStore } from "./card-presentation-store.js";
import { renderDecision } from "./decision-renderer.js";
import type { AgentCardObservation, AgentObservation, DeckInput, PublicGameEvent, StartPlaytestRequest, WebPlaytestStateDTO } from "./types.js";

const POLL_INTERVAL_MS = 300;
const TERMINAL_STATUSES = new Set(["completed", "ended_by_human", "failed"]);
const MAX_VISIBLE_EVENTS = 30;
const RECENT_EVENT_COUNT = 5;

interface DeckOption {
  id: number;
  name: string;
}

function createDeckPicker(labelText: string): { element: HTMLElement; getValue: () => DeckInput; setOptions: (decks: DeckOption[]) => void } {
  const wrap = document.createElement("div");
  wrap.className = "deck-picker";

  const heading = document.createElement("h3");
  heading.className = "deck-picker-heading";
  heading.textContent = labelText;
  wrap.append(heading);

  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = "Deck";
  const select = document.createElement("select");
  select.className = "text-input";
  const fixtureOption = document.createElement("option");
  fixtureOption.value = "fixture";
  fixtureOption.textContent = "Fixture (default)";
  select.append(fixtureOption);
  label.append(select);
  wrap.append(label);

  const details = document.createElement("details");
  details.className = "deck-picker-advanced";
  const summary = document.createElement("summary");
  summary.textContent = "Use an Archidekt URL instead";
  const urlLabel = document.createElement("label");
  urlLabel.className = "field-label field-label--spaced";
  urlLabel.textContent = "Archidekt deck URL";
  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.className = "text-input";
  urlInput.placeholder = "https://archidekt.com/decks/123456/my-deck";
  urlLabel.append(urlInput);
  details.append(summary, urlLabel);
  wrap.append(details);

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
  heading.className = "events-heading";
  heading.textContent = "Activity";
  container.append(heading);
  const visible = events.slice(-MAX_VISIBLE_EVENTS).reverse();
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "events-empty";
    empty.textContent = "Nothing has happened yet.";
    container.append(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "events-list";
  visible.forEach((event, index) => {
    const li = document.createElement("li");
    li.className = index < RECENT_EVENT_COUNT ? "events-item events-item--recent" : "events-item events-item--faded";
    const turn = document.createElement("span");
    turn.className = "events-turn";
    turn.textContent = `T${event.turn}`;
    const text = document.createElement("span");
    text.textContent = event.text;
    li.append(turn, text);
    list.append(li);
  });
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
  let submitting = false;

  // The backend only ever exposes `observation` while it is the human's own turn to decide (V2c
  // isolation: it is never Asphodel's). The frontend remembers the last one it legitimately saw so
  // the board stays visible while Asphodel is thinking, instead of flashing blank every poll.
  let lastObservation: AgentObservation | null = null;
  const cardStore = new CardPresentationStore();
  const previewPanel = createCardPreviewPanel();

  // Persistent game-screen containers, built once per game — never torn down by a poll, so hover/
  // pinned-preview/scroll position survive polling. Each section only re-renders when its own
  // underlying data actually changed.
  let boardContainer: HTMLElement, statusLine: HTMLElement, eventsContainer: HTMLElement, decisionContainer: HTMLElement;
  let lastObservationKey = "";
  let lastPresentationVersion = 0;
  let renderedPresentationVersion = -1;
  let lastEventsKey = "";
  let lastDecisionKey = "";

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function showSetup(): void {
    stopPolling();
    sessionId = null;
    lastObservation = null;
    lastObservationKey = "";
    lastEventsKey = "";
    lastDecisionKey = "";
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

  function renderResuming(): void {
    setupSection.replaceChildren();
    setupSection.className = "playtest-setup";
    const message = document.createElement("p");
    message.className = "page-feedback";
    message.textContent = "Resuming playtest…";
    setupSection.append(message);
  }

  /**
   * Reconnects to the one backend playtest still running (e.g. after an F5 reload) instead of
   * defaulting to the setup screen — the session itself keeps running in PlaytestSessionManager's
   * background promise regardless of whether a browser is watching it. Never calls startPlaytest:
   * if nothing is active (including after a full backend restart, which has no session to find),
   * this falls through to a normal New Playtest screen.
   */
  async function resumeActivePlaytestIfAny(): Promise<void> {
    renderResuming();
    try {
      const result = await getActivePlaytest();
      if ("sessionId" in result) {
        sessionId = result.sessionId;
        buildGameScreen();
        showGameScreen();
        pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
        await poll();
        return;
      }
    } catch {
      /* Fall through to a fresh setup screen — nothing to resume, or the backend is unreachable. */
    }
    showSetup();
  }

  function renderSetup(): void {
    setupSection.replaceChildren();
    setupSection.className = "playtest-setup";

    const heading = document.createElement("h1");
    heading.textContent = "New Playtest";
    const description = document.createElement("p");
    description.className = "page-description";
    description.textContent = "Play a real Forge Commander 1v1 against Asphodel (V2b) in your browser.";
    setupSection.append(heading, description);

    const columns = document.createElement("div");
    columns.className = "playtest-setup-columns";
    const humanPicker = createDeckPicker("YOU");
    const agentPicker = createDeckPicker("ASPHODEL");
    columns.append(humanPicker.element, agentPicker.element);
    setupSection.append(columns);

    const seedRow = document.createElement("div");
    seedRow.className = "playtest-setup-seed";
    const seedLabel = document.createElement("label");
    seedLabel.className = "field-label";
    seedLabel.textContent = "Seed";
    const seedInput = document.createElement("input");
    seedInput.type = "number";
    seedInput.className = "text-input";
    seedInput.value = "42";
    seedLabel.append(seedInput);
    seedRow.append(seedLabel);
    setupSection.append(seedRow);

    const feedback = document.createElement("p");
    feedback.className = "page-feedback";
    feedback.hidden = true;
    setupSection.append(feedback);

    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "primary-button playtest-start-button";
    startButton.textContent = "Start Playtest";
    startButton.addEventListener("click", () => {
      const seed = Number(seedInput.value);
      const request: StartPlaytestRequest = {
        humanDeck: humanPicker.getValue(),
        asphodelDeck: agentPicker.getValue(),
        ...(Number.isSafeInteger(seed) ? { seed } : {}),
      };
      void startGame(request, startButton, feedback);
    });
    setupSection.append(startButton);

    void apiRequest<{ decks: DeckOption[] }>("/decks")
      .then((result) => {
        humanPicker.setOptions(result.decks);
        agentPicker.setOptions(result.decks);
      })
      .catch(() => { /* Deck Library is optional here — fixtures/Archidekt still work without it. */ });
  }

  async function startGame(request: StartPlaytestRequest, button: HTMLButtonElement, feedback: HTMLParagraphElement): Promise<void> {
    button.disabled = true;
    button.textContent = "Starting Forge…";
    feedback.hidden = true;
    try {
      const started = await startPlaytest(request);
      sessionId = started.sessionId;
      buildGameScreen();
      showGameScreen();
      pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
      await poll();
    } catch (error) {
      feedback.hidden = false;
      feedback.textContent = error instanceof Error ? error.message : "Could not start the playtest.";
    } finally {
      button.disabled = false;
      button.textContent = "Start Playtest";
    }
  }

  function buildGameScreen(): void {
    gameSection.replaceChildren();
    gameSection.className = "playtest-game";

    const layout = document.createElement("div");
    layout.className = "playtest-layout";

    const main = document.createElement("div");
    main.className = "playtest-main";
    statusLine = document.createElement("p");
    statusLine.className = "playtest-status-line";
    boardContainer = document.createElement("div");
    boardContainer.className = "playtest-board";
    main.append(statusLine, boardContainer);

    const sidebar = document.createElement("div");
    sidebar.className = "playtest-sidebar";
    previewPanel.element.className = "card-preview-panel";
    eventsContainer = document.createElement("div");
    eventsContainer.className = "playtest-events-panel";
    sidebar.append(previewPanel.element, eventsContainer);

    layout.append(main, sidebar);

    const dock = document.createElement("div");
    dock.className = "decision-dock";
    decisionContainer = document.createElement("div");
    decisionContainer.className = "decision-dock-content";
    const endButton = document.createElement("button");
    endButton.type = "button";
    endButton.className = "danger-button decision-dock-end";
    endButton.textContent = "End Playtest";
    endButton.addEventListener("click", () => void endGame());
    dock.append(decisionContainer, endButton);

    gameSection.append(layout, dock);
  }

  const boardCallbacks: BoardCallbacks = {
    getPresentation: (name) => cardStore.get(name),
    onCardHover: (card: AgentCardObservation) => previewPanel.showHover(card, card.name ? cardStore.get(card.name) : null),
    onCardHoverEnd: () => previewPanel.clearHover(),
    onCardActivate: (card: AgentCardObservation) => previewPanel.togglePin(card, card.name ? cardStore.get(card.name) : null),
  };

  async function poll(): Promise<void> {
    if (!sessionId) return;
    try {
      const state = await getPlaytestState(sessionId);
      if (state.observation) lastObservation = state.observation;

      let presentationChanged = false;
      if (lastObservation) presentationChanged = await cardStore.ensure(collectVisibleCardNames(lastObservation));
      if (presentationChanged) lastPresentationVersion++;

      renderStatus(state);
      renderBoardIfChanged();
      renderEventsIfChanged(state.publicEvents);
      renderDecisionIfChanged(state);

      if (TERMINAL_STATUSES.has(state.status)) {
        stopPolling();
        await renderEnd(state);
        showEndScreen();
      }
    } catch (error) {
      stopPolling();
      statusLine.textContent = error instanceof Error ? error.message : "Lost contact with the playtest.";
    }
  }

  function renderStatus(state: WebPlaytestStateDTO): void {
    if (submitting) { statusLine.textContent = "Submitting choice…"; return; }
    statusLine.textContent = {
      starting: "Starting Forge…",
      running: "Asphodel is thinking…",
      waiting_for_human: "Waiting for you",
      completed: "", ended_by_human: "", failed: "",
    }[state.status];
  }

  function renderBoardIfChanged(): void {
    if (!lastObservation) return;
    const key = JSON.stringify(lastObservation);
    if (key === lastObservationKey && lastPresentationVersion === renderedPresentationVersion) return;
    lastObservationKey = key;
    renderedPresentationVersion = lastPresentationVersion;
    renderBoard(boardContainer, lastObservation, boardCallbacks);
  }

  function renderEventsIfChanged(events: PublicGameEvent[]): void {
    const key = JSON.stringify(events);
    if (key === lastEventsKey) return;
    lastEventsKey = key;
    renderPublicEvents(eventsContainer, events);
  }

  function renderDecisionIfChanged(state: WebPlaytestStateDTO): void {
    const key = JSON.stringify(state.pendingDecision);
    if (key === lastDecisionKey) return;
    lastDecisionKey = key;
    if (state.pendingDecision) {
      renderDecision(decisionContainer, state.pendingDecision, (choice) => void submitChoice(choice));
    } else {
      decisionContainer.replaceChildren();
    }
  }

  async function submitChoice(choice: Parameters<typeof submitPlaytestChoice>[1]): Promise<void> {
    if (!sessionId) return;
    submitting = true;
    statusLine.textContent = "Submitting choice…";
    try {
      await submitPlaytestChoice(sessionId, choice);
    } catch (error) {
      statusLine.textContent = error instanceof Error ? error.message : "That choice was not accepted.";
    } finally {
      submitting = false;
    }
    await poll();
  }

  async function endGame(): Promise<void> {
    if (!sessionId) return;
    stopPolling();
    try {
      const state = await endPlaytest(sessionId);
      await renderEnd(state);
      showEndScreen();
    } catch (error) {
      statusLine.textContent = error instanceof Error ? error.message : "Could not end the playtest.";
      pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    }
  }

  async function renderEnd(state: WebPlaytestStateDTO): Promise<void> {
    endSection.replaceChildren();
    endSection.className = "playtest-end";
    const heading = document.createElement("h1");
    heading.textContent = state.endedByHuman ? "PLAYTEST ENDED" : "GAME OVER";
    endSection.append(heading);

    if (state.endedByHuman) {
      const turn = document.createElement("p");
      turn.textContent = `Turn reached: ${state.pendingDecision?.context.turn ?? lastObservation?.game.turn ?? "unknown"}`;
      const decisions = document.createElement("p");
      decisions.textContent = `Asphodel decisions recorded: ${state.asphodelDecisionCount}`;
      endSection.append(turn, decisions);
    } else if (state.result) {
      const winner = state.result.draw ? "Draw" : state.result.winnerId === "player-1" ? "Human" : "Asphodel";
      const winnerLine = document.createElement("p");
      winnerLine.className = "playtest-end-winner";
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
    newGameButton.textContent = "New Playtest";
    newGameButton.addEventListener("click", showSetup);
    endSection.append(newGameButton);
  }

  void resumeActivePlaytestIfAny();
}
