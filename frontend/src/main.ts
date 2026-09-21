import "./style.css";
import { initDeckLabView } from "./deck-lab/deck-lab-view.js";
import { element } from "./dom.js";
import { initDeckLibraryView } from "./decks/deck-library-view.js";
import { initPlaytestView } from "./playtest/playtest-view.js";
import { initVoiceMicTestView } from "./voice/voice-mic-test-view.js";

const backendStatus = element<HTMLSpanElement>("#backend-status");
const decksGroup = element<HTMLElement>("#decks-group");
const playView = element<HTMLElement>("#play-view");
const voiceTestView = element<HTMLElement>("#voice-test-view");
const navDecks = element<HTMLButtonElement>("#nav-decks");
const navPlay = element<HTMLButtonElement>("#nav-play");
const navVoiceTest = element<HTMLButtonElement>("#nav-voice-test");

const labView = element<HTMLElement>("#deck-lab-view");
const navLab = element<HTMLButtonElement>("#nav-deck-lab");
const deckLab = initDeckLabView(labView);
function hideLab() { labView.hidden = true; navLab.setAttribute("aria-pressed", "false"); }
navLab.addEventListener("click", () => {
  deckLab.activate();
  [decksGroup, playView, voiceTestView].forEach(el => el.hidden = true);
  [navDecks, navPlay, navVoiceTest].forEach(el => el.setAttribute("aria-pressed", "false"));
  labView.hidden = false; navLab.setAttribute("aria-pressed", "true");
});
if (location.hash === "#deck-lab") navLab.click();

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
  hideLab();
  decksGroup.hidden = false;
  playView.hidden = true;
  voiceTestView.hidden = true;
  navDecks.setAttribute("aria-pressed", "true");
  navPlay.setAttribute("aria-pressed", "false");
  navVoiceTest.setAttribute("aria-pressed", "false");
}

function showPlayGroup(): void {
  hideLab();
  decksGroup.hidden = true;
  playView.hidden = false;
  voiceTestView.hidden = true;
  navDecks.setAttribute("aria-pressed", "false");
  navPlay.setAttribute("aria-pressed", "true");
  navVoiceTest.setAttribute("aria-pressed", "false");
}

/** Standalone mic/Web Speech API check — no Forge session, no pending decision, see voice-mic-test-view.ts. */
function showVoiceTestGroup(): void {
  hideLab();
  decksGroup.hidden = true;
  playView.hidden = true;
  voiceTestView.hidden = false;
  navDecks.setAttribute("aria-pressed", "false");
  navPlay.setAttribute("aria-pressed", "false");
  navVoiceTest.setAttribute("aria-pressed", "true");
}

navDecks.addEventListener("click", showDecksGroup);
navPlay.addEventListener("click", showPlayGroup);
navVoiceTest.addEventListener("click", showVoiceTestGroup);

const deckLibrary = initDeckLibraryView();
initPlaytestView(showPlayGroup);
initVoiceMicTestView(voiceTestView);

element<HTMLButtonElement>("#home-button").addEventListener("click", () => {
  showDecksGroup();
  deckLibrary.showLibrary();
});

void checkBackend();
