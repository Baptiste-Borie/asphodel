import assert from "node:assert/strict";
import { describe, it } from "node:test";
import FormData from "form-data";
import { buildApp } from "../app.js";
import { createTestDatabase, FakeVoiceTranscriptionService } from "../test-helpers.js";

async function createTestApp(voiceTranscriptionService = new FakeVoiceTranscriptionService()) {
  const database = await createTestDatabase();
  const app = await buildApp({ database, voiceTranscriptionService });
  app.addHook("onClose", async () => database.close());
  return app;
}

function audioUpload(fieldValue: Buffer = Buffer.from("fake-opus-bytes")): { form: FormData; headers: Record<string, string> } {
  const form = new FormData();
  form.append("audio", fieldValue, { filename: "take.webm", contentType: "audio/webm" });
  return { form, headers: form.getHeaders() };
}

describe("POST /voice/transcribe", () => {
  it("renvoie le transcript produit par le service de transcription", async () => {
    const service = new FakeVoiceTranscriptionService("j'attaque avec Krenko");
    const app = await createTestApp(service);
    const { form, headers } = audioUpload();

    const response = await app.inject({ method: "POST", url: "/voice/transcribe", payload: form, headers });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { transcript: "j'attaque avec Krenko" });
    assert.equal(service.calls.length, 1);
    assert.equal(service.calls[0]?.extension, "webm");

    await app.close();
  });

  it("retourne 400 quand aucun fichier n'est envoyé", async () => {
    const app = await createTestApp();
    const form = new FormData();
    form.append("notAudio", "oops");

    const response = await app.inject({ method: "POST", url: "/voice/transcribe", payload: form, headers: form.getHeaders() });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "MISSING_AUDIO");

    await app.close();
  });

  it("retourne 502 quand la transcription échoue", async () => {
    const app = await createTestApp(new FakeVoiceTranscriptionService(undefined, true));
    const { form, headers } = audioUpload();

    const response = await app.inject({ method: "POST", url: "/voice/transcribe", payload: form, headers });

    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error, "VOICE_TRANSCRIPTION_FAILED");

    await app.close();
  });
});
