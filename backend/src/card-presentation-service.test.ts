import assert from "node:assert/strict";
import { it } from "node:test";
import type { CardProvider, ResolvedCard } from "./cards/card-provider.js";
import { CardPresentationService, MAX_CARD_PRESENTATION_NAMES } from "./cards/card-presentation-service.js";
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
