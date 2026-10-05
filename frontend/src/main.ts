import "./style.css";
import { initDeckLabView } from "./deck-lab/deck-lab-view.js";
import { element } from "./dom.js";
import { initPlaytestView } from "./playtest/playtest-view.js";
import { initVoiceMicTestView } from "./voice/voice-mic-test-view.js";
import { initDesktopControls } from "./desktop-controls.js";

import { restoreLibraryStorage } from './library-storage';

// A restore intent is acknowledged only after storage reaches disk. Until then no old
// builder is mounted, and a failed/quota-limited application can be retried safely.
async function finishRestoration() {
  const desktop = window.asphodelDesktop;
  if (!desktop) return;
  const storage = await desktop.getRestoredStorage();
  if (storage !== null) { restoreLibraryStorage(window.localStorage, storage); await desktop.acknowledgeRestore(); }
}
try { await finishRestoration(); }
catch (error) {
  document.body.replaceChildren();
  const panel = document.createElement('main'); panel.className = 'restore-startup-error';
  const title = document.createElement('h1'); title.textContent = 'Restauration à terminer';
  const message = document.createElement('p'); message.textContent = error instanceof Error ? error.message : 'Le stockage local est indisponible.';
  const info = document.createElement('p'); info.textContent = 'La sauvegarde et la copie de secours sont conservées. Réessaie ou ferme puis relance Asphodel.';
  const retry = document.createElement('button'); retry.textContent = 'Réessayer'; retry.onclick = () => window.location.reload();
  const quit = document.createElement('button'); quit.textContent = 'Quitter'; quit.onclick = () => { void window.asphodelDesktop?.quit(); };
  panel.append(title, message, info, retry, quit); document.body.append(panel);
  throw error; // never mount a builder over partially applied renderer storage
}

const backendStatus = element<HTMLSpanElement>("#backend-status");
const playView = element<HTMLElement>("#play-view");
const voiceTestView = element<HTMLElement>("#voice-test-view");
const navPlay = element<HTMLButtonElement>("#nav-play");
const navVoiceTest = element<HTMLButtonElement>("#nav-voice-test");

const labView = element<HTMLElement>("#deck-lab-view");
const navLab = element<HTMLButtonElement>("#nav-deck-lab");
const deckLab = initDeckLabView(labView);
window.asphodelDesktop?.onBeforeClose(() => deckLab.flush());

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
    backendStatus.textContent = response.ok ? "Prêt" : "Moteur indisponible";
    backendStatus.dataset.status = response.ok ? "online" : "offline";
  } catch {
    backendStatus.textContent = "Moteur indisponible";
    backendStatus.dataset.status = "offline";
  }
}

showLabGroup();
void checkBackend();


const appHeader = element<HTMLElement>('.app-header');
const appMenuToggle = element<HTMLButtonElement>('#app-menu-toggle');
function closeAppMenu() {
  appHeader.classList.remove('menu-open');
  appMenuToggle.setAttribute('aria-expanded', 'false');
}
appMenuToggle.addEventListener('click', () => {
  const open = appHeader.classList.toggle('menu-open');
  appMenuToggle.setAttribute('aria-expanded', String(open));
});
appHeader.addEventListener('click', event => {
  if ((event.target as HTMLElement).closest('#app-menu-content button')) closeAppMenu();
});
document.addEventListener('pointerdown', event => {
  if (!appHeader.contains(event.target as Node)) closeAppMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && appHeader.classList.contains('menu-open')) {
    closeAppMenu();
    appMenuToggle.focus();
  }
});

initDesktopControls(closeAppMenu, deckLab);
