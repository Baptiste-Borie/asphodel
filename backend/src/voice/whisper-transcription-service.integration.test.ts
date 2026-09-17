/**
 * Real whisper.cpp comparison — not mocked. Skipped unless the whisper-cli binary and tiny model
 * `nodejs-whisper`/`npm install` already downloaded are actually present on disk (never triggers a
 * network model download from a test run — see `ensureModelDownloaded` in
 * whisper-transcription-service.ts). Proves, against a real recorded/synthesized utterance, exactly
 * what the benchmark behind whisper-prompt.ts found by hand:
 *  - a contextual `--prompt` measurably improves recognition of a fantasy card name whisper.cpp
 *    otherwise mishears,
 *  - `--no-fallback` keeps that within the sub-second latency budget.
 *
 * The fixture (`testing/fixtures/kokusho-tts.wav`) is a synthesized French utterance — "je cible
 * Kokusho" — chosen because it reproduces the exact "Kokusho -> unrelated French phonetic text"
 * failure this feature targets. Real human speech will vary; this is a regression guard for the
 * mechanism (prompt wiring + fallback bound), not a claim about accuracy on every accent/mic.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { it } from "node:test";
import { WhisperTranscriptionService } from "./whisper-transcription-service.js";

const MODEL_PATH = join(process.env.WHISPER_MODEL_PATH ?? join(process.cwd(), ".whisper-models"), "ggml-tiny.bin");
const FIXTURE_PATH = fileURLToPath(new URL("./testing/fixtures/kokusho-tts.wav", import.meta.url));

it("a contextual prompt fixes a real whisper.cpp fantasy-name miss without breaking the latency budget", { skip: !existsSync(MODEL_PATH), timeout: 30_000 }, async () => {
  const service = new WhisperTranscriptionService();
  const audio = await readFile(FIXTURE_PATH);
  // NOT "wav": ffmpeg auto-detects the real container from content regardless of this extension
  // (it only names the temp file), and "wav" specifically collides input/output temp filenames
  // into the same path (a pre-existing, unrelated bug in this service — see the report). "webm" is
  // also what production always sends in practice (mic-capture.ts).
  const extension = "webm";

  const withoutPrompt = await service.transcribe(audio, extension);
  assert.ok(
    !withoutPrompt.toLowerCase().includes("kokusho"),
    `expected the baseline (no context) transcript to mishear "Kokusho" — got "${withoutPrompt}". If this now passes, whisper.cpp/the model changed and this fixture no longer demonstrates the failure mode.`,
  );

  const start = Date.now();
  const withPrompt = await service.transcribe(audio, extension, { vocabulary: ["Kokusho, the Renegade Ninja"] });
  const elapsedMs = Date.now() - start;

  assert.ok(withPrompt.toLowerCase().includes("kokusho"), `expected the contextual prompt to fix recognition — got "${withPrompt}"`);
  assert.ok(elapsedMs < 2_000, `contextual prompt must stay within the latency budget (--no-fallback) — took ${elapsedMs}ms`);
});
