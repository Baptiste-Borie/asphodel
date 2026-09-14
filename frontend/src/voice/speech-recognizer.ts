/**
 * Thin wrapper over the browser's Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`).
 * Deliberately dumb: it only ever forwards a raw transcript string to the caller — it never
 * normalizes, interprets, or filters anything (that is `transcript-normalizer.ts`/`voice-resolver.ts`'s
 * job). Not unit-tested: there is no real `SpeechRecognition` in the Node test runner this frontend
 * uses (see decision-gate.test.ts and friends — none touch the DOM/browser APIs either), and a
 * mocked one would only test this file's own trivial plumbing, not anything about interpretation.
 * `isSpeechRecognitionSupported` lets the UI degrade honestly instead of silently doing nothing.
 */

export interface SpeechRecognizerCallbacks {
  /** One take, its `transcript` already final (interim results are not requested — V0 favors reliability over latency). */
  onResult: (transcript: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export interface SpeechRecognizerHandle {
  start(): void;
  stop(): void;
}

interface MinimalSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => MinimalSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/** `null` when the browser has no speech recognition at all — the caller decides how to degrade (see voice-panel.ts). French by default; the player can still mix in English Magic terms (the lexicon, not the recognizer locale, is what actually understands those). */
export function createSpeechRecognizer(callbacks: SpeechRecognizerCallbacks, options?: { lang?: string }): SpeechRecognizerHandle | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = options?.lang ?? "fr-FR";
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    const transcript = last?.[0]?.transcript ?? "";
    if (transcript) callbacks.onResult(transcript);
  };
  recognition.onerror = (event) => callbacks.onError?.(event.error ?? "unknown_error");
  recognition.onend = () => callbacks.onEnd?.();
  return {
    start: () => { try { recognition.start(); } catch { /* already started */ } },
    stop: () => { try { recognition.stop(); } catch { /* already stopped */ } },
  };
}
