/**
 * The V0 "compact voice status area" (spec "UI"): debugging clarity over visual polish. Shows the
 * raw heard transcript, the normalized one, the ranked candidates with their scores/reasons, which
 * resolution state fired (resolved/plan/confirm/ambiguous/unrecognized), any unknown term, and a
 * dictionary-learning proposal — with its own explicit approve/execute-only/cancel buttons, never a
 * silent auto-learn. Physical mode only — never mounted for Digital (see playtest-view.ts).
 *
 * The transcript field doubles as the spec's "correct the interpretation" path: it is always a
 * plain editable text input (pre-filled with whatever the mic last heard), so retyping it and
 * pressing "Interpret" re-runs resolution on the corrected text — no separate UI needed for that.
 * It is also how this panel stays usable without a working microphone during early playtests.
 */
import type { DictionaryProposal, VoiceCandidate, VoiceResolutionResult } from "./voice-types.js";
import type { VoiceRunner } from "./voice-runner.js";
import { createSpeechRecognizer, isSpeechRecognitionSupported, type SpeechRecognizerHandle } from "./speech-recognizer.js";

export interface VoicePanelHandle {
  element: HTMLElement;
  /** Call once per freshly-revealed authoritative decision (the same moment a live decision becomes visible to the human) — advances a running compound plan by one step and refreshes the plan status line. */
  refresh(): void;
  /** Stops any in-progress listening — call when leaving the game screen. */
  stop(): void;
}

function candidateRow(candidate: VoiceCandidate, onPick?: () => void): HTMLElement {
  const row = document.createElement(onPick ? "button" : "div");
  row.className = "voice-panel-candidate";
  if (onPick && row instanceof HTMLButtonElement) {
    row.type = "button";
    row.addEventListener("click", onPick);
  }
  const head = document.createElement("div");
  head.className = "voice-panel-candidate-head";
  const label = document.createElement("span");
  label.textContent = candidate.label;
  const score = document.createElement("span");
  score.className = "voice-panel-candidate-score";
  score.textContent = candidate.score.toFixed(2);
  head.append(label, score);
  const reasons = document.createElement("small");
  reasons.className = "voice-panel-candidate-reasons";
  reasons.textContent = candidate.reasons.join(" · ");
  row.append(head, reasons);
  return row;
}

