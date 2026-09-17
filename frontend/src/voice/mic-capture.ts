/**
 * Fallback voice capture for browsers with no native `SpeechRecognition` (Firefox,
 * mainly — see speech-recognizer.ts). Records one push-to-talk take with
 * `getUserMedia`/`MediaRecorder` — supported everywhere, unlike the Web Speech API —
 * uploads it to the backend's `/voice/transcribe` route (whisper.cpp, see
 * backend/src/voice/whisper-transcription-service.ts), and forwards the transcript
 * through the same `SpeechRecognizerCallbacks` contract as speech-recognizer.ts, so
 * callers can't tell which one is actually running (see voice-capture.ts).
 *
 * `options.vocabulary` (built by voice-context-vocabulary.ts from whatever the caller already
 * knows about the current game state) rides along as a "vocabulary" form field, JSON-encoded —
 * purely a hint the backend turns into a whisper.cpp `--prompt`; this never changes what a result
 * MEANS, only how likely whisper.cpp is to spell a card name right in the first place. Omitted
 * entirely when there's nothing to send, so an empty context costs nothing extra on the wire.
 *
 * Behavioral difference from the native recognizer: this is one-shot, not continuous.
 * `onResult` fires once, after `stop()`, once the upload+transcription round trip
 * completes — not live as the user talks.
 *
 * `getUserMedia` still needs mic permission from the browser, exactly like
 * `SpeechRecognition` does — this only routes around Firefox lacking the Web Speech
 * API, not a browser/OS-level microphone block (see chrome://settings/content/microphone).
 *
 * Not unit-tested: `MediaRecorder`/`getUserMedia` don't exist in the Node test runner
 * this frontend uses (same reasoning as speech-recognizer.ts).
 */
import type { SpeechRecognizerCallbacks, SpeechRecognizerHandle } from "./speech-recognizer.js";

export function isMicCaptureSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];

function pickMimeType(): string | undefined {
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** `null` when getUserMedia/MediaRecorder aren't available at all — same degrade-honestly contract as createSpeechRecognizer. */
export function createMicCaptureRecognizer(callbacks: SpeechRecognizerCallbacks, options?: { vocabulary?: readonly string[] }): SpeechRecognizerHandle | null {
  if (!isMicCaptureSupported()) return null;

  let mediaStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  function teardownStream(): void {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  async function transcribe(blob: Blob): Promise<void> {
    try {
      const form = new FormData();
      // Sent before "audio": @fastify/multipart only guarantees a field is parsed by the time the
      // file's own bytes are read if it comes first in the multipart body (see backend's
      // voice-routes.ts) — this ordering is load-bearing, not cosmetic.
      if (options?.vocabulary && options.vocabulary.length > 0) form.append("vocabulary", JSON.stringify(options.vocabulary));
      form.append("audio", blob, "take.webm");
      const response = await fetch("/voice/transcribe", { method: "POST", body: form });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `HTTP ${response.status}`);
      }
      const { transcript } = (await response.json()) as { transcript: string };
      if (transcript) callbacks.onResult(transcript);
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error.message : "transcription_failed");
    } finally {
      callbacks.onEnd?.();
    }
  }

  return {
    start: () => {
      chunks = [];
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          mediaStream = stream;
          recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data);
          };
          recorder.onstop = () => {
            teardownStream();
            const finishedRecorder = recorder;
            const blob = new Blob(chunks, { type: finishedRecorder?.mimeType || "audio/webm" });
            chunks = [];
            void transcribe(blob);
          };
          recorder.start();
        })
        .catch((error) => {
          callbacks.onError?.(error instanceof Error ? error.message : "mic_permission_denied");
          callbacks.onEnd?.();
        });
    },
    stop: () => {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      } else {
        teardownStream();
      }
    },
  };
}
