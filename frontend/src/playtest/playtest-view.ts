import { createPhysicalScene } from './physical-scene.js';
import { DecisionGate } from './decision-gate.js';
import { decisionPresentationNames, renderDecisionCards, renderOpeningHandReview } from "./decision-cards.js";
import { ApiError } from "../api/api-client.js";
import "../styles/playtest.css";
import "../styles/tabletop.css";
import "../styles/table-scene.css";
import { createZoneInspector, renderHiddenHand, renderStack } from "./table-scene.js";
import { createDigitalBoardSlot, digitalSeatLabel, renderDigitalBoardSlot, type DigitalBoardSlot } from "./digital-board-slot.js";
import { digitalPlayerOrder, type DigitalView } from "./digital-layout.js";
import { VisualTransitions } from "./visual-transitions.js";
import { apiRequest } from "../api/api-client.js";
import { endPlaytest, getActivePlaytest, getPlaytestReport, getPlaytestState, startPlaytest, submitPlaytestChoice } from "../api/playtest-api.js";
import { element } from "../dom.js";
import { collectVisibleCardNames, commandZoneCards, formatHudPhase, opponentPlayer, renderCompactHand, renderHand, selfPlayer, type BoardCallbacks, type HandActionCallbacks } from "./board-renderer.js";
import { createCardPreviewPanel } from "./card-preview.js";
import { createHoverPreview } from "./hover-preview.js";
import { attachStateTooltip } from './state-tooltip.js';
import { CardPresentationStore } from "./card-presentation-store.js";
import { cardDisplayName } from "./card-format.js";
import { combatRelations, combatSelectedCardRefs, type CombatRelation } from "./combat-selection.js";
import { seatName } from "./player-seat.js";
import { renderDecision } from "./decision-renderer.js";
import { FramePlaybackQueue } from "./frame-playback.js";
import { createHandActionMenu } from "./hand-action-menu.js";
import { buildDockItems, decideCardAction, mapActionsToCards, splitCardActionMapByHand, type CardActionMap } from "./hand-action-mapping.js";
import { computePreviewAction } from "./preview-action.js";
import { groupManaPaymentOptions, type ManaPaymentGroups } from "./mana-payment-mapping.js";
import { createManaPaymentOverlay } from "./mana-payment-overlay.js";
import { shouldBridgeManaOverlayNull } from "./mana-payment-lifecycle.js";
import { renderPhysicalDeclare } from "./physical-declare.js";
import { createPhaseBanner, detectMajorPhaseTransition, phaseTransitionLabel } from "./phase-transitions.js";
import { createCardReveal } from "./card-reveal.js";
import { newlyArrivedPermanents } from "./reveal-detection.js";
import { presentationBeats } from './presentation-beats.js';
import { computeSeatPresentations } from "./seat-presentation.js";
import { VoiceRunner } from "../voice/voice-runner.js";
import { createVoicePanel, type VoicePanelHandle } from "../voice/voice-panel.js";
import { defaultVoiceVocabularyStorage } from "../voice/voice-vocabulary-store.js";
import "../styles/physical-companion.css";
import "../styles/physical-scene.css";
import "../styles/physical-courtyard.css";
import "../styles/physical-seat.css";
import "../styles/physical-cards.css";
import "../styles/physical-controls.css";
import "../styles/physical-flows.css";
import '../styles/physical-v2.css';
import '../styles/voice-panel.css';
import type { AgentCardObservation, AgentChoice, AgentObservation, AgentSelfPlayerObservation, DeckInput, MenuItem, PublicGameEvent, StartPlaytestRequest, WebPendingDecisionDTO, WebPlaytestStateDTO } from "./types.js";

const POLL_INTERVAL_MS = 300;
const TERMINAL_STATUSES = new Set(["completed", "ended_by_human", "failed"]);

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

/**
 * V2g "Physical Companion": a first-class Play Mode choice on the setup screen — Digital (today's
 * fully symmetric Obsidian Table, still the default/pre-selected option so nothing changes for
 * someone who doesn't notice this control) or Physical Companion (the human plays a real deck;
 * Asphodel's board dominates and the human's own half becomes a compact synchronized mirror).
 */
function createPlayModePicker(): { element: HTMLElement; getValue: () => "digital" | "physical" } {
  const wrap = document.createElement("div");
  wrap.className = "play-mode-picker";

  const heading = document.createElement("h3");
  heading.className = "deck-picker-heading";
  heading.textContent = "Play Mode";
  wrap.append(heading);

  const options = document.createElement("div");
  options.className = "play-mode-options";
  wrap.append(options);

  let value: "digital" | "physical" = "digital";

  function buildOption(mode: "digital" | "physical", title: string, description: string): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "play-mode-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "play-mode";
    input.value = mode;
    input.checked = mode === "digital";
    input.addEventListener("change", () => {
      if (!input.checked) return;
      value = mode;
      refresh();
    });
    const titleEl = document.createElement("span");
    titleEl.className = "play-mode-option-title";
    titleEl.textContent = title;
    const descriptionEl = document.createElement("span");
    descriptionEl.className = "play-mode-option-description";
    descriptionEl.textContent = description;
    label.append(input, titleEl, descriptionEl);
    return label;
  }

  const digitalOption = buildOption("digital", "Digital", "Both boards fully digital, side by side — the Obsidian Table.");
  const physicalOption = buildOption(
    "physical",
    "Physical Companion",
    "Play your real deck on the table. Asphodel's board takes center stage; declare your draws, mills and scry reveals as you go.",
  );
  options.append(digitalOption, physicalOption);

  function refresh(): void {
    digitalOption.classList.toggle("play-mode-option--selected", value === "digital");
    physicalOption.classList.toggle("play-mode-option--selected", value === "physical");
  }
  refresh();

  return { element: wrap, getValue: () => value };
}

/** Any in-flight `.table-life-delta` indicator (see showLifeDelta) is preserved across a rebuild — it manages its own removal via its own timer, independent of how often this gets called. */
function renderLife(container: HTMLElement, label: string, life: number | undefined): void {
  const inFlightDeltas = Array.from(container.querySelectorAll(".table-life-delta"));
  container.replaceChildren();
  const name = document.createElement("p");
  name.className = "table-life-name";
  name.textContent = label;
  const value = document.createElement("p");
  value.className = "table-life-value";
  value.textContent = `${life ?? "?"}`;
  container.append(name, value, ...inFlightDeltas);
}

