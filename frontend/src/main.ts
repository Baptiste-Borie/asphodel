import "./style.css";
import { initDeckLabView } from "./deck-lab/deck-lab-view.js";
import { element } from "./dom.js";
import { initPlaytestView } from "./playtest/playtest-view.js";
import { initVoiceMicTestView } from "./voice/voice-mic-test-view.js";

const backendStatus = element<HTMLSpanElement>("#backend-status");
const playView = element<HTMLElement>("#play-view");
const voiceTestView = element<HTMLElement>("#voice-test-view");
const navPlay = element<HTMLButtonElement>("#nav-play");
const navVoiceTest = element<HTMLButtonElement>("#nav-voice-test");

const labView = element<HTMLElement>("#deck-lab-view");
const navLab = element<HTMLButtonElement>("#nav-deck-lab");
const deckLab = initDeckLabView(labView);

// Deck Lab is the app's home view — it now owns deck browsing, importing and building, replacing
// the old separate Decks page. Play and the voice mic test remain their own nav entries.
function showLabGroup(): void {
  deckLab.activate();
  labView.hidden = false;
  playView.hidden = true;
  voiceTestView.hidden = true;
  navLab.setAttribute("aria-pressed", "true");
  navPlay.setAttribute("aria-pressed", "false");
  navVoiceTest.setAttribute("aria-pressed", "false");
}

function showPlayGroup(): void {
  labView.hidden = true;
  playView.hidden = false;
  voiceTestView.hidden = true;
  navLab.setAttribute("aria-pressed", "false");
  navPlay.setAttribute("aria-pressed", "true");
  navVoiceTest.setAttribute("aria-pressed", "false");
}

/** Standalone mic/Web Speech API check — no Forge session, no pending decision, see voice-mic-test-view.ts. */
function showVoiceTestGroup(): void {
  labView.hidden = true;
  playView.hidden = true;
  voiceTestView.hidden = false;
  navLab.setAttribute("aria-pressed", "false");
  navPlay.setAttribute("aria-pressed", "false");
  navVoiceTest.setAttribute("aria-pressed", "true");
}

navLab.addEventListener("click", showLabGroup);
navPlay.addEventListener("click", showPlayGroup);
navVoiceTest.addEventListener("click", showVoiceTestGroup);

initPlaytestView(showPlayGroup);
initVoiceMicTestView(voiceTestView);

element<HTMLButtonElement>("#home-button").addEventListener("click", showLabGroup);

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

showLabGroup();
void checkBackend();
