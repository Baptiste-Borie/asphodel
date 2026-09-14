/**
 * Standalone "Voice Mic Test" tab — verifies the microphone/Web Speech API pipeline works at all,
 * completely independent of a running Forge playtest (no pending decision needed). This is
 * deliberately separate from `voice-panel.ts` (the in-game debug widget, which needs a live Forge
 * decision to resolve against): here there is nothing to resolve, only "does the browser actually
 * hear me and transcribe something". Also runs the heard transcript through
 * `transcript-normalizer.ts` so a filler-word/elision bug is visible without starting a game.
 */
import { createSpeechRecognizer, isSpeechRecognitionSupported, type SpeechRecognizerHandle } from "./speech-recognizer.js";
import { normalizeTranscript } from "./transcript-normalizer.js";
import "../styles/voice-mic-test.css";

interface HeardEntry {
  raw: string;
  normalized: string;
  at: Date;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour12: false });
}

export function initVoiceMicTestView(container: HTMLElement): void {
  container.replaceChildren();
  container.className = "voice-mic-test";

  const heading = document.createElement("h1");
  heading.textContent = "Voice Mic Test";
  const description = document.createElement("p");
  description.className = "page-description";
  description.textContent = "Vérifie que le micro et la reconnaissance vocale du navigateur fonctionnent, indépendamment d'une partie en cours.";

  const supportLine = document.createElement("p");
  supportLine.className = "voice-mic-test-support";

  const micButton = document.createElement("button");
  micButton.type = "button";
  micButton.className = "primary-button voice-mic-test-button";

  const statusLine = document.createElement("p");
  statusLine.className = "voice-mic-test-status";
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "secondary-button voice-mic-test-clear";
  clearButton.textContent = "Effacer l'historique";

  const list = document.createElement("ol");
  list.className = "voice-mic-test-log";

  let recognizer: SpeechRecognizerHandle | null = null;
  let listening = false;
  let heardCount = 0;

  function setSupportLine(): void {
    if (isSpeechRecognitionSupported()) {
      supportLine.textContent = "Reconnaissance vocale disponible dans ce navigateur.";
      supportLine.classList.remove("voice-mic-test-support--unsupported");
      micButton.disabled = false;
    } else {
      supportLine.textContent = "Reconnaissance vocale NON disponible dans ce navigateur (essayez Chrome/Edge desktop).";
      supportLine.classList.add("voice-mic-test-support--unsupported");
      micButton.disabled = true;
    }
  }

  function setListening(value: boolean): void {
    listening = value;
    micButton.textContent = listening ? "🛑 Arrêter l'écoute" : "🎙 Démarrer l'écoute";
    micButton.classList.toggle("voice-mic-test-button--active", listening);
    statusLine.textContent = listening ? "Écoute en cours… parlez." : heardCount > 0 ? `Arrêté — ${heardCount} transcript(s) capturé(s).` : "Arrêté.";
  }

  function addEntry(entry: HeardEntry): void {
    heardCount += 1;
    const item = document.createElement("li");
    item.className = "voice-mic-test-entry";
    const time = document.createElement("span");
    time.className = "voice-mic-test-entry-time";
    time.textContent = formatTime(entry.at);
    const raw = document.createElement("span");
    raw.className = "voice-mic-test-entry-raw";
    raw.textContent = `« ${entry.raw} »`;
    const normalized = document.createElement("span");
    normalized.className = "voice-mic-test-entry-normalized";
    normalized.textContent = `normalisé : "${entry.normalized}"`;
    item.append(time, raw, normalized);
    list.prepend(item);
  }

  micButton.addEventListener("click", () => {
    if (listening) {
      recognizer?.stop();
      setListening(false);
      return;
    }
    recognizer = createSpeechRecognizer({
      onResult: (transcript) => {
        const normalized = normalizeTranscript(transcript);
        addEntry({ raw: transcript, normalized: normalized.normalized, at: new Date() });
        statusLine.textContent = `Écoute en cours… dernier : « ${transcript} »`;
      },
      onError: (error) => {
        statusLine.textContent = `Erreur micro : ${error}`;
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
    if (!recognizer) {
      statusLine.textContent = "Reconnaissance vocale indisponible.";
      return;
    }
    recognizer.start();
    setListening(true);
  });

  clearButton.addEventListener("click", () => {
    list.replaceChildren();
    heardCount = 0;
    statusLine.textContent = listening ? "Écoute en cours… parlez." : "Arrêté.";
  });

  setSupportLine();
  setListening(false);

  const controls = document.createElement("div");
  controls.className = "voice-mic-test-controls";
  controls.append(micButton, clearButton);

  container.append(heading, description, supportLine, controls, statusLine, list);
}