/** A brief "+3"/"-4" float near a life total (V2e.6) — purely a display comparison between two already-displayed values, never a combat/damage rules system of its own. Removes itself once its CSS animation finishes. */
function showLifeDelta(container: HTMLElement, delta: number): void {
  const el = document.createElement("span");
  el.className = delta > 0 ? "table-life-delta table-life-delta--gain" : "table-life-delta table-life-delta--loss";
  el.textContent = delta > 0 ? `+${delta}` : `${delta}`;
  container.append(el);
  setTimeout(() => el.remove(), 700);
}

/** Compact Hearthstone-style history: last few actions, most recent least faded. Public info only (Asphodel's own accepted actions — the human already sees their own choices directly). Full card names are never truncated. */
function renderActions(container: HTMLElement, events: PublicGameEvent[]): void {
  container.replaceChildren();
  const visible = events.slice(-60);
  if (!visible.length) container.textContent = "The table is quiet.";
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
export function initPlaytestView(onGameActive: () => void = () => {}): void {
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
  let inspectionActions: CardActionMap | undefined;
  previewPanel.element.addEventListener('inspectionchange', () => updatePreviewActionable(inspectionActions));
  // V2h: a single global hover-magnify overlay, attached once for the life of the page — see
  // hover-preview.ts for why this must be a body-level portal rather than per-container CSS.
  const hoverPreview = createHoverPreview(previewPanel);
  hoverPreview.attach(document);
  attachStateTooltip(root);
  const handActionMenu = createHandActionMenu();
  const manaOverlay = createManaPaymentOverlay();
  const zoneInspector = createZoneInspector((name) => cardStore.get(name));
  const transitions = new VisualTransitions();
  const phaseBanner = createPhaseBanner();
  let lastPhaseState: { turn: number; phase: string; activePlayerId: string } | null = null;
  const cardReveal = createCardReveal();
  let lastRevealObservation: AgentObservation | null = null;
  let opponentHand: HTMLElement, stackEl: HTMLElement;
  let physicalScene: ReturnType<typeof createPhysicalScene> | null = null;
  // Voice Intent Resolver (V0) — Physical Companion only (see docs/voice-intent-resolver-v0.md).
  // `voiceRunner` persists its approved vocabulary across games (browser-local storage), so it is
  // created once, lazily, on first use rather than rebuilt per game; `voicePanel` (the DOM widget)
  // is rebuilt per game screen like every other game-screen element.
  let voiceRunner: VoiceRunner | null = null;
  let voicePanel: VoicePanelHandle | null = null;
  let stackControl: HTMLButtonElement;
  let livePlayerTargets: MenuItem[] = [];

  // Public turn-of-Asphodel frames (V2e.3) are queued and replayed in order with a short delay —
  // the human decision is only ever revealed once this queue is genuinely idle (see revealLiveState).
  let frameQueue = new FramePlaybackQueue();
  let polling = false;
  let decisionCardStore = new CardPresentationStore();
  let candidateDecisionId: string | null = null;
  let playedEvents: PublicGameEvent[] = [];
  let latestState: WebPlaytestStateDTO | null = null;
  let decisionGate = new DecisionGate();
  let gateSession: string | null = null;
  let combatFocusDecision: string | null = null;
  let spaceReadyAt = 0;
  // V2g "Physical Companion": set once per game (at buildGameScreen time) from the chosen
  // StartPlaytestRequest.playMode, or from the resumed/polled WebPlaytestStateDTO.playMode — never
  // re-derived. Digital mode reads this closure variable but it is always "digital" there, so every
  // branch on it below is a genuinely additive no-op for Digital.
  let currentPlayMode: "digital" | "physical" = "digital";

  // Persistent game-screen elements, built once per game — never torn down by a poll, so the
  // pinned preview, menu state and any hover survive polling. Each section only re-renders when
  // its own underlying data actually changed (or, for frame playback, once per played frame).
  let actionsEl: HTMLElement, handContainer: HTMLElement;
  // V-milestone1: one generic slot per player board (see digital-board-slot.ts) instead of a
  // hardcoded asphodel/human pair of element variables — see buildGameScreen/paintBoard.
  let digitalBoardSlots: DigitalBoardSlot[] = [];
  let hudTurnEl: HTMLElement, hudPhaseEl: HTMLElement;
  let decisionDock: HTMLElement, menuPanel: HTMLElement, menuDeckInfo: HTMLElement;
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat || performance.now() < spaceReadyAt || event.timeStamp < spaceReadyAt || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || gameSection.hidden || currentPlayMode !== 'physical' || submitting || !frameQueue.isIdle()) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, [contenteditable], summary, [role="dialog"]') || gameSection.querySelector('dialog[open], .table-mana-overlay:not([hidden]), .table-hand-menu:not([hidden])')) return;
    const pending = latestState?.pendingDecision;
    if (pending?.type !== 'priority_action' || pending.rendered.kind !== 'menu') return;
    const pass = pending.rendered.items.find(item => item.control === 'pass');
    if (pass) { event.preventDefault(); void submitChoice(pass.choice); }
  });
  const lastKnownLife = new WeakMap<HTMLElement, number>();
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
    frameQueue = new FramePlaybackQueue();
    lastObservation = null;
    lastObservationKey = "";
    lastDecisionKey = "";
    playedEvents = [];
    latestState = null;
    currentPlayMode = "digital";
    transitions.reset();
    phaseBanner.reset();
    lastPhaseState = null;
    cardReveal.hide();
    lastRevealObservation = null;
    physicalScene = null;
    voicePanel?.stop();
    voicePanel = null;
    zoneInspector.close();
    document.body.classList.remove("tabletop-active");
    previewPanel.close();
    hoverPreview.hide();
    handActionMenu.close();
    manaOverlay.close();
    setupSection.hidden = false;
    gameSection.hidden = true;
    endSection.hidden = true;
    renderSetup();
  }

  function showGameScreen(): void {
    onGameActive();
    document.body.classList.add("tabletop-active");
    setupSection.hidden = true;
    gameSection.hidden = false;
    endSection.hidden = true;
  }

  function showEndScreen(): void {
    transitions.reset();
    physicalScene = null;
    voicePanel?.stop();
    voicePanel = null;
    zoneInspector.close();
    hoverPreview.hide();
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
      if ("sessionId" in result && !TERMINAL_STATUSES.has(result.status)) {
        sessionId = result.sessionId;
        currentPlayMode = result.playMode;
        buildGameScreen(result.humanDeckName, result.asphodelDeckName);
        showGameScreen();
        frameQueue = new FramePlaybackQueue();
        frameQueue.acknowledge(result.frames);
        playedEvents = result.publicEvents.slice(-60); renderActions(actionsEl, playedEvents);
        const initial = result.observation ?? result.frames.at(-1)?.observation;
        if (initial) { await cardStore.ensure(collectVisibleCardNames(initial)).catch(() => {}); paintBoard(initial); }
        pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
        await poll();
        return;
      }
    } catch {
      /* Fall through to a fresh setup screen — nothing to resume, or the backend is unreachable. */
    }
    showSetup();
    const retry = document.createElement('button'); retry.type='button'; retry.className='secondary-button'; retry.textContent='Resume active game';
    retry.onclick=()=>void resumeActivePlaytestIfAny(); setupSection.append(retry);
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

    const playModePicker = createPlayModePicker();
    setupSection.append(playModePicker.element);

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
        playMode: playModePicker.getValue(),
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
      currentPlayMode = request.playMode ?? "digital";
      buildGameScreen(null, null);
      showGameScreen();
      pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
      await poll();
    } catch (error) {
      feedback.hidden = false;
      if (error instanceof ApiError && error.payload.error === 'PLAYTEST_ALREADY_RUNNING') { await resumeActivePlaytestIfAny(); return; }
      feedback.textContent = error instanceof Error ? error.message : "Could not start the playtest.";
    } finally {
      button.disabled = false;
      button.textContent = "Start Playtest";
    }
  }

  /** The battlefield fills the screen; header/nav/import chrome is hidden via the "tabletop-active" body class (see styles/tabletop.css). */
  function buildGameScreen(humanDeckName: string | null, asphodelDeckName: string | null): void {
    transitions.reset();
    physicalScene = currentPlayMode === "physical" ? createPhysicalScene(zoneInspector.open) : null;
    // Voice Intent Resolver (V0): Physical Companion only — Digital never mounts this at all (spec
    // "Do not clutter Digital mode"). The runner (approved vocabulary) is created once and reused
    // across games in this tab; the panel (DOM widget) is rebuilt per game like every other
    // game-screen element. `canAct` is a UX-only pre-check — the actual guard is `submitChoice`
    // itself (DecisionGate + frame-playback + `submitting`), which is the SAME function a click
    // already calls; voice never bypasses or duplicates it.
    if (currentPlayMode === "physical") {
      voiceRunner ??= new VoiceRunner({
        getPendingDecision: () => latestState?.pendingDecision ?? null,
        getObservation: () => latestState?.observation ?? null,
        canAct: () => currentPlayMode === "physical" && frameQueue.isIdle() && !submitting && Boolean(latestState?.pendingDecision),
        submit: (choice) => void submitChoice(choice),
        storage: defaultVoiceVocabularyStorage(),
      });
      voicePanel = createVoicePanel(voiceRunner);
    } else {
      voicePanel = null;
    }
    zoneInspector.close();
    gameSection.replaceChildren();
    gameSection.className = "table-root";
    gameSection.dataset.environment = "courtyard";
    gameSection.dataset.playMode = currentPlayMode;
    // V2g: the ONE branch point for seat presentation (see seat-presentation.ts) — every rendering
    // function below stays exactly as seat-agnostic as before. Digital always resolves both seats to
    // "primary", and a "primary" seat's className is left byte-for-byte identical to before V2g
    // (no class added/removed) — only a non-"primary" (i.e. "compact", Physical mode's human seat)
    // emphasis ever appends an extra class.
    gameSection.classList.toggle("table-root--physical", currentPlayMode === "physical");
    const seatPresentations = computeSeatPresentations(currentPlayMode, "human", "agent");
    const emphasisClass = (emphasis: string) => (emphasis === "primary" ? "" : ` table-battlefield-half--${emphasis}`);

    const battlefield = document.createElement("div");
    battlefield.className = "table-battlefield";

    // Milestone 2 "PLAYER VIEWPORTS, NOT humanTop/opponentBottom": one generic viewport per player
    // (see digital-board-slot.ts) instead of a hardcoded asphodel/human pair of element variables.
    // Which observed player fills which viewport is decided by digital-layout.ts's
    // `digitalPlayerOrder` — the one seam a future N-player Digital layout would actually grow;
    // paintBoard below only ever renders "the player for viewport i", generically.
    digitalBoardSlots = [
      createDigitalBoardSlot("asphodel", emphasisClass(seatPresentations.opponent.emphasis)),
      createDigitalBoardSlot("human", emphasisClass(seatPresentations.human.emphasis)),
    ];
    battlefield.append(...digitalBoardSlots.map((slot) => slot.half));

    const hud = document.createElement("div");
    hud.className = "table-hud";
    hudTurnEl = document.createElement("p");
    hudTurnEl.className = "table-hud-line table-hud-turn";
    hudPhaseEl = document.createElement("p");
    hudPhaseEl.className = "table-hud-line table-hud-phase";
    const modeLabel = document.createElement('p'); modeLabel.className = 'table-play-mode';
    modeLabel.textContent = currentPlayMode === 'physical' ? 'Physical Companion' : 'Digital';
    hud.append(modeLabel, hudTurnEl, hudPhaseEl);

    /*
     * Milestone 2 "CLICK THE VIEWPORT, REAL RELAYOUT": no more small per-viewport Focus button — the
     * viewport itself is the click target (see each slot's `onclick` below), and the state is keyed
     * by `playerId` (`DigitalView`), never a slot index, so it never bakes in "exactly two visual
     * regions". `applyDigitalFocus` only ever toggles classes/attributes; the actual reflow (focused
     * viewport takes most of the row, the other genuinely re-lays out as a small preview column — no
     * `transform: scale()`) lives entirely in styles/table-scene.css's `--focused` rules.
     */
    let digitalView: DigitalView = { mode: "overview" };
    const tableViewButton = document.createElement('button');
    tableViewButton.type = 'button';
    tableViewButton.className = 'table-focus-return';
    tableViewButton.textContent = '← Table view';
    tableViewButton.hidden = true;
    const applyDigitalFocus = () => {
      const focusedPlayerId = digitalView.mode === "focus" ? digitalView.playerId : null;
      battlefield.classList.toggle("table-battlefield--focused", focusedPlayerId !== null);
      for (const slot of digitalBoardSlots) {
        slot.half.classList.toggle("table-battlefield-half--focused", slot.half.dataset.playerId === focusedPlayerId);
      }
      tableViewButton.hidden = focusedPlayerId === null;
    };
    for (const slot of digitalBoardSlots) {
      // The primary Digital focus interaction (replaces the old per-viewport Focus button): click
      // anywhere non-interactive on a viewport — overview or receded preview alike — to focus that
      // player. Must never swallow a click meant for an actual card/zone/button/decision control,
      // so any such target is excluded first, before ever touching `digitalView`.
      slot.half.onclick = (event) => {
        const playerId = slot.half.dataset.playerId;
        if (!playerId) return; // nothing painted into this viewport yet
        if ((event.target as HTMLElement).closest('button, a, input, summary, .table-card, [data-zone]')) return;
        if (digitalView.mode === "focus" && digitalView.playerId === playerId) return; // already focused: no-op
        digitalView = { mode: "focus", playerId };
        applyDigitalFocus();
      };
    }
    tableViewButton.onclick = () => { digitalView = { mode: "overview" }; applyDigitalFocus(); };

    const rail = document.createElement("div");
    rail.className = "table-rail-left";
    actionsEl = document.createElement("div");
    actionsEl.className = "table-actions";
    const history = document.createElement('details'); history.className = 'table-history';
    const historyTitle = document.createElement('summary'); historyTitle.textContent = 'Recent actions';
    history.append(historyTitle, actionsEl); rail.append(history);
    opponentHand = document.createElement('div'); opponentHand.className = 'table-opponent-hand';
    stackEl = document.createElement('div'); stackEl.className = 'table-stack'; stackEl.hidden = true;
    stackEl.setAttribute('aria-label', 'Spell stack');
    const wordmark = document.createElement('div'); wordmark.className = 'table-wordmark'; wordmark.textContent = 'ASPHODEL';
    battlefield.append(opponentHand, wordmark);
    stackControl = document.createElement('button'); stackControl.type = 'button'; stackControl.className = 'table-stack-control'; stackControl.textContent = 'Stack · 0';
    const stackDrawer = document.createElement('aside'); stackDrawer.className = 'table-stack-drawer'; stackDrawer.hidden = true; stackDrawer.setAttribute('aria-label', 'Spell stack');
    const closeStack = document.createElement('button'); closeStack.textContent = 'Close stack ×';
    const toggleStack = (open: boolean) => { stackDrawer.hidden = !open; stackControl.setAttribute('aria-expanded', String(open)); if (!open) stackControl.focus(); else closeStack.focus(); };
    stackControl.dataset.zone = 'stack';
    stackControl.setAttribute('aria-expanded', 'false'); stackControl.onclick = () => toggleStack(Boolean(stackDrawer.hidden));
    closeStack.onclick = () => toggleStack(false);
    stackDrawer.onkeydown = event => { if (event.key === 'Escape') { event.stopPropagation(); toggleStack(false); } };
    stackDrawer.append(closeStack, stackEl); gameSection.append(stackControl, stackDrawer);
    // Pre-observation placeholder labels only — once real data arrives, paintBoard's per-slot
    // `renderLifeWithDelta` call takes over with `digitalSeatLabel` (see digital-board-slot.ts).
    renderLife(digitalBoardSlots[0].life, "ASPHODEL", undefined);
    renderLife(digitalBoardSlots[1].life, "YOU", undefined);

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

    if (physicalScene) gameSection.append(physicalScene.element, physicalScene.overview);
    if (voicePanel) gameSection.append(voicePanel.element);
    if (!physicalScene) gameSection.append(battlefield, handContainer);
    gameSection.append(rail, hud, tableViewButton, phaseBanner.element, cardReveal.element, menuButton, menuPanel, previewPanel.element, decisionDock, handActionMenu.element, manaOverlay.element, zoneInspector.element);
  }

  function setDeckInfo(humanDeckName: string, asphodelDeckName: string): void {
    menuDeckInfo.textContent = `${humanDeckName} vs ${asphodelDeckName}`;
  }

  /**
   * V2f.1 §§1-2: inspecting a card and a legal Forge action existing for that same card are
   * independent, coexisting states — refreshes the preview panel's small explicit action control
   * for whichever card is CURRENTLY previewed (if any), from the board's CURRENT action mapping
   * (if any). Call after every board paint, and immediately after a click toggles the preview, so
   * the control is never stale relative to the decision actually showing.
   */
  function updatePreviewActionable(boardActionMap: CardActionMap | undefined): void {
    const action = computePreviewAction(previewPanel.current(), boardActionMap);
    if (!action) {
      previewPanel.setActionable(null, null);
      return;
    }
    previewPanel.setActionable(action.label, (buttonElement) => {
      const decision = decideCardAction(action.items);
      if (decision.kind === "submit") {
        handActionMenu.close();
        void submitChoice(decision.choice);
      } else {
        handActionMenu.openFor(buttonElement, decision.items, (choice) => {
          handActionMenu.close();
          void submitChoice(choice);
        });
      }
    });
  }

  function renderLifeWithDelta(container: HTMLElement, label: string, life: number | undefined): void {
    const previous = lastKnownLife.get(container);
    renderLife(container, label, life);
    if (life !== undefined) {
      if (previous !== undefined && previous !== life) showLifeDelta(container, life - previous);
      lastKnownLife.set(container, life);
    }
  }

  /** Updates one HUD line only when its text actually changed, with a brief transition — see styles/tabletop.css `.table-hud-line--changed`. */
  function updateHudLine(el: HTMLElement, text: string): void {
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove("table-hud-line--changed");
    void el.offsetWidth; // restart the animation even if it was still running from a rapid prior change
    el.classList.add("table-hud-line--changed");
  }

  /**
   * V2h "COMBAT READABILITY": resolves one `CombatRelation.relatedRef` (either a defending player's
   * id, for an attacker, or the attacker's own cardRef, for a blocker — see combat-selection.ts) to
   * a short display name, purely from the already-visible `observation` — never a new lookup source,
   * never a rules input. Falls back to the raw ref only if genuinely nothing matches (should not
   * happen in practice, since Forge only ever reports a real player/card as the related object).
   */
  function resolveCombatRelatedName(observation: AgentObservation, ref: string): string {
    const player = observation.players.find((p) => p.playerId === ref);
    if (player) return seatName(player, observation);
    for (const p of observation.players) {
      const zones: AgentCardObservation[][] = [p.battlefield, p.graveyard, p.exile, commandZoneCards(p)];
      if (p.role === "self") zones.push((p as AgentSelfPlayerObservation).hand);
      for (const zone of zones) {
        const card = zone.find((c) => c.cardRef === ref);
        if (card) return cardDisplayName(card);
      }
    }
    return ref;
  }

  /** Small, elegant turn/phase HUD (V2e.6) — uses the actual current Forge turn/phase, never a guess; friendly combat-phase labels via `formatHudPhase`. */
  function renderHud(observation: AgentObservation): void {
    const activeLabel = observation.players.find(p => p.playerId === observation.game.activePlayerId)?.name ?? "Player";
    updateHudLine(hudTurnEl, `Turn ${observation.game.turn} · ${activeLabel}`);
    updateHudLine(hudPhaseEl, formatHudPhase(observation.game.phase));

    // V2h "MAJOR PHASE / CHAPTER TRANSITIONS": only the handful of genuinely major beats — see
    // phase-transitions.ts. Fires from every board paint (live idle AND each played frame), exactly
    // like the HUD lines above, so it fires once per real transition regardless of which path
    // painted it.
    const phaseState = { turn: observation.game.turn, phase: observation.game.phase, activePlayerId: observation.game.activePlayerId };
    const transition = detectMajorPhaseTransition(lastPhaseState, phaseState, observation.selfPlayerId);
    lastPhaseState = phaseState;
    if (transition) {
      const opponent = opponentPlayer(observation);
      phaseBanner.show(transition, phaseTransitionLabel(transition, opponent ? seatName(opponent, observation) : "Opponent"));
    }
  }

  /**
   * Unconditionally paints the table from one observation — used both by the live (idle) path and
   * by every played frame. `handActions`/`boardActionMap` are supplied only by the live path, and
   * only while an actual menu decision is genuinely showing (see `computeActiveMapping`) — a
   * played frame never passes either, so no card is ever clickable-for-a-decision mid-Asphodel-
   * turn-playback. `combatSelectedRefs` (V2e.6) is Forge's own declared attackers/blockers for the
   * current decision, if any — entirely independent of tapped state.
   */
  function paintBoard(observation: AgentObservation, handActions?: HandActionCallbacks, boardActionMap?: CardActionMap, combatSelectedRefs?: ReadonlySet<string>, combatRelationMap?: ReadonlyMap<string, CombatRelation>): void {
    inspectionActions = boardActionMap;
    // V2h "NEWLY PLAYED CARD REVEAL": one restrained large reveal for the first significant new
    // battlefield arrival this paint represents (a fast multi-ETB burst reveals only its first card
    // rather than stacking several at once — see reveal-detection.ts). Computed BEFORE updating
    // `lastRevealObservation` so this is always a diff against the previously PAINTED state, live or
    // played-frame alike.
    const revealed = newlyArrivedPermanents(lastRevealObservation, observation)[0];
    lastRevealObservation = observation;
    if (revealed && (currentPlayMode !== 'physical' || frameQueue.isIdle())) cardReveal.show(revealed, revealed.name ? cardStore.get(revealed.name) : null);

    const expand = Boolean(boardActionMap && boardActionMap.byCardRef.size > 0);
    const isCombatSelected = (card: AgentCardObservation) => combatSelectedRefs?.has(card.cardRef) ?? false;
    const combatTag = (card: AgentCardObservation) => {
      const relation = combatRelationMap?.get(card.cardRef);
      return relation ? { role: relation.role, relatedName: resolveCombatRelatedName(observation, relation.relatedRef) } : null;
    };
    // V2f.1 §§1-3: ONE consistent callback set, always — a card being actionable never replaces or
    // suppresses its ability to be inspected (`onCardActivate` always just toggles the preview),
    // never forces `isSelected` false, and `isPlayable` reflects the CURRENT decision's exact
    // mapping regardless of whether ANY other card also happens to be actionable this render. The
    // action itself is triggered only from the preview panel's own explicit control (see
    // `updatePreviewActionable`) — never from the inspecting click itself.
    const boardCallbacksForThisRender: BoardCallbacks = {
      // Digital and Physical share the same condensed battlefield/land presentation (cropped
      // artwork + name + P/T + counters/keywords, full card on hover) — see board-renderer.ts's
      // `variant` selection. physical-scene.ts's own override of this field is now redundant but
      // harmless; the source of truth is here so a Digital permanent never renders as a full
      // printed Magic card.
      battlefieldStyle: "condensed",
      getPresentation: (name) => cardStore.get(name),
      isSelected: (card) => previewPanel.isSelected(card.cardRef),
      isPlayable: (card) => boardActionMap?.byCardRef.has(card.cardRef) ?? false,
      isCombatSelected,
      combatTag,
      onCardInspect: physicalScene ? (card) => { previewPanel.togglePin(card, card.name && !card.hidden && !card.faceDown ? cardStore.get(card.name) : null); updatePreviewActionable(boardActionMap); } : undefined,
      onCardActivate: (card, anchor) => {
        const items = boardActionMap?.byCardRef.get(card.cardRef);
        if (physicalScene && items?.length) { handleManaSourceActivate(card.cardRef, items, anchor); return; }
        previewPanel.togglePin(card, card.name ? cardStore.get(card.name) : null);
        updatePreviewActionable(boardActionMap);
      },
    };

    transitions.paint(gameSection, observation, () => {
    zoneInspector.refresh(observation);
    renderHud(observation);
    renderStack(stackEl, observation);
    stackControl.textContent = `Stack · ${observation.stack.length}`;
    if (physicalScene) { physicalScene.render(observation, boardCallbacksForThisRender, expand, livePlayerTargets, (items, anchor) => handleManaSourceActivate("", items, anchor)); return; }

    // Milestone 2: one loop over generic viewports (see digital-board-slot.ts) instead of a
    // duplicated opponent/self block — `digitalPlayerOrder` (digital-layout.ts) is the only place
    // deciding which player fills which viewport, ready for a future N-player viewport list.
    const players = digitalPlayerOrder(observation);
    digitalBoardSlots.forEach((slot, index) => {
      const player = players[index];
      if (!player) return;
      renderDigitalBoardSlot(slot, player, observation, boardCallbacksForThisRender, expand, (name) => cardStore.get(name), zoneInspector.open);
      renderLifeWithDelta(slot.life, digitalSeatLabel(player, observation), player.life);
      if (player.role === "opponent") renderHiddenHand(opponentHand, player.handSize);
      // V2g: the human has real physical cards, so their own hand is never a clickable digital
      // surface in Physical mode — a compact "HAND · N" indicator (+ collapsible verifier) instead.
      // Digital mode's `renderHand` call is untouched.
      if (player.role === "self") {
        if (currentPlayMode === "physical") renderCompactHand(handContainer, player.hand);
        else renderHand(handContainer, player.hand, (name) => cardStore.get(name), handActions);
      }
    });
    });
    // Also refresh outside of a fresh click — e.g. the same card stays previewed across a poll
    // while the underlying decision (and so its legal actions) changed, or Asphodel's turn frame
    // playback supplies no boardActionMap at all and any stale control must disappear.
    previewPanel.refresh(observation, name => cardStore.get(name));
    updatePreviewActionable(boardActionMap);
  }

  /**
   * V2e.6: maps the current menu decision's exact legal actions onto EVERY visible card that could
   * represent one — the human's own hand AND, at the same time, every visible battlefield/
   * commander-dock card (either player's). Previously (V2e.4/V2e.5) `priority_action` was
   * special-cased to the hand only, which meant an activated ability already on the battlefield
   * (Skirk Prospector, Zuran Orb, a utility land, a mana creature) was never presented as a
   * clickable card — a castable hand card and an activatable battlefield permanent can now both be
   * highlighted from the SAME `priority_action` decision. `splitCardActionMapByHand` partitions one
   * combined mapping into `hand`/`board` buckets after the fact — no decision type is special-cased
   * beyond mana_payment (which has its own dedicated overlay, see `computeManaPaymentGroups` below,
   * and must never ALSO expand/highlight lands on the normal board). Returns `null` whenever
   * nothing at all can be mapped (a value/mode/mana-payment prompt, or simply no matching card
   * visible) — the board then stays fully grouped/uninteractive for this decision, exactly as
   * before. Never re-derives legality; every mapped item is copied verbatim from Forge's own data.
   */
  function computeActiveMapping(state: WebPlaytestStateDTO): { hand: CardActionMap; board: CardActionMap; unmapped: MenuItem[] } | null {
    const pending = state.pendingDecision;
    if (!pending || pending.rendered.kind !== "menu" || pending.type === "mana_payment") return null;
    if (!state.observation) return null;
    const self = selfPlayer(state.observation);
    const allRefs: string[] = [];
    const handRefs: string[] = [];
    for (const player of state.observation.players) {
      for (const zone of [player.battlefield, commandZoneCards(player)]) for (const card of zone) allRefs.push(card.cardRef);
    }
    if (self?.role === "self") {
      for (const card of (self as AgentSelfPlayerObservation).hand) {
        allRefs.push(card.cardRef);
        handRefs.push(card.cardRef);
      }
    }
    const combined = mapActionsToCards(pending.rendered, allRefs);
    if (combined.byCardRef.size === 0) return null;
    const { hand, board } = splitCardActionMapByHand(combined, handRefs);
    return { hand, board, unmapped: combined.unmapped };
  }

  /** Wires a CardActionMap's per-card action lists into click behavior: one legal action submits it directly, several open the contextual menu anchored to the clicked card. */
  function buildHandActionCallbacks(mapping: CardActionMap): HandActionCallbacks {
    return {
      isPlayable: (card) => mapping.byCardRef.has(card.cardRef),
      onActivate: (card, cardElement) => {
        const items = mapping.byCardRef.get(card.cardRef);
        if (!items) return;
        const decision = decideCardAction(items);
        if (decision.kind === "submit") {
          handActionMenu.close();
          void submitChoice(decision.choice);
        } else {
          handActionMenu.openFor(cardElement, decision.items, (choice) => {
            handActionMenu.close();
            void submitChoice(choice);
          });
        }
      },
    };
  }

  /**
   * The action dock only ever shows what a card cannot already represent. In Digital mode that's
   * "Pass priority"/"Finish" and any legal action with no matching visible card (hand or board). In
   * Physical mode (V2g.1) it's the same PLUS every action mapped to a human hand card, since the
   * compact hand is never a clickable digital surface there — see `buildDockItems`. `dockItems` is
   * the already-play-mode-aware list computed by the caller; title/context are untouched, only the
   * menu's own item list is replaced.
   */
  function filterDockDecision(pending: WebPendingDecisionDTO, dockItems: MenuItem[] | null): WebPendingDecisionDTO {
    if (currentPlayMode === 'physical' && pending.rendered.kind === 'menu' && pending.type === 'priority_action') return pending;
    if (currentPlayMode === 'physical' && pending.rendered.kind === 'menu' && livePlayerTargets.length) {
      return { ...pending, rendered: { ...pending.rendered, items: (dockItems ?? pending.rendered.items).filter(item => !livePlayerTargets.includes(item)) } };
    }
    if (!dockItems || pending.rendered.kind !== "menu") return pending;
    return { ...pending, rendered: { ...pending.rendered, items: dockItems } };
  }

  /**
   * V2e.5.1: groups the current `mana_payment` decision's items into lands/other-sources/floating
   * (`mana-payment-mapping.ts`), using the human's own currently-visible battlefield/command cards
   * for display — a mana source is always the paying player's own permanent. Returns `null` when
   * there is nothing to show (not a mana_payment decision, or no observation yet).
   */
  function computeManaPaymentGroups(state: WebPlaytestStateDTO): { costText: string; groups: ManaPaymentGroups } | null {
    const pending = state.pendingDecision;
    if (!pending || pending.type !== "mana_payment" || pending.rendered.kind !== "menu") return null;
    const self = state.observation ? selfPlayer(state.observation) : undefined;
    if (!self) return null;
    const cardsByRef = new Map<string, AgentCardObservation>();
    for (const card of [...self.battlefield, ...commandZoneCards(self)]) cardsByRef.set(card.cardRef, card);
    const groups = groupManaPaymentOptions(pending.rendered.items, cardsByRef);
    const costText = pending.rendered.title.replace(/^Pay mana:\s*/, "");
    return { costText, groups };
  }

  /** Clicking a mana source card: one legal option submits it directly; several (a multi-color source) open the same contextual menu component used everywhere else, anchored to the clicked card. Never invents/taps anything locally — always waits for Forge's own next state. */
  function handleManaSourceActivate(_cardRef: string, options: MenuItem[], anchor: HTMLElement): void {
    const decision = decideCardAction(options);
    if (decision.kind === "submit") {
      handActionMenu.close();
      void submitChoice(decision.choice);
    } else {
      handActionMenu.openFor(anchor, decision.items, (choice) => {
        handActionMenu.close();
        void submitChoice(choice);
      });
    }
  }

  function handleFloatingManaActivate(choice: AgentChoice): void {
    void submitChoice(choice);
  }

  function pushPlayedEvent(event: PublicGameEvent): void {
    playedEvents = [...playedEvents, event].slice(-60);
    renderActions(actionsEl, playedEvents);
  }

  /** Only while frame playback is genuinely idle — never mid-queue — do we paint the live board/decision, so the human never jumps ahead of a state they have not visually seen play out. */
  function revealLiveState(state: WebPlaytestStateDTO): void {
    if (state.pendingDecision && (submitting || !decisionGate.allows(state.pendingDecision.decisionId))) {
      state = { ...state, pendingDecision: null };
    }
    const active = computeActiveMapping(state);
    livePlayerTargets = state.pendingDecision?.rendered.kind === 'menu' ? state.pendingDecision.rendered.items.filter(item => item.playerId) : [];
    gameSection.classList.toggle('physical-input-required', currentPlayMode === 'physical' && Boolean(state.pendingDecision) && !submitting);
    if (state.observation) {
      lastObservation = state.observation;
      renderTableIfChanged(state.observation, state.pendingDecision, active);
      if (physicalScene && state.pendingDecision && /^(attackers|blockers)_selection$/.test(state.pendingDecision.type)
          && combatFocusDecision !== state.pendingDecision.decisionId) {
        combatFocusDecision = state.pendingDecision.decisionId;
        physicalScene.focusPlayer(state.observation.selfPlayerId);
      }
    }
    // V2g.1: which of `active`'s mapped items belong in the dock depends on Play Mode — see
    // `buildDockItems`'s doc comment for the exact Digital/Physical rule.
    renderDecisionIfChanged(state, active ? buildDockItems(active, currentPlayMode) : null);
    // Voice Intent Resolver (V0): this is exactly "the new authoritative state" a running compound
    // plan (see voice-runner.ts's `advancePlan`) must wait for before resolving its next step — never
    // called from anywhere else, so a plan never advances against playback-in-flight/stale state.
    voicePanel?.refresh();
  }

  /** Feeds any newly-arrived frames into the queue and (re)starts playback — safe to call every poll; a call while already playing is a harmless no-op re-entry that keeps draining the same shared queue. */
  function pumpFrames(): void {
    const queue = frameQueue;
    const pumpingSession = sessionId;
    const current = () => queue === frameQueue && sessionId === pumpingSession && !gameSection.hidden;
    const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
    let beats: ReturnType<typeof presentationBeats> = { spells: [], arrivals: [], unshownArrivals: [] };
    void frameQueue.pump({
      isCurrent: current,
      beforeFrame: currentPlayMode === 'physical' ? async frame => {
        gameSection.dataset.playback = 'playing';
        gameSection.classList.remove('physical-input-required');
        decisionDock.replaceChildren();
        lastDecisionKey = '';
        inspectionActions = undefined;
        previewPanel.setActionable(null, null);
        handActionMenu.close();
        beats = presentationBeats(lastRevealObservation, frame.observation);
        const transition = detectMajorPhaseTransition(lastPhaseState, frame.observation.game, frame.observation.selfPlayerId);
        if (transition) {
          renderHud(frame.observation);
          await pause(2100);
        }
      } : undefined,
      onFrame: (frame) => {
        gameSection.dataset.playback = 'playing';
        livePlayerTargets = [];
        gameSection.classList.remove('physical-input-required');
        paintBoard(frame.observation);
        if (frame.event) pushPlayedEvent(frame.event);
      },
      afterFrame: currentPlayMode === 'physical' ? async (frame, duration) => {
        const reveals = [...beats.spells, ...beats.unshownArrivals];
        for (const card of reveals) {
          if (!current()) return;
          await cardReveal.present(card, card.name ? cardStore.get(card.name) : null, frame.event?.text ?? `${card.name} · enters the battlefield`);
        }
        for (const card of beats.arrivals) {
          if (!current()) return;
          await cardReveal.settle(card, card.name ? cardStore.get(card.name) : null, gameSection);
        }
        if (reveals.length || beats.arrivals.length) await pause(200);
        else await pause(duration);
      } : undefined,
      onIdle: () => {
        gameSection.dataset.playback = 'idle';
        if (latestState) revealLiveState(latestState);
      },
    });
  }

  async function poll(): Promise<void> {
    if (!sessionId || polling) return;
    polling = true;
    const pollingSession = sessionId;
    try {
      const state = await getPlaytestState(sessionId);
      if (sessionId !== pollingSession) return;
      latestState = state;
      if (gateSession !== sessionId) { gateSession = sessionId; decisionGate = new DecisionGate(); combatFocusDecision = null; }
      decisionGate.observe(state.pendingDecision?.decisionId ?? null);
      gameSection.dataset.connection = 'connected';
      currentPlayMode = state.playMode; // V2g: static for a session's lifetime, but always kept in sync with the backend's own DTO rather than trusted-once.
      if (state.humanDeckName && state.asphodelDeckName) setDeckInfo(state.humanDeckName, state.asphodelDeckName);
      frameQueue.enqueue(state.frames);

      const observationsInPlay = [state.observation, ...state.frames.map((f) => f.observation)]
        .filter((o): o is AgentObservation => o !== null);
      let presentationChanged = false;
      for (const observation of observationsInPlay) {
        if (await cardStore.ensure(collectVisibleCardNames(observation)).catch(() => false)) presentationChanged = true;
      }
      if (presentationChanged) lastPresentationVersion++;

      const candidateId = state.pendingDecision?.decisionId ?? null;
      if (candidateDecisionId !== candidateId) { decisionCardStore = new CardPresentationStore(); candidateDecisionId = candidateId; }
      const names = decisionPresentationNames(state.pendingDecision?.rendered);
      for (let i=0;i<names.length;i+=75) await decisionCardStore.ensure(names.slice(i,i+75)).catch(() => false);
      if (sessionId !== pollingSession) return;
      pumpFrames();

      if (TERMINAL_STATUSES.has(state.status) && frameQueue.isIdle()) {
        stopPolling();
        await renderEnd(state);
        showEndScreen();
      }
    } catch (error) {
      stopPolling();
      if (sessionId !== pollingSession) return;
      gameSection.dataset.connection = 'disconnected';
      if (error instanceof ApiError && error.status === 404) { showSetup(); return; }
      decisionDock.textContent = error instanceof Error ? error.message : "Lost contact with the playtest.";
      const retry=document.createElement('button'); retry.textContent='Reconnect'; retry.onclick=()=> { pollTimer=setInterval(()=>void poll(),POLL_INTERVAL_MS); void poll(); }; decisionDock.append(retry);
    } finally { polling = false; }
  }

  function renderStatusLine(status: WebPlaytestStateDTO["status"]): void {
    decisionDock.replaceChildren();
    decisionDock.classList.remove("table-decision-dock--complex", "table-decision-dock--cards", "physical-declaration");
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

  function renderTableIfChanged(observation: AgentObservation, pendingDecision: WebPendingDecisionDTO | null, active: { hand: CardActionMap; board: CardActionMap; unmapped: MenuItem[] } | null): void {
    // `pendingDecision` is folded into the key too — a card's playable highlight (and, since
    // V2e.5, the battlefield's expanded/grouped mode) is part of what "the table" looks like, even
    // though it is only ever derived, never itself the source of a new decision. (Maps don't
    // survive JSON.stringify meaningfully, so `active` itself is deliberately NOT part of the key —
    // it's a pure function of these two already-covered inputs.)
    const key = JSON.stringify(observation) + "|" + JSON.stringify(pendingDecision);
    if (key === lastObservationKey && lastPresentationVersion === renderedPresentationVersion) return;
    lastObservationKey = key;
    renderedPresentationVersion = lastPresentationVersion;
    paintBoard(
      observation,
      active ? buildHandActionCallbacks(active.hand) : undefined,
      active?.board,
      combatSelectedCardRefs(pendingDecision) ?? undefined,
      combatRelations(pendingDecision) ?? undefined,
    );
  }

  function renderDecisionIfChanged(state: WebPlaytestStateDTO, dockItems: MenuItem[] | null): void {
    const key = JSON.stringify(state.pendingDecision) + (submitting ? ":submitting" : "");
    if (key === lastDecisionKey) return;
    lastDecisionKey = key;
    if (state.pendingDecision) spaceReadyAt = performance.now() + 650;
    handActionMenu.close();

    // mana_payment (V2e.5.1): a dedicated visual overlay entirely replaces the generic decision
    // buttons — never the old "[Mountain produces R]"-style dock list.
    if (state.pendingDecision?.type === "mana_payment") {
      decisionDock.replaceChildren();
      const manaData = computeManaPaymentGroups(state);
      if (manaData) {
        manaOverlay.render(manaData.costText, manaData.groups, (name) => cardStore.get(name), handleManaSourceActivate, handleFloatingManaActivate);
      } else {
        manaOverlay.close();
      }
      return;
    }
    // V2h "MANA/PAYMENT DECISION UI MUST NOT REMOUNT" / V2h.1 "OVERLAY LIFECYCLE": between two
    // steps of the SAME multi-step mana payment, the backend genuinely has no pending decision for
    // a beat — Forge has accepted the previous mana choice and is still computing the next
    // mana_payment decision (the remaining cost) on its own thread. That is a real, accurate
    // "nothing to show yet" state, not "the payment ended" — closing the overlay for it and
    // reopening a beat later is exactly the close-then-reopen flicker this was built to avoid (see
    // mana-payment-overlay.ts's own "never re-animate on every click" comment).
    //
    // But `pendingDecision === null` alone is NOT proof of "still the same payment" — it is equally
    // true once payment has genuinely ended and it is simply not the human's turn yet (the whole
    // opponent turn), or their very next priority was auto-passed server-side and so never became a
    // decision at all. Bridging on nullness alone left the overlay stuck open until a manual Cancel.
    // `state.manaPaymentActive` (see its own doc comment, and `mana-payment-lifecycle.ts`) is the
    // backend's reliable answer to "has a real decision — of any type, either seat, seen by the
    // browser or not — actually happened since this payment step": only THAT closes the overlay.
    if (shouldBridgeManaOverlayNull(state, manaOverlay.isOpen(), TERMINAL_STATUSES)) {
      return;
    }
    manaOverlay.close();
    decisionDock.classList.remove('table-decision-dock--cards', 'table-decision-dock--opening-hand', 'physical-declaration');
    const prompt=state.pendingDecision?.rendered;
    if (prompt?.kind==='card_picker') {
      decisionDock.replaceChildren(); decisionDock.classList.remove('table-decision-dock--complex'); decisionDock.classList.add('table-decision-dock--cards');
      renderDecisionCards(decisionDock,prompt,state.observation,(name)=>decisionCardStore.get(name),(choice)=>void submitChoice(choice));
      return;
    }
    if (prompt?.kind==='opening_hand') {
      decisionDock.replaceChildren(); decisionDock.classList.remove('table-decision-dock--complex'); decisionDock.classList.add('table-decision-dock--cards', 'table-decision-dock--opening-hand');
      renderOpeningHandReview(decisionDock,prompt,state.observation,(name)=>cardStore.get(name),(choice)=>void submitChoice(choice));
      return;
    }

    // V2g "Physical Companion": the human declares which real card(s) correspond to a hidden-zone
    // event Forge just reported — completely unrelated to opening_hand's Keep/Mulligan decision
    // above (both can occur back-to-back: physical_declare -> opening_hand -> possibly
    // physical_declare again on a mulligan redraw -> opening_hand again, …).
    if (prompt?.kind === 'physical_declare') {
      decisionDock.replaceChildren(); decisionDock.classList.remove('table-decision-dock--complex'); decisionDock.classList.add('table-decision-dock--cards');
      renderPhysicalDeclare(decisionDock, prompt, (choice) => void submitChoice(choice), async (name) => { await decisionCardStore.ensure([name]); return decisionCardStore.get(name); });
      return;
    }

    if (state.pendingDecision) {
      renderDecision(decisionDock, filterDockDecision(state.pendingDecision, dockItems), (choice) => void submitChoice(choice));
      if (currentPlayMode === 'physical') {
        const inspectHint = document.createElement('p'); inspectHint.className = 'table-action-hint';
        inspectHint.textContent = 'Right-click a board card to inspect it.'; decisionDock.append(inspectHint);
      }
      // The hint only makes sense when something was ACTUALLY left off the dock in favor of a
      // clickable card — in Physical mode that's board/commander cards only (hand actions are back
      // in `dockItems`, see `buildDockItems`), so comparing against `dockItems.length` (rather than
      // the old bare `unmapped`) keeps the hint accurate in both Play Modes.
      if (dockItems && state.pendingDecision.rendered.kind === 'menu' && dockItems.length < state.pendingDecision.rendered.items.length) {
        const hint = document.createElement('p'); hint.className = 'table-action-hint'; hint.textContent = 'Choose a highlighted card, or an action below.';
        decisionDock.querySelector('.decision-title')?.after(hint);
      }
    } else {
      renderStatusLine(state.status);
    }
  }

  async function submitChoice(choice: Parameters<typeof submitPlaytestChoice>[1]): Promise<void> {
    if (currentPlayMode === 'physical' && !frameQueue.isIdle()) return;
    if (!sessionId || submitting) return;
    if (!decisionGate.consume(choice.decisionId)) return;
    submitting = true;
    handActionMenu.close();
    manaOverlay.close();
    inspectionActions = undefined;
    previewPanel.setActionable(null, null);
    if (latestState) revealLiveState(latestState);
    renderStatusLine("running");
    try {
      await submitPlaytestChoice(sessionId, choice);
    } catch (error) {
      decisionGate.retry(choice.decisionId);
      decisionDock.textContent = error instanceof Error ? error.message : "That choice was not accepted.";
    } finally {
      submitting = false;
      lastDecisionKey = ""; // Re-enable the same decision after a rejected/retried submission.
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

  document.addEventListener('decks-changed', () => { if (!sessionId) renderSetup(); });
  document.querySelector('#nav-play')?.addEventListener('click', () => { if (!sessionId) void resumeActivePlaytestIfAny(); });
  void resumeActivePlaytestIfAny();
}
