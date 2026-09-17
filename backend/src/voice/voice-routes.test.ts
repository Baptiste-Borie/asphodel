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

  it("transmet le vocabulaire contextuel envoyé par le client au service de transcription", async () => {
    const service = new FakeVoiceTranscriptionService();
    const app = await createTestApp(service);
    const form = new FormData();
    form.append("vocabulary", JSON.stringify(["K'rrik, Son of Yawgmoth", "Vilis, Broker of Blood"]));
    form.append("audio", Buffer.from("fake-opus-bytes"), { filename: "take.webm", contentType: "audio/webm" });

    const response = await app.inject({ method: "POST", url: "/voice/transcribe", payload: form, headers: form.getHeaders() });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(service.calls[0]?.context, { vocabulary: ["K'rrik, Son of Yawgmoth", "Vilis, Broker of Blood"] });

    await app.close();
  });

  it("n'attache aucun contexte quand le client n'envoie pas de vocabulaire — comportement identique à avant", async () => {
    const service = new FakeVoiceTranscriptionService();
    const app = await createTestApp(service);
    const { form, headers } = audioUpload();

    await app.inject({ method: "POST", url: "/voice/transcribe", payload: form, headers });

    assert.equal(service.calls[0]?.context, undefined);

    await app.close();
  });

  it("ignore un champ vocabulary malformé (pas du JSON, pas un tableau, tableau vide) au lieu d'échouer la requête", async () => {
    const service = new FakeVoiceTranscriptionService();
    const app = await createTestApp(service);

    for (const malformed of ["not json", JSON.stringify({ not: "an array" }), JSON.stringify([]), JSON.stringify([123, null, "  "])]) {
      const form = new FormData();
      form.append("vocabulary", malformed);
      form.append("audio", Buffer.from("fake-opus-bytes"), { filename: "take.webm", contentType: "audio/webm" });
      const response = await app.inject({ method: "POST", url: "/voice/transcribe", payload: form, headers: form.getHeaders() });
      assert.equal(response.statusCode, 200);
    }
    assert.ok(service.calls.every((c) => c.context === undefined));

    await app.close();
  });

  it("recap défensivement un vocabulaire client trop long/trop nombreux avant de le transmettre — jamais de confiance aveugle dans l'entrée réseau", async () => {
    const service = new FakeVoiceTranscriptionService();
    const app = await createTestApp(service);
    const hugeTerm = "A".repeat(500);
    const manyTerms = Array.from({ length: 50 }, (_, i) => `Card ${i}`);
    const form = new FormData();
    form.append("vocabulary", JSON.stringify([hugeTerm, ...manyTerms]));
    form.append("audio", Buffer.from("fake-opus-bytes"), { filename: "take.webm", contentType: "audio/webm" });

    await app.inject({ method: "POST", url: "/voice/transcribe", payload: form, headers: form.getHeaders() });

    const vocabulary = service.calls[0]?.context?.vocabulary;
    assert.ok(vocabulary);
    assert.ok(vocabulary.length <= 12);
    assert.ok(vocabulary.every((term) => term.length <= 80));

    await app.close();
  });
});
