import assert from "node:assert/strict";
import { it } from "node:test";
import { buildWhisperArgs } from "./whisper-transcription-service.js";

const BASE = { threads: "4", bestOf: "1", beamSize: "1", audioCtx: "512", language: "fr", modelPath: "/models/ggml-tiny.bin", wavPath: "/tmp/take.wav" };

it("omits --prompt entirely when there is no prompt (empty-context behavior)", () => {
  const args = buildWhisperArgs({ ...BASE, noFallback: true, prompt: null });
  assert.ok(!args.includes("--prompt"));
});

it("includes --prompt with the exact prompt string as its own argv element", () => {
  const args = buildWhisperArgs({ ...BASE, noFallback: true, prompt: "Magic: The Gathering. Noms de cartes probables : Sol Ring." });
  const idx = args.indexOf("--prompt");
  assert.ok(idx !== -1);
  assert.equal(args[idx + 1], "Magic: The Gathering. Noms de cartes probables : Sol Ring.");
});

it("keeps a hostile-looking vocabulary string as one inert argv element — never shell syntax", () => {
  const hostile = "Sol Ring; rm -rf / && echo pwned `whoami` $(id)";
  const args = buildWhisperArgs({ ...BASE, noFallback: true, prompt: hostile });
  const idx = args.indexOf("--prompt");
  // The whole hostile string arrives as a SINGLE array element, exactly as given — execFile passes
  // argv directly to the OS (no shell), so none of ;, &&, `` or $() are ever interpreted.
  assert.equal(args[idx + 1], hostile);
  assert.equal(args.filter((a) => a === hostile).length, 1);
});

it("adds --no-fallback only when requested", () => {
  assert.ok(buildWhisperArgs({ ...BASE, noFallback: true, prompt: null }).includes("--no-fallback"));
  assert.ok(!buildWhisperArgs({ ...BASE, noFallback: false, prompt: null }).includes("--no-fallback"));
});

it("still includes every base flag (-t/-bo/-bs/-ac/-l/-m/-f) unchanged", () => {
  const args = buildWhisperArgs({ ...BASE, noFallback: false, prompt: null });
  assert.deepEqual(args, ["-t", "4", "-bo", "1", "-bs", "1", "-ac", "512", "-l", "fr", "-m", "/models/ggml-tiny.bin", "-f", "/tmp/take.wav"]);
});
