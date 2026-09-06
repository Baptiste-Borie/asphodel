import "../styles/playtest.css";
import "../styles/tabletop.css";
import "../styles/table-scene.css";
import { createZoneInspector, renderPublicZones, renderHiddenHand, renderStack } from "./table-scene.js";
import { VisualTransitions } from "./visual-transitions.js";
import { apiRequest } from "../api/api-client.js";
import { endPlaytest, getActivePlaytest, getPlaytestReport, getPlaytestState, startPlaytest, submitPlaytestChoice } from "../api/playtest-api.js";
import { element } from "../dom.js";
import { collectVisibleCardNames, commandZoneCards, formatHudPhase, opponentPlayer, renderBattlefieldHalf, renderCommanderDock, renderHand, renderLandZone, selfPlayer, type BoardCallbacks, type HandActionCallbacks } from "./board-renderer.js";
import { createCardPreviewPanel } from "./card-preview.js";
import { CardPresentationStore } from "./card-presentation-store.js";
import { combatSelectedCardRefs } from "./combat-selection.js";
import { renderDecision } from "./decision-renderer.js";
import { FramePlaybackQueue } from "./frame-playback.js";
import { createHandActionMenu } from "./hand-action-menu.js";
import { decideCardAction, mapActionsToCards, splitCardActionMapByHand, type CardActionMap } from "./hand-action-mapping.js";
import { groupManaPaymentOptions, type ManaPaymentGroups } from "./mana-payment-mapping.js";
import { createManaPaymentOverlay } from "./mana-payment-overlay.js";
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
  const handActionMenu = createHandActionMenu();
  const manaOverlay = createManaPaymentOverlay();
  const zoneInspector = createZoneInspector((name) => cardStore.get(name));
  const transitions = new VisualTransitions();
  let opponentHand: HTMLElement, stackEl: HTMLElement;
  let opponentPiles: HTMLElement, humanPiles: HTMLElement;

  // Public turn-of-Asphodel frames (V2e.3) are queued and replayed in order with a short delay —
  // the human decision is only ever revealed once this queue is genuinely idle (see revealLiveState).
  const frameQueue = new FramePlaybackQueue();
  let playedEvents: PublicGameEvent[] = [];
  let latestState: WebPlaytestStateDTO | null = null;

  // Persistent game-screen elements, built once per game — never torn down by a poll, so the
  // pinned preview, menu state and any hover survive polling. Each section only re-renders when
  // its own underlying data actually changed (or, for frame playback, once per played frame).
  let asphodelLifeEl: HTMLElement, humanLifeEl: HTMLElement, actionsEl: HTMLElement;
  let asphodelHalfEl: HTMLElement, humanHalfEl: HTMLElement;
  let asphodelCommanderDock: HTMLElement, humanCommanderDock: HTMLElement;
  let asphodelBattlefieldCards: HTMLElement, humanBattlefieldCards: HTMLElement, handContainer: HTMLElement;
  let asphodelLandZone: HTMLElement, humanLandZone: HTMLElement;
  let hudTurnEl: HTMLElement, hudPhaseEl: HTMLElement;
  let decisionDock: HTMLElement, menuPanel: HTMLElement, menuDeckInfo: HTMLElement;
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
    lastObservation = null;
    lastObservationKey = "";
    lastDecisionKey = "";
    playedEvents = [];
    latestState = null;
    transitions.reset();
    zoneInspector.close();
    document.body.classList.remove("tabletop-active");
    previewPanel.close();
    handActionMenu.close();
    manaOverlay.close();
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
    transitions.reset();
    zoneInspector.close();
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
    transitions.reset();
    zoneInspector.close();
    gameSection.replaceChildren();
    gameSection.className = "table-root";

    const battlefield = document.createElement("div");
    battlefield.className = "table-battlefield";

    asphodelHalfEl = document.createElement("div");
    asphodelHalfEl.className = "table-battlefield-half table-battlefield-half--asphodel";
    asphodelCommanderDock = document.createElement("div");
    asphodelCommanderDock.className = "table-commander-dock";
    asphodelBattlefieldCards = document.createElement("div");
    asphodelBattlefieldCards.className = "table-battlefield-cards";
    asphodelLandZone = document.createElement("div");
    asphodelLandZone.className = "table-land-zone";
    asphodelHalfEl.append(asphodelCommanderDock, asphodelBattlefieldCards, asphodelLandZone);

    humanHalfEl = document.createElement("div");
    humanHalfEl.className = "table-battlefield-half table-battlefield-half--human";
    humanCommanderDock = document.createElement("div");
    humanCommanderDock.className = "table-commander-dock";
    humanBattlefieldCards = document.createElement("div");
    humanBattlefieldCards.className = "table-battlefield-cards";
    humanLandZone = document.createElement("div");
    humanLandZone.className = "table-land-zone";
    humanHalfEl.append(humanCommanderDock, humanBattlefieldCards, humanLandZone);

    battlefield.append(asphodelHalfEl, humanHalfEl);

    const hud = document.createElement("div");
    hud.className = "table-hud";
    hudTurnEl = document.createElement("p");
    hudTurnEl.className = "table-hud-line table-hud-turn";
    hudPhaseEl = document.createElement("p");
    hudPhaseEl.className = "table-hud-line table-hud-phase";
    hud.append(hudTurnEl, hudPhaseEl);

    const rail = document.createElement("div");
    rail.className = "table-rail-left";
    asphodelLifeEl = document.createElement("div");
    asphodelLifeEl.className = "table-life table-life--asphodel";
    actionsEl = document.createElement("div");
    actionsEl.className = "table-actions";
    humanLifeEl = document.createElement("div");
    humanLifeEl.className = "table-life table-life--human";
    asphodelHalfEl.prepend(asphodelLifeEl);
    humanHalfEl.prepend(humanLifeEl);
    const history = document.createElement('details'); history.className = 'table-history';
    const historyTitle = document.createElement('summary'); historyTitle.textContent = 'Recent actions';
    history.append(historyTitle, actionsEl); rail.append(history);
    opponentPiles = document.createElement('div'); opponentPiles.className = 'table-public-zones';
    humanPiles = document.createElement('div'); humanPiles.className = 'table-public-zones';
    asphodelHalfEl.append(opponentPiles); humanHalfEl.append(humanPiles);
    opponentHand = document.createElement('div'); opponentHand.className = 'table-opponent-hand';
    stackEl = document.createElement('div'); stackEl.className = 'table-stack'; stackEl.hidden = true;
    stackEl.setAttribute('aria-label', 'Spell stack');
    const wordmark = document.createElement('div'); wordmark.className = 'table-wordmark'; wordmark.textContent = 'ASPHODEL';
    battlefield.append(opponentHand, stackEl, wordmark);
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

    gameSection.append(battlefield, rail, hud, menuButton, menuPanel, previewPanel.element, decisionDock, handContainer, handActionMenu.element, manaOverlay.element, zoneInspector.element);
  }

  function setDeckInfo(humanDeckName: string, asphodelDeckName: string): void {
    menuDeckInfo.textContent = `${humanDeckName} vs ${asphodelDeckName}`;
  }

  const boardCallbacks: BoardCallbacks = {
    getPresentation: (name) => cardStore.get(name),
    onCardActivate: (card: AgentCardObservation) => previewPanel.togglePin(card, card.name ? cardStore.get(card.name) : null),
    isSelected: (card: AgentCardObservation) => previewPanel.isSelected(card.cardRef),
  };

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

  /** Small, elegant turn/phase HUD (V2e.6) — uses the actual current Forge turn/phase, never a guess; friendly combat-phase labels via `formatHudPhase`. */
  function renderHud(observation: AgentObservation): void {
    const activeLabel = observation.game.activePlayerId === observation.selfPlayerId ? "You" : "Asphodel";
    updateHudLine(hudTurnEl, `Turn ${observation.game.turn} · ${activeLabel}`);
    updateHudLine(hudPhaseEl, formatHudPhase(observation.game.phase));
  }

  /**
   * Unconditionally paints the table from one observation — used both by the live (idle) path and
   * by every played frame. `handActions`/`boardActionMap` are supplied only by the live path, and
   * only while an actual menu decision is genuinely showing (see `computeActiveMapping`) — a
   * played frame never passes either, so no card is ever clickable-for-a-decision mid-Asphodel-
   * turn-playback. `combatSelectedRefs` (V2e.6) is Forge's own declared attackers/blockers for the
   * current decision, if any — entirely independent of tapped state.
   */
  function paintBoard(observation: AgentObservation, handActions?: HandActionCallbacks, boardActionMap?: CardActionMap, combatSelectedRefs?: ReadonlySet<string>): void {
    const boardHasActions = Boolean(boardActionMap && boardActionMap.byCardRef.size > 0);
    const expand = boardHasActions;
    const isCombatSelected = (card: AgentCardObservation) => combatSelectedRefs?.has(card.cardRef) ?? false;
    const boardCallbacksForThisRender: BoardCallbacks = boardHasActions ? {
      getPresentation: (name) => cardStore.get(name),
      isSelected: () => false,
      isPlayable: (card) => boardActionMap!.byCardRef.has(card.cardRef),
      isCombatSelected,
      onCardActivate: (card, cardElement) => {
        const items = boardActionMap!.byCardRef.get(card.cardRef);
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
    } : { ...boardCallbacks, isCombatSelected };

    transitions.paint(gameSection, observation, () => {
    zoneInspector.close();
    renderHud(observation);
    renderStack(stackEl, observation);

    const opponent = opponentPlayer(observation);
    const self = selfPlayer(observation);
    asphodelHalfEl.classList.toggle("table-battlefield-half--active", opponent?.playerId === observation.game.activePlayerId);
    humanHalfEl.classList.toggle("table-battlefield-half--active", self?.playerId === observation.game.activePlayerId);
    if (opponent) {
      asphodelHalfEl.dataset.playerId = opponent.playerId;
      renderPublicZones(opponentPiles, opponent, (name) => cardStore.get(name), zoneInspector.open);
      renderHiddenHand(opponentHand, opponent.handSize);
      renderLifeWithDelta(asphodelLifeEl, "ASPHODEL", opponent.life);
      renderCommanderDock(asphodelCommanderDock, opponent, boardCallbacksForThisRender, expand);
      renderBattlefieldHalf(asphodelBattlefieldCards, opponent, boardCallbacksForThisRender, expand);
      renderLandZone(asphodelLandZone, opponent, boardCallbacksForThisRender, expand);
    }
    if (self) {
      humanHalfEl.dataset.playerId = self.playerId;
      renderPublicZones(humanPiles, self, (name) => cardStore.get(name), zoneInspector.open);
      renderLifeWithDelta(humanLifeEl, "YOU", self.life);
      renderCommanderDock(humanCommanderDock, self, boardCallbacksForThisRender, expand);
      renderBattlefieldHalf(humanBattlefieldCards, self, boardCallbacksForThisRender, expand);
      renderLandZone(humanLandZone, self, boardCallbacksForThisRender, expand);
      if (self.role === "self") renderHand(handContainer, self.hand, (name) => cardStore.get(name), handActions);
    }
    });
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

  /** The action dock only ever shows what a card cannot already represent — "Pass priority"/"Finish" and any legal action with no matching visible card (hand or board). Title/context are untouched; only the menu's own item list is filtered. */
  function filterDockDecision(pending: WebPendingDecisionDTO, unmapped: MenuItem[] | null): WebPendingDecisionDTO {
    if (!unmapped || pending.rendered.kind !== "menu") return pending;
    return { ...pending, rendered: { ...pending.rendered, items: unmapped } };
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
    const active = computeActiveMapping(state);
    if (state.observation) {
      lastObservation = state.observation;
      renderTableIfChanged(state.observation, state.pendingDecision, active);
    }
    renderDecisionIfChanged(state, active?.unmapped ?? null);
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
    decisionDock.classList.remove("table-decision-dock--complex");
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
    );
  }

  function renderDecisionIfChanged(state: WebPlaytestStateDTO, unmapped: MenuItem[] | null): void {
    const key = JSON.stringify(state.pendingDecision) + (submitting ? ":submitting" : "");
    if (key === lastDecisionKey) return;
    lastDecisionKey = key;
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
    manaOverlay.close();

    if (state.pendingDecision) {
      renderDecision(decisionDock, filterDockDecision(state.pendingDecision, unmapped), (choice) => void submitChoice(choice));
      if (unmapped && state.pendingDecision.rendered.kind === 'menu' && unmapped.length < state.pendingDecision.rendered.items.length) {
        const hint = document.createElement('p'); hint.className = 'table-action-hint'; hint.textContent = 'Choose a highlighted card, or an action below.';
        decisionDock.querySelector('.decision-title')?.after(hint);
      }
    } else {
      renderStatusLine(state.status);
    }
  }

  async function submitChoice(choice: Parameters<typeof submitPlaytestChoice>[1]): Promise<void> {
    if (!sessionId || submitting) return;
    submitting = true;
    renderStatusLine("running");
    try {
      await submitPlaytestChoice(sessionId, choice);
    } catch (error) {
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

  void resumeActivePlaytestIfAny();
}
