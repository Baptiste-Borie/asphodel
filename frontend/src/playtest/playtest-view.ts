import "../styles/playtest.css";
import "../styles/tabletop.css";
import { apiRequest } from "../api/api-client.js";
import { endPlaytest, getActivePlaytest, getPlaytestReport, getPlaytestState, startPlaytest, submitPlaytestChoice } from "../api/playtest-api.js";
import { element } from "../dom.js";
import { collectVisibleCardNames, opponentPlayer, renderBattlefieldHalf, renderCommanderDock, renderHand, selfPlayer, type BoardCallbacks } from "./board-renderer.js";
import { createCardPreviewPanel } from "./card-preview.js";
import { CardPresentationStore } from "./card-presentation-store.js";
import { renderDecision } from "./decision-renderer.js";
import { FramePlaybackQueue } from "./frame-playback.js";
import type { AgentCardObservation, AgentObservation, DeckInput, PublicGameEvent, StartPlaytestRequest, WebPlaytestStateDTO } from "./types.js";

const POLL_INTERVAL_MS = 300;
const TERMINAL_STATUSES = new Set(["completed", "ended_by_human", "failed"]);
const MAX_VISIBLE_ACTIONS = 6;
const RECENT_ACTION_COUNT = 3;

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

function renderLife(container: HTMLElement, label: string, life: number | undefined): void {
  container.replaceChildren();
  const name = document.createElement("p");
  name.className = "table-life-name";
  name.textContent = label;
  const value = document.createElement("p");
  value.className = "table-life-value";
  value.textContent = `${life ?? "?"}`;
  container.append(name, value);
}

