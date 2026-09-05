import "./style.css";
import { element } from "./dom.js";
import { initDeckLibraryView } from "./decks/deck-library-view.js";
import { initPlaytestView } from "./playtest/playtest-view.js";

const backendStatus = element<HTMLSpanElement>("#backend-status");
const decksGroup = element<HTMLElement>("#decks-group");
const playView = element<HTMLElement>("#play-view");
const navDecks = element<HTMLButtonElement>("#nav-decks");
const navPlay = element<HTMLButtonElement>("#nav-play");

async function checkBackend(): Promise<void> {
  try {
    const response = await fetch("/health");
    backendStatus.textContent = response.ok ? "Online" : "Offline";
    backendStatus.dataset.status = response.ok ? "online" : "offline";
  } catch {
    backendStatus.textContent = "Offline";
    backendStatus.dataset.status = "offline";
  }
}

function showDecksGroup(): void {
  decksGroup.hidden = false;
  playView.hidden = true;
  navDecks.setAttribute("aria-pressed", "true");
  navPlay.setAttribute("aria-pressed", "false");
}

function showPlayGroup(): void {
  decksGroup.hidden = true;
  playView.hidden = false;
  navDecks.setAttribute("aria-pressed", "false");
  navPlay.setAttribute("aria-pressed", "true");
}

navDecks.addEventListener("click", showDecksGroup);
navPlay.addEventListener("click", showPlayGroup);

const deckLibrary = initDeckLibraryView();
initPlaytestView();

element<HTMLButtonElement>("#home-button").addEventListener("click", () => {
  showDecksGroup();
  deckLibrary.showLibrary();
});

void checkBackend();
