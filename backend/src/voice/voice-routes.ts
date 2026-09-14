import type { FastifyInstance } from "fastify";
import { AudioTooLargeError, MissingAudioError } from "../app-errors.js";
import type { VoiceTranscriptionService } from "./voice-transcription-service.js";

/** A few seconds of opus audio is a few tens of KB — generous headroom for a push-to-talk take, not a cap anyone should ever hit in normal use. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const EXTENSION_BY_MIME_FRAGMENT: Array<[string, string]> = [
  ["webm", "webm"],
  ["ogg", "ogg"],
  ["wav", "wav"],
  ["mp4", "mp4"],
];

function extensionFromMimeType(mimetype: string): string {
  return EXTENSION_BY_MIME_FRAGMENT.find(([fragment]) => mimetype.includes(fragment))?.[1] ?? "webm";
}

export function registerVoiceRoutes(app: FastifyInstance, voiceTranscriptionService: VoiceTranscriptionService): void {
  app.post("/voice/transcribe", async (request) => {
    const file = await request.file({ limits: { fileSize: MAX_AUDIO_BYTES } });
    if (!file) throw new MissingAudioError();

    const buffer = await file.toBuffer();
    if (file.file.truncated) throw new AudioTooLargeError();

    const transcript = await voiceTranscriptionService.transcribe(buffer, extensionFromMimeType(file.mimetype));
    return { transcript };
  });
}
