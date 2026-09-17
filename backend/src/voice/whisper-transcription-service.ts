/**
 * Fallback STT for browsers without native SpeechRecognition (Firefox, mainly — see
 * frontend/src/voice/mic-capture.ts). Runs whisper.cpp locally: 100% free/offline, no API
 * key, no per-call cost.
 *
 * We shell out to the `whisper-cli` binary that `nodejs-whisper` vendors and builds on
 * `npm install` (whisper.cpp compiled from source + a model-download script), but we do
 * NOT use nodejs-whisper's own `nodewhisper()` helper to run it: its command builder only
 * exposes a fixed whitelist of flags and has no passthrough for `-ac`/`-bo`/`-bs`, which
 * are exactly the flags that matter for short push-to-talk commands (see WHISPER_AUDIO_CTX
 * below) — profiling showed they're a 4-5x latency win nodejs-whisper can't express. We
 * still depend on nodejs-whisper only for its vendored build artifacts (the compiled binary
 * + models/download-ggml-model.sh), not its JS internals.
 *
 * Defaults below come from benchmarking realistic short French/Magic phrases ("je passe",
 * "je caste K'rrik", "j'attaque avec K'rrik et Vilis", ...) on the homelab CPU:
 *  - "tiny" instead of "base": ~2x faster encode, no meaningful accuracy loss for what the
 *    resolver needs downstream (it ranks only currently-legal Forge actions against a small
 *    candidate set, so it already tolerates phonetic STT noise on card names).
 *  - a capped audio context (-ac): whisper.cpp always pads/encodes up to this many 20ms
 *    frames regardless of actual clip length (1500 = the model's full 30s window), so encode
 *    time does NOT scale down with a short clip unless you cap it explicitly. 512 frames ≈
 *    10.24s — generous headroom over any realistic voice command — cuts encode time by
 *    ~2.5-4x for free.
 *  - greedy decoding (-bo 1 -bs 1) instead of whisper-cli's default 5-beam/best-of-5: shaves
 *    another ~30% with no observed accuracy loss on short commands.
 *  - no temperature fallback (-nf): whisper-cli's default retries a decode at higher temperature
 *    when the greedy pass looks low-confidence (high entropy/low logprob) — each retry re-runs the
 *    full decode. Benchmarking the contextual `--prompt` below (see whisper-prompt.ts) surfaced a
 *    real case of this: one sample's otherwise-~200ms greedy decode became ~900ms with 2 fallback
 *    retries once a prompt nudged its confidence down, with no better (in fact slightly worse)
 *    transcript to show for it. `-nf` makes latency bounded and predictable regardless of what any
 *    prompt does to decode confidence — a harmless no-op on the (already deterministic) no-prompt
 *    path, since that path was never triggering a fallback anyway.
 * Combined, these took the base-model default (~1.4-1.5s/phrase on this CPU) to ~200-450ms
 * end-to-end — comfortably inside the 1-3s gameplay target. Override any of them per
 * deployment without touching this file; see .env.example.
 */
import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { VoiceTranscriptionError } from "../app-errors.js";
import { stripWhisperTimestamps } from "./transcript-cleanup.js";
import type { TranscriptionContext, VoiceTranscriptionService } from "./voice-transcription-service.js";
import { buildWhisperPrompt } from "./whisper-prompt.js";

const execFileAsync = promisify(execFile);

/** "tiny" trades a bit of raw accuracy for ~2x lower encode time than "base" — see module comment. */
const MODEL_NAME = process.env.WHISPER_MODEL ?? "tiny";
const MODEL_ROOT_PATH = process.env.WHISPER_MODEL_PATH ?? join(process.cwd(), ".whisper-models");
/** French by default, matching speech-recognizer.ts's native recognizer — the lexicon (not the STT locale) is what understands mixed-in English Magic terms. */
const LANGUAGE = process.env.WHISPER_LANGUAGE ?? "fr";
const THREADS = process.env.WHISPER_THREADS ?? "4";
/** Encoder context cap in 20ms frames (0 = full 30s window). See module comment. */
const AUDIO_CTX = process.env.WHISPER_AUDIO_CTX ?? "512";
/** Greedy decoding by default — see module comment. Raise these back toward whisper-cli's 5/5 default if accuracy ever needs it more than speed. */
const BEAM_SIZE = process.env.WHISPER_BEAM_SIZE ?? "1";
const BEST_OF = process.env.WHISPER_BEST_OF ?? "1";
/** See module comment. `"false"` restores whisper-cli's own default fallback behavior. */
const NO_FALLBACK = process.env.WHISPER_NO_FALLBACK !== "false";

