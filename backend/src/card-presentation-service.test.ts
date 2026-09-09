import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import { gzipSync } from "node:zlib";
import type { CardProvider, ResolvedCard } from "./cards/card-provider.js";
import { CardPresentationService, MAX_CARD_PRESENTATION_NAMES } from "./cards/card-presentation-service.js";
import { ScryfallCardProvider } from "./cards/scryfall-provider.js";
import { FakeCardProvider } from "./test-helpers.js";

it("resolves each requested card to its presentation-only fields", async () => {
  const service = new CardPresentationService(new FakeCardProvider());
  const result = await service.resolveMany(["Mountain"]);
  assert.deepEqual(result["Mountain"], {
    name: "Mountain", manaCost: null, manaValue: 0, typeLine: "Basic Land — Mountain", oracleText: null,
    imageUri: "https://cards.example/mountain.jpg",
  });
});

it("deduplicates names before ever calling the card provider", async () => {
  const provider = new FakeCardProvider();
  const service = new CardPresentationService(provider);
  await service.resolveMany(["Mountain", "Mountain", "Mountain"]);
  assert.deepEqual(provider.calls, ["Mountain"]);
});

it("caches across separate resolveMany calls: a previously resolved name is never looked up again", async () => {
  const provider = new FakeCardProvider();
  const service = new CardPresentationService(provider);
  await service.resolveMany(["Mountain"]);
  await service.resolveMany(["Mountain", "Sol Ring"]);
  assert.deepEqual(provider.calls, ["Mountain", "Sol Ring"]);
});

it("an unknown card name is simply absent from the result, not an error, and does not block the rest of the batch", async () => {
  const provider = new FakeCardProvider(new Set(["Nonexistent Card"]));
  const service = new CardPresentationService(provider);
  const result = await service.resolveMany(["Mountain", "Nonexistent Card", "Sol Ring"]);
  assert.ok(result["Mountain"]);
  assert.ok(result["Sol Ring"]);
  assert.equal("Nonexistent Card" in result, false);
});

it("one card's provider failure does not fail the whole batch", async () => {
  class FlakyProvider implements CardProvider {
    async findByExactName(name: string): Promise<ResolvedCard | null> {
      if (name === "Boom") throw new Error("simulated provider failure");
      return new FakeCardProvider().findByExactName(name);
    }
    async findBySetAndCollector(): Promise<ResolvedCard | null> {
      return null;
    }
  }
  const service = new CardPresentationService(new FlakyProvider());
  const result = await service.resolveMany(["Mountain", "Boom", "Sol Ring"]);
  assert.ok(result["Mountain"]);
  assert.ok(result["Sol Ring"]);
  assert.equal("Boom" in result, false);
});

it("caches a failed resolution too, so a broken name is not retried on every subsequent request", async () => {
  let calls = 0;
  class FlakyProvider implements CardProvider {
    async findByExactName(): Promise<ResolvedCard | null> {
      calls++;
      throw new Error("always fails");
    }
    async findBySetAndCollector(): Promise<ResolvedCard | null> {
      return null;
    }
  }
  const service = new CardPresentationService(new FlakyProvider());
  await service.resolveMany(["Boom"]);
  await service.resolveMany(["Boom"]);
  assert.equal(calls, 1);
});

it("caps a single request at MAX_CARD_PRESENTATION_NAMES, ignoring any names beyond that", async () => {
  const provider = new FakeCardProvider();
  const service = new CardPresentationService(provider);
  const names = Array.from({ length: MAX_CARD_PRESENTATION_NAMES + 10 }, (_, i) => `Card ${i}`);
  await service.resolveMany(names);
  assert.equal(provider.calls.length, MAX_CARD_PRESENTATION_NAMES);
});

it("ignores blank/empty-string entries", async () => {
  const provider = new FakeCardProvider();
  const service = new CardPresentationService(provider);
  await service.resolveMany(["Mountain", "", "   "]);
  assert.deepEqual(provider.calls, ["Mountain"]);
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("V2g.1: a token/face name (e.g. \"The Ring\") is resolved and cached correctly on the FIRST request through the real ScryfallCardProvider — no premature 'miss' cached before the token/face fallback runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-presentation-"));
  temporaryDirectories.push(directory);
  // Isolated and empty on purpose: omitting `bulkPath` would fall back to the real local
  // "oracle-cards" bulk file (if one has already been downloaded on this machine), which is not
  // test-controlled data and must never leak into this test's result.
  const bulkPath = join(directory, "oracle-cards.jsonl.gz");
  await writeFile(bulkPath, gzipSync(""));
  const printingBulkPath = join(directory, "default-cards.jsonl.gz");
  await writeFile(
    printingBulkPath,
    gzipSync(
      `${JSON.stringify({
        id: "ring-token-id", oracle_id: "ring-oracle-id", name: "The Ring // The Ring Tempts You", cmc: 0,
        type_line: "", color_identity: [], layout: "double_faced_token",
        card_faces: [
          { name: "The Ring", type_line: "Legendary Artifact — The Ring", colors: [], image_uris: { normal: "https://img.test/the-ring.jpg" } },
          { name: "The Ring Tempts You", type_line: "Emblem", colors: [], image_uris: { normal: "https://img.test/the-ring-tempts-you.jpg" } },
        ],
      })}\n`,
    ),
  );
  const cardProvider = new ScryfallCardProvider({
    bulkPath,
    printingBulkPath,
    fetch: async () => { throw new Error("no network expected"); },
  });
  const service = new CardPresentationService(cardProvider);

  const first = await service.resolveMany(["The Ring"]);
  assert.equal(first["The Ring"]?.imageUri, "https://img.test/the-ring.jpg");

  // If the miss on the plain oracle-cards index had been cached as final before the token/face
  // fallback ran, this second call would come back empty instead of returning the cached hit.
  const second = await service.resolveMany(["The Ring"]);
  assert.equal(second["The Ring"]?.imageUri, "https://img.test/the-ring.jpg");
});
