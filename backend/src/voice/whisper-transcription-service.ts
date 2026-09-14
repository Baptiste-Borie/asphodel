/**
 * Fallback STT for browsers without native SpeechRecognition (Firefox, mainly — see
 * frontend/src/voice/mic-capture.ts). Runs whisper.cpp locally via `nodejs-whisper`:
 * 100% free/offline, no API key, no per-call cost. First call for a given model is slow
 * (whisper.cpp self-builds via cmake, then the model downloads to WHISPER_MODEL_PATH) —
 * expect the first request after a fresh `npm install` to take a couple of minutes.
 *
 * Model defaults to "base": multilingual (unlike the ".en" variants) and fast enough on
 * CPU for a short push-to-talk take. Bump WHISPER_MODEL to "small" if accuracy on French
 * Magic terms turns out too shaky — bigger, slower, more accurate.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodewhisper } from "nodejs-whisper";
import { VoiceTranscriptionError } from "../app-errors.js";
import { stripWhisperTimestamps } from "./transcript-cleanup.js";
import type { VoiceTranscriptionService } from "./voice-transcription-service.js";

const MODEL_NAME = process.env.WHISPER_MODEL ?? "base";
const MODEL_ROOT_PATH = process.env.WHISPER_MODEL_PATH ?? join(process.cwd(), ".whisper-models");
/** French by default, matching speech-recognizer.ts's native recognizer — the lexicon (not the STT locale) is what understands mixed-in English Magic terms. */
const LANGUAGE = process.env.WHISPER_LANGUAGE ?? "fr";

export class WhisperTranscriptionService implements VoiceTranscriptionService {
  async transcribe(audio: Buffer, extension: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "asphodel-voice-"));
    const inputPath = join(dir, `take.${extension}`);

    try {
      await writeFile(inputPath, audio);
      const raw = await nodewhisper(inputPath, {
        modelName: MODEL_NAME,
        autoDownloadModelName: MODEL_NAME,
        modelRootPath: MODEL_ROOT_PATH,
        removeWavFileAfterTranscription: true,
        whisperOptions: { language: LANGUAGE },
      });
      const transcript = stripWhisperTimestamps(raw);
      if (!transcript) throw new Error("whisper.cpp produced no transcribable speech");
      return transcript;
    } catch (error) {
      console.error("[voice] whisper.cpp transcription failed:", error);
      throw new VoiceTranscriptionError();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