const MODEL_FILE_BY_NAME: Record<string, string> = {
  tiny: "ggml-tiny.bin",
  "tiny.en": "ggml-tiny.en.bin",
  base: "ggml-base.bin",
  "base.en": "ggml-base.en.bin",
  small: "ggml-small.bin",
  "small.en": "ggml-small.en.bin",
  medium: "ggml-medium.bin",
  "medium.en": "ggml-medium.en.bin",
};

const NODEJS_WHISPER_ROOT = dirname(fileURLToPath(import.meta.resolve("nodejs-whisper/package.json")));
const WHISPER_CPP_ROOT = join(NODEJS_WHISPER_ROOT, "cpp", "whisper.cpp");
const WHISPER_CLI_PATH = join(WHISPER_CPP_ROOT, "build", "bin", "whisper-cli");
const DOWNLOAD_MODEL_SCRIPT = join(WHISPER_CPP_ROOT, "models", "download-ggml-model.sh");

/** Mirrors nodejs-whisper's own autoDownloadModel(): fetch once, reuse the file on every call after. */
async function ensureModelDownloaded(modelName: string, modelPath: string): Promise<void> {
  try {
    await access(modelPath);
    return;
  } catch {
    // not present yet — download it below
  }
  await execFileAsync(DOWNLOAD_MODEL_SCRIPT, [modelName, MODEL_ROOT_PATH], { cwd: dirname(DOWNLOAD_MODEL_SCRIPT) });
}

/**
 * Pure — separated from `transcribe()` purely so tests can assert on the exact argv `execFile`
 * receives (that `--prompt`/`--no-fallback` show up correctly, and that a hostile vocabulary entry
 * stays one inert argv element) without shelling out to a real whisper-cli binary. Each element is
 * always a plain array entry, never concatenated into a string — the same property that already
 * makes `execFile` (vs. `exec`) immune to shell injection here.
 */
export function buildWhisperArgs(params: {
  threads: string;
  bestOf: string;
  beamSize: string;
  audioCtx: string;
  language: string;
  modelPath: string;
  wavPath: string;
  noFallback: boolean;
  prompt: string | null;
}): string[] {
  const args = [
    "-t",
    params.threads,
    "-bo",
    params.bestOf,
    "-bs",
    params.beamSize,
    "-ac",
    params.audioCtx,
    "-l",
    params.language,
    "-m",
    params.modelPath,
    "-f",
    params.wavPath,
  ];
  if (params.noFallback) args.push("--no-fallback");
  if (params.prompt) args.push("--prompt", params.prompt);
  return args;
}

export class WhisperTranscriptionService implements VoiceTranscriptionService {
  async transcribe(audio: Buffer, extension: string, context?: TranscriptionContext): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "asphodel-voice-"));
    const inputPath = join(dir, `take.${extension}`);
    const wavPath = join(dir, "take.wav");

    try {
      await writeFile(inputPath, audio);
      await execFileAsync("ffmpeg", [
        "-nostats",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wavPath,
      ]);

      const modelFile = MODEL_FILE_BY_NAME[MODEL_NAME];
      if (!modelFile) throw new Error(`Unknown WHISPER_MODEL "${MODEL_NAME}"`);
      const modelPath = join(MODEL_ROOT_PATH, modelFile);
      await ensureModelDownloaded(MODEL_NAME, modelPath);

      const args = buildWhisperArgs({
        threads: THREADS,
        bestOf: BEST_OF,
        beamSize: BEAM_SIZE,
        audioCtx: AUDIO_CTX,
        language: LANGUAGE,
        modelPath,
        wavPath,
        noFallback: NO_FALLBACK,
        prompt: buildWhisperPrompt(context?.vocabulary),
      });

      const { stdout } = await execFileAsync(WHISPER_CLI_PATH, args);

      const transcript = stripWhisperTimestamps(stdout);
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
