import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "./app.js";
import { createTestDatabase, FakeCardProvider } from "./test-helpers.js";

async function createTestApp() {
  const database = await createTestDatabase();
  const app = await buildApp({
    database,
    cardProvider: new FakeCardProvider(),
  });

  app.addHook("onClose", async () => database.close());
  return app;
}

describe("POST /decks/parse", () => {
  it("retourne le deck structuré", async () => {
    const app = await createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/decks/parse",
      payload: {
        text: "Commander\n1x Krenko, Tin Street Kingpin\n\nMainboard\n30x Mountain",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      cards: [
        {
          quantity: 1,
          name: "Krenko, Tin Street Kingpin",
          section: "commander",
        },
        { quantity: 30, name: "Mountain", section: "mainboard" },
      ],
      issues: [],
      summary: { entries: 2, totalCards: 31 },
    });

    await app.close();
  });

  it("retourne 422 et le détail des lignes invalides", async () => {
    const app = await createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/decks/parse",
      payload: { text: "Commander\nKrenko, Tin Street Kingpin" },
    });

    assert.equal(response.statusCode, 422);
    assert.equal(response.json().issues[0].line, 2);

    await app.close();
  });
});