/** Compact Hearthstone-style history: last few actions, most recent least faded. Public info only (Asphodel's own accepted actions — the human already sees their own choices directly). Full card names are never truncated. */
function renderActions(container: HTMLElement, events: PublicGameEvent[]): void {
  container.replaceChildren();
  const visible = events.slice(-MAX_VISIBLE_ACTIONS);
  visible.forEach((event, index) => {
    const item = document.createElement("p");
    const isRecent = index >= visible.length - RECENT_ACTION_COUNT;
    item.className = isRecent ? "table-action-item" : "table-action-item table-action-item--faded";
    const turn = document.createElement("span");
    turn.className = "table-action-turn";
    turn.textContent = `T${event.turn}`;
    item.append(turn, document.createTextNode(event.text));
    container.append(item);
  });
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
  // isolation: it is never Asphodel's). Kept here only as a fallback (e.g. the end screen's turn
  // number) — the board itself now stays populated throughout Asphodel's turn via frame playback.
  let lastObservation: AgentObservation | null = null;
  const cardStore = new CardPresentationStore();
  const previewPanel = createCardPreviewPanel();

  // Public turn-of-Asphodel frames (V2e.3) are queued and replayed in order with a short delay —
  // the human decision is only ever revealed once this queue is genuinely idle (see revealLiveState).
  const frameQueue = new FramePlaybackQueue();
  let playedEvents: PublicGameEvent[] = [];
  let latestState: WebPlaytestStateDTO | null = null;

  // Persistent game-screen elements, built once per game — never torn down by a poll, so the
  // pinned preview, menu state and any hover survive polling. Each section only re-renders when
  // its own underlying data actually changed (or, for frame playback, once per played frame).
  let asphodelLifeEl: HTMLElement, humanLifeEl: HTMLElement, actionsEl: HTMLElement;
  let asphodelCommanderDock: HTMLElement, humanCommanderDock: HTMLElement;
  let asphodelBattlefieldCards: HTMLElement, humanBattlefieldCards: HTMLElement, handContainer: HTMLElement;
  let decisionDock: HTMLElement, menuPanel: HTMLElement, menuDeckInfo: HTMLElement;
  let lastObservationKey = "";
  let lastPresentationVersion = 0;
  let renderedPresentationVersion = -1;
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
    lastDecisionKey = "";
    playedEvents = [];
    latestState = null;
    document.body.classList.remove("tabletop-active");
    previewPanel.close();
    setupSection.hidden = false;
    gameSection.hidden = true;
    endSection.hidden = true;
    renderSetup();
  }

  function showGameScreen(): void {
    document.body.classList.add("tabletop-active");
    setupSection.hidden = true;
    gameSection.hidden = false;
    endSection.hidden = true;
  }

  function showEndScreen(): void {
    document.body.classList.remove("tabletop-active");
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
        buildGameScreen(result.humanDeckName, result.asphodelDeckName);
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
      buildGameScreen(null, null);
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

  /** The battlefield fills the screen; header/nav/import chrome is hidden via the "tabletop-active" body class (see styles/tabletop.css). */
  function buildGameScreen(humanDeckName: string | null, asphodelDeckName: string | null): void {
    gameSection.replaceChildren();
    gameSection.className = "table-root";

    const battlefield = document.createElement("div");
    battlefield.className = "table-battlefield";

    const asphodelHalf = document.createElement("div");
    asphodelHalf.className = "table-battlefield-half table-battlefield-half--asphodel";
    asphodelCommanderDock = document.createElement("div");
    asphodelCommanderDock.className = "table-commander-dock";
    asphodelBattlefieldCards = document.createElement("div");
    asphodelBattlefieldCards.className = "table-battlefield-cards";
    asphodelHalf.append(asphodelCommanderDock, asphodelBattlefieldCards);

    const humanHalf = document.createElement("div");
    humanHalf.className = "table-battlefield-half table-battlefield-half--human";
    humanCommanderDock = document.createElement("div");
    humanCommanderDock.className = "table-commander-dock";
    humanBattlefieldCards = document.createElement("div");
    humanBattlefieldCards.className = "table-battlefield-cards";
    humanHalf.append(humanCommanderDock, humanBattlefieldCards);

    battlefield.append(asphodelHalf, humanHalf);

    const rail = document.createElement("div");
    rail.className = "table-rail-left";
    asphodelLifeEl = document.createElement("div");
    asphodelLifeEl.className = "table-life table-life--asphodel";
    actionsEl = document.createElement("div");
    actionsEl.className = "table-actions";
    humanLifeEl = document.createElement("div");
    humanLifeEl.className = "table-life table-life--human";
    rail.append(asphodelLifeEl, actionsEl, humanLifeEl);
    renderLife(asphodelLifeEl, "ASPHODEL", undefined);
    renderLife(humanLifeEl, "YOU", undefined);

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "table-menu-button";
    menuButton.textContent = "⋮";
    menuButton.setAttribute("aria-label", "Menu");
    menuPanel = document.createElement("div");
    menuPanel.className = "table-menu-panel";
    menuPanel.hidden = true;
    menuDeckInfo = document.createElement("p");
    menuDeckInfo.className = "table-menu-deck-info";
    const endButton = document.createElement("button");
    endButton.type = "button";
    endButton.className = "danger-button table-menu-end-button";
    endButton.textContent = "End Playtest";
    endButton.addEventListener("click", () => { menuPanel.hidden = true; void endGame(); });
    menuPanel.append(menuDeckInfo, endButton);
    menuButton.addEventListener("click", (event) => { event.stopPropagation(); menuPanel.hidden = !menuPanel.hidden; });
    document.addEventListener("click", () => { menuPanel.hidden = true; });
    menuPanel.addEventListener("click", (event) => event.stopPropagation());
    if (humanDeckName && asphodelDeckName) setDeckInfo(humanDeckName, asphodelDeckName);

    decisionDock = document.createElement("div");
    decisionDock.className = "table-decision-dock";

    handContainer = document.createElement("div");
    handContainer.className = "table-hand";

    gameSection.append(battlefield, rail, menuButton, menuPanel, previewPanel.element, decisionDock, handContainer);
  }

  function setDeckInfo(humanDeckName: string, asphodelDeckName: string): void {
    menuDeckInfo.textContent = `${humanDeckName} vs ${asphodelDeckName}`;
  }

  const boardCallbacks: BoardCallbacks = {
    getPresentation: (name) => cardStore.get(name),
    onCardActivate: (card: AgentCardObservation) => previewPanel.togglePin(card, card.name ? cardStore.get(card.name) : null),
    isSelected: (card: AgentCardObservation) => previewPanel.isSelected(card.cardRef),
  };

  /** Unconditionally paints the table from one observation — used both by the live (idle) path and by every played frame. */
  function paintBoard(observation: AgentObservation): void {
    const opponent = opponentPlayer(observation);
    const self = selfPlayer(observation);
    if (opponent) {
      renderLife(asphodelLifeEl, "ASPHODEL", opponent.life);
      renderCommanderDock(asphodelCommanderDock, opponent, boardCallbacks);
      renderBattlefieldHalf(asphodelBattlefieldCards, opponent, boardCallbacks);
    }
    if (self) {
      renderLife(humanLifeEl, "YOU", self.life);
      renderCommanderDock(humanCommanderDock, self, boardCallbacks);
      renderBattlefieldHalf(humanBattlefieldCards, self, boardCallbacks);
      if (self.role === "self") renderHand(handContainer, self.hand, (name) => cardStore.get(name));
    }
  }

  function pushPlayedEvent(event: PublicGameEvent): void {
    playedEvents = [...playedEvents, event].slice(-MAX_VISIBLE_ACTIONS);
    renderActions(actionsEl, playedEvents);
  }

  /** Only while frame playback is genuinely idle — never mid-queue — do we paint the live board/decision, so the human never jumps ahead of a state they have not visually seen play out. */
  function revealLiveState(state: WebPlaytestStateDTO): void {
    if (state.observation) {
      lastObservation = state.observation;
      renderTableIfChanged(state.observation);
    }
    renderDecisionIfChanged(state);
  }

  /** Feeds any newly-arrived frames into the queue and (re)starts playback — safe to call every poll; a call while already playing is a harmless no-op re-entry that keeps draining the same shared queue. */
  function pumpFrames(): void {
    void frameQueue.pump({
      onFrame: (frame) => {
        paintBoard(frame.observation);
        if (frame.event) pushPlayedEvent(frame.event);
      },
      onIdle: () => {
        if (latestState) revealLiveState(latestState);
      },
    });
  }

  async function poll(): Promise<void> {
    if (!sessionId) return;
    try {
      const state = await getPlaytestState(sessionId);
      latestState = state;
      if (state.humanDeckName && state.asphodelDeckName) setDeckInfo(state.humanDeckName, state.asphodelDeckName);
      frameQueue.enqueue(state.frames);

      const observationsInPlay = [state.observation, ...state.frames.map((f) => f.observation)]
        .filter((o): o is AgentObservation => o !== null);
      let presentationChanged = false;
      for (const observation of observationsInPlay) {
        if (await cardStore.ensure(collectVisibleCardNames(observation))) presentationChanged = true;
      }
      if (presentationChanged) lastPresentationVersion++;

      pumpFrames();

      if (TERMINAL_STATUSES.has(state.status) && frameQueue.isIdle()) {
        stopPolling();
        await renderEnd(state);
        showEndScreen();
      }
    } catch (error) {
      stopPolling();
      decisionDock.textContent = error instanceof Error ? error.message : "Lost contact with the playtest.";
    }
  }

  function renderStatusLine(status: WebPlaytestStateDTO["status"]): void {
    decisionDock.replaceChildren();
    const text = submitting ? "Submitting choice…" : {
      starting: "Starting Forge…", running: "Asphodel is thinking…",
      waiting_for_human: "", completed: "", ended_by_human: "", failed: "",
    }[status];
    if (!text) return;
    const line = document.createElement("p");
    line.className = "table-status-line";
    line.textContent = text;
    decisionDock.append(line);
  }

  function renderTableIfChanged(observation: AgentObservation): void {
    const key = JSON.stringify(observation);
    if (key === lastObservationKey && lastPresentationVersion === renderedPresentationVersion) return;
    lastObservationKey = key;
    renderedPresentationVersion = lastPresentationVersion;
    paintBoard(observation);
  }

  function renderDecisionIfChanged(state: WebPlaytestStateDTO): void {
    const key = JSON.stringify(state.pendingDecision) + (submitting ? ":submitting" : "");
    if (key === lastDecisionKey) return;
    lastDecisionKey = key;
    if (state.pendingDecision) {
      renderDecision(decisionDock, state.pendingDecision, (choice) => void submitChoice(choice));
    } else {
      renderStatusLine(state.status);
    }
  }

  async function submitChoice(choice: Parameters<typeof submitPlaytestChoice>[1]): Promise<void> {
    if (!sessionId) return;
    submitting = true;
    renderStatusLine("running");
    try {
      await submitPlaytestChoice(sessionId, choice);
    } catch (error) {
      decisionDock.textContent = error instanceof Error ? error.message : "That choice was not accepted.";
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
      decisionDock.textContent = error instanceof Error ? error.message : "Could not end the playtest.";
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
