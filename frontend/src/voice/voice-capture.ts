/**
 * Picks the best available voice capture path: native Web Speech API when present
 * (Chrome/Edge), otherwise the MediaRecorder + backend whisper.cpp fallback
 * (mic-capture.ts) — needed on Firefox, which never implemented SpeechRecognition.
 * Same SpeechRecognizerHandle contract either way, so callers (voice-panel.ts,
 * voice-mic-test-view.ts) don't need to know or care which one is actually running.
 */
import { createSpeechRecognizer, isSpeechRecognitionSupported, type SpeechRecognizerCallbacks, type SpeechRecognizerHandle } from "./speech-recognizer.js";
import { createMicCaptureRecognizer, isMicCaptureSupported } from "./mic-capture.js";

export function isVoiceCaptureSupported(): boolean {
  return isSpeechRecognitionSupported() || isMicCaptureSupported();
}

export function createVoiceRecognizer(callbacks: SpeechRecognizerCallbacks, options?: { lang?: string; vocabulary?: readonly string[] }): SpeechRecognizerHandle | null {
  // `vocabulary` only ever reaches the whisper.cpp fallback: the native Web Speech API path has no
  // equivalent hook in this codebase (and grammar-constrained speech is explicitly out of scope for
  // now — see docs/voice-intent-resolver-v0.md), so it's simply unused there, never an error.
  if (isSpeechRecognitionSupported()) return createSpeechRecognizer(callbacks, options);
  return createMicCaptureRecognizer(callbacks, options);
}