export function createVoicePanel(runner: VoiceRunner): VoicePanelHandle {
  const root = document.createElement("div");
  root.className = "voice-panel";

  const heading = document.createElement("p");
  heading.className = "voice-panel-heading";
  heading.textContent = "Voice (V0)";

  const micButton = document.createElement("button");
  micButton.type = "button";
  micButton.className = "voice-panel-mic";

  const transcriptInput = document.createElement("input");
  transcriptInput.type = "text";
  transcriptInput.className = "voice-panel-input";
  transcriptInput.placeholder = "Or type what you'd say…";

  const interpretButton = document.createElement("button");
  interpretButton.type = "button";
  interpretButton.className = "voice-panel-interpret";
  interpretButton.textContent = "Interpret";

  const inputRow = document.createElement("div");
  inputRow.className = "voice-panel-input-row";
  inputRow.append(transcriptInput, interpretButton);

  const rawLine = document.createElement("p");
  rawLine.className = "voice-panel-raw";
  const normalizedLine = document.createElement("p");
  normalizedLine.className = "voice-panel-normalized";
  const planLine = document.createElement("p");
  planLine.className = "voice-panel-plan";
  planLine.hidden = true;
  const resultBox = document.createElement("div");
  resultBox.className = "voice-panel-result";
  const proposalBox = document.createElement("div");
  proposalBox.className = "voice-panel-proposal";
  proposalBox.hidden = true;

  let recognizer: SpeechRecognizerHandle | null = null;
  let listening = false;

  function setListening(value: boolean): void {
    listening = value;
    micButton.textContent = listening ? "🛑 Stop listening" : "🎙 Start listening";
    micButton.classList.toggle("voice-panel-mic--active", listening);
  }

  function updatePlanLine(): void {
    const status = runner.planStatus;
    if (status.remaining.length === 0 && !status.abortReason) {
      planLine.hidden = true;
      return;
    }
    planLine.hidden = false;
    planLine.textContent = status.abortReason ? `Plan stopped: ${status.abortReason}` : `Plan in progress — next: ${status.remaining[0]}`;
  }

  function renderProposal(proposal: DictionaryProposal | null, reExecute: () => void): void {
    proposalBox.replaceChildren();
    proposalBox.hidden = !proposal;
    if (!proposal) return;
    const text = document.createElement("p");
    text.textContent = `Unknown word "${proposal.term}" — looks like it means "${proposal.intent}" here (${proposal.context}).`;
    const remember = document.createElement("button");
    remember.type = "button";
    remember.textContent = "Execute & remember (this situation only)";
    remember.addEventListener("click", () => {
      runner.approveDictionaryEntry(proposal, "context");
      reExecute();
      proposalBox.hidden = true;
    });
    const executeOnly = document.createElement("button");
    executeOnly.type = "button";
    executeOnly.textContent = "Execute without learning";
    executeOnly.addEventListener("click", () => {
      reExecute();
      proposalBox.hidden = true;
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { proposalBox.hidden = true; });
    proposalBox.append(text, remember, executeOnly, cancel);
  }

  function renderResult(result: VoiceResolutionResult | null): void {
    resultBox.replaceChildren();
    proposalBox.hidden = true;
    if (!result) {
      normalizedLine.textContent = "(no pending decision to interpret against right now)";
      return;
    }
    normalizedLine.textContent = `Normalized: "${result.transcript.normalized}"`;
    const resolution = result.resolution;
    const status = document.createElement("p");
    status.className = "voice-panel-status";

    if (resolution.kind === "resolved") {
      status.textContent = `✓ Executed: ${result.candidates[0]?.label ?? "?"} (confidence ${resolution.confidence.toFixed(2)})`;
      resultBox.append(status);
    } else if (resolution.kind === "plan") {
      status.textContent = `✓ Executing plan (${resolution.steps.length} steps): ${resolution.steps.map((s) => s.label).join(" → ")}`;
      resultBox.append(status);
    } else if (resolution.kind === "confirm") {
      status.textContent = `Did you mean this? (confidence ${resolution.confidence.toFixed(2)})`;
      resultBox.append(status, candidateRow(resolution.candidate));
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.textContent = "Confirm";
      confirm.addEventListener("click", () => { runner.execute(resolution); updatePlanLine(); status.textContent = "✓ Executed."; });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => resultBox.replaceChildren());
      resultBox.append(confirm, cancel);
    } else if (resolution.kind === "ambiguous") {
      status.textContent = "Ambiguous — pick the one you meant:";
      resultBox.append(status);
      for (const candidate of resolution.candidates) {
        resultBox.append(candidateRow(candidate, () => {
          runner.execute({ kind: "resolved", choice: candidate.choice, confidence: candidate.score });
          updatePlanLine();
          status.textContent = "✓ Executed.";
        }));
      }
    } else {
      status.textContent = "Unrecognized — nothing executed.";
      resultBox.append(status);
    }

    if (result.unknownTerms.length > 0) {
      const unknown = document.createElement("p");
      unknown.className = "voice-panel-unknown";
      unknown.textContent = `Unknown word(s): ${result.unknownTerms.join(", ")}`;
      resultBox.append(unknown);
    }

    renderProposal(result.dictionaryProposal, () => {
      if (resolution.kind === "resolved" || resolution.kind === "confirm") runner.execute(resolution);
    });
  }

  function handleTranscript(transcript: string): void {
    rawLine.textContent = `Heard: "${transcript}"`;
    transcriptInput.value = transcript;
    const result = runner.interpret(transcript);
    renderResult(result);
    if (result && (result.resolution.kind === "resolved" || result.resolution.kind === "plan")) {
      runner.execute(result.resolution);
      updatePlanLine();
    }
  }

  interpretButton.addEventListener("click", () => { if (transcriptInput.value.trim()) handleTranscript(transcriptInput.value.trim()); });
  transcriptInput.addEventListener("keydown", (event) => { if (event.key === "Enter") interpretButton.click(); });

  setListening(false);
  micButton.addEventListener("click", () => {
    if (listening) { recognizer?.stop(); setListening(false); return; }
    if (!isSpeechRecognitionSupported()) { rawLine.textContent = "Speech recognition is not supported in this browser — type a transcript instead."; return; }
    recognizer = createSpeechRecognizer({
      onResult: handleTranscript,
      onError: (err) => { rawLine.textContent = `Mic error: ${err}`; },
      onEnd: () => setListening(false),
    });
    if (!recognizer) { rawLine.textContent = "Speech recognition is not supported in this browser — type a transcript instead."; return; }
    recognizer.start();
    setListening(true);
  });

  root.append(heading, micButton, inputRow, rawLine, normalizedLine, planLine, resultBox, proposalBox);
  return {
    element: root,
    refresh: () => { runner.advancePlan(); updatePlanLine(); },
    stop: () => { recognizer?.stop(); setListening(false); },
  };
}
