export interface VoiceTranscriptionService {
  /** `extension` (no dot, e.g. "webm") drives the temp filename so ffmpeg picks the right demuxer. Resolves to a plain-text transcript, throws `VoiceTranscriptionError` on failure. */
  transcribe(audio: Buffer, extension: string): Promise<string>;
}
