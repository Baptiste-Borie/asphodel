import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildApp } from "./app.js";
import { createDatabase, type DatabaseConnection } from "./db/client.js";
import { cards, decks } from "./db/schema.js";
import { createTestDatabase, FakeCardProvider } from "./test-helpers.js";

const validDecklist = `Commander
1x Krenko, Tin Street Kingpin

Mainboard
1x Sol Ring
30x Mountain`;

const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];
const openDatabases: DatabaseConnection[] = [];
const temporaryDirectories: string[] = [];

async function createLibraryApp(
  provider = new FakeCardProvider(),
  database?: DatabaseConnection,
) {
  const connection = database ?? (await createTestDatabase());
  const app = await buildApp({ database: connection, cardProvider: provider });
  openApps.push(app);
  openDatabases.push(connection);
  return { app, database: connection, provider };
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  openDatabases.splice(0).forEach((database) => database.close());
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Deck Library", () => {
  it("crée, persiste et récupère un deck enrichi", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-test-"));
    temporaryDirectories.push(directory);
    const databaseUrl = `file:${join(directory, "library.sqlite")}`;
    const firstDatabase = await createDatabase(databaseUrl);
    const first = await createLibraryApp(new FakeCardProvider(), firstDatabase);

    const creation = await first.app.inject({
      method: "POST",
      url: "/decks",
      payload: { name: "Gobelins", decklist: validDecklist },
    });

    assert.equal(creation.statusCode, 201);
    assert.equal(creation.json().name, "Gobelins");
    assert.equal(creation.json().totalCards, 32);
    const deckId = creation.json().id as number;

    await first.app.close();
    openApps.splice(openApps.indexOf(first.app), 1);
    firstDatabase.close();
    openDatabases.splice(openDatabases.indexOf(firstDatabase), 1);

    const secondDatabase = await createDatabase(databaseUrl);
    const second = await createLibraryApp(
      new FakeCardProvider(),
      secondDatabase,
    );
    const retrieval = await second.app.inject({
      method: "GET",
      url: `/decks/${deckId}`,
    });

    assert.equal(retrieval.statusCode, 200);
    assert.equal(retrieval.json().cards.length, 3);
    assert.equal(retrieval.json().cards[0].section, "commander");
  });

  it("refuse un import invalide sans contacter le fournisseur ni écrire en DB", async () => {
    const provider = new FakeCardProvider();
    const { app, database } = await createLibraryApp(provider);

    const response = await app.inject({
      method: "POST",
      url: "/decks",
      payload: {
        name: "Deck invalide",
        decklist: "Commander\nKrenko, Tin Street Kingpin",
      },
    });

    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error, "INVALID_DECK_FORMAT");
    assert.deepEqual(provider.calls, []);
    assert.deepEqual(await database.db.select().from(decks), []);
  });

  it("annule tout l’import lorsqu’une carte est introuvable", async () => {
    const provider = new FakeCardProvider(new Set(["Carte inconnue"]));
    const { app, database } = await createLibraryApp(provider);

    const response = await app.inject({
      method: "POST",
      url: "/decks",
      payload: {
        name: "Import incomplet",
        decklist:
          "Commander\n1x Krenko, Tin Street Kingpin\nMainboard\n1x Carte inconnue",
      },
    });

    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error, "CARDS_NOT_FOUND");
    assert.deepEqual(await database.db.select().from(decks), []);
    assert.deepEqual(await database.db.select().from(cards), []);
  });

  it("liste, renomme puis supprime un deck", async () => {
    const { app } = await createLibraryApp();
    const creation = await app.inject({
      method: "POST",
      url: "/decks",
      payload: { name: "Ancien nom", decklist: validDecklist },
    });
    const deckId = creation.json().id as number;

    const list = await app.inject({ method: "GET", url: "/decks" });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().decks.length, 1);
    assert.equal(list.json().decks[0].commander.name, "Krenko, Tin Street Kingpin");

    const rename = await app.inject({
      method: "PATCH",
      url: `/decks/${deckId}`,
      payload: { name: "Nouveau nom" },
    });
    assert.equal(rename.statusCode, 200);
    assert.equal(rename.json().name, "Nouveau nom");

    const deletion = await app.inject({
      method: "DELETE",
      url: `/decks/${deckId}`,
    });
    assert.equal(deletion.statusCode, 204);

    const missing = await app.inject({
      method: "GET",
      url: `/decks/${deckId}`,
    });
    assert.equal(missing.statusCode, 404);
  });

  it("réutilise le cache de cartes lors d’un second import", async () => {
    const provider = new FakeCardProvider();
    const { app, database } = await createLibraryApp(provider);

    for (const name of ["Premier deck", "Second deck"]) {
      const response = await app.inject({
        method: "POST",
        url: "/decks",
        payload: { name, decklist: validDecklist },
      });
      assert.equal(response.statusCode, 201);
    }

    assert.deepEqual(provider.calls, [
      "Krenko, Tin Street Kingpin",
      "Sol Ring",
      "Mountain",
    ]);
    assert.equal((await database.db.select().from(cards)).length, 3);
    assert.equal((await database.db.select().from(decks)).length, 2);
  });
});
