/**
 * Optional hint the caller (the frontend, which already legitimately knows the current game state)
 * can attach to a transcription — never required, never a source of truth. `vocabulary` is a small
 * list of card names plausible in the current context (current legal choices, hand, battlefield, …
 * — see frontend/src/voice/voice-context-vocabulary.ts), used only to bias STT toward emitting the
 * right spelling. Nothing downstream trusts this list as legal; the Voice Intent Resolver still
 * ranks only Forge's own currently-legal choices.
 */
export interface TranscriptionContext {
  vocabulary?: readonly string[];
}

export interface VoiceTranscriptionService {
  /** `extension` (no dot, e.g. "webm") drives the temp filename so ffmpeg picks the right demuxer. Resolves to a plain-text transcript, throws `VoiceTranscriptionError` on failure. */
  transcribe(audio: Buffer, extension: string, context?: TranscriptionContext): Promise<string>;
}
