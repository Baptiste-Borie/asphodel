import type { FastifyInstance } from "fastify";
import { AudioTooLargeError, MissingAudioError } from "../app-errors.js";
import type { VoiceTranscriptionService } from "./voice-transcription-service.js";
import { MAX_PROMPT_CARD_NAMES } from "./whisper-prompt.js";

/** A few seconds of opus audio is a few tens of KB — generous headroom for a push-to-talk take, not a cap anyone should ever hit in normal use. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Defensive re-cap on top of `buildWhisperPrompt`'s own — this is client-supplied, so never trust
 * its shape/size even though the current frontend already caps it before sending (see
 * voice-context-vocabulary.ts). A generous card-name length (real Magic names run long, e.g.
 * "Kediss, Emberclaw Familiar") without allowing an arbitrarily huge string into the prompt. */
const MAX_VOCABULARY_TERM_CHARS = 80;

/** `null` for anything not shaped like a small array of strings — malformed input never becomes a
 * prompt, it just silently falls back to "no contextual hint" (same as no vocabulary at all). */
function parseVocabularyField(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const terms = parsed
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, MAX_VOCABULARY_TERM_CHARS))
    .slice(0, MAX_PROMPT_CARD_NAMES);
  return terms.length > 0 ? terms : undefined;
}

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

    // Only present if the client sent a "vocabulary" field ALONGSIDE the file (either order —
    // `toBuffer()` above already drained the whole multipart body, so a field declared after the
    // file part is populated here too). A field of any other shape is simply ignored — see
    // `parseVocabularyField`.
    const vocabularyField = file.fields.vocabulary;
    const rawVocabulary = !Array.isArray(vocabularyField) && vocabularyField?.type === "field" ? vocabularyField.value : undefined;
    const vocabulary = parseVocabularyField(rawVocabulary);

    const transcript = await voiceTranscriptionService.transcribe(buffer, extensionFromMimeType(file.mimetype), vocabulary ? { vocabulary } : undefined);
    return { transcript };
  });
}
