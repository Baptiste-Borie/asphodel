import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { ScryfallCardProvider } from "./cards/scryfall-provider.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("ScryfallCardProvider bulk", () => {
  it("résout les cartes depuis le catalogue local sans appel réseau", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = join(directory, "oracle-cards.jsonl.gz");
    await writeFile(
      bulkPath,
      gzipSync(
        `${JSON.stringify({
          id: "card-id",
          oracle_id: "oracle-id",
          name: "Sol Ring",
          mana_cost: "{1}",
          cmc: 1,
          type_line: "Artifact",
          oracle_text: "{T}: Add {C}{C}.",
          colors: [],
          color_identity: [],
          image_uris: { normal: "https://img.test/sol-ring.jpg" },
        })}\n`,
      ),
    );

    const provider = new ScryfallCardProvider({
      bulkPath,
      fetch: async () => {
        throw new Error("Le réseau ne doit pas être utilisé");
      },
    });

    const card = await provider.findByExactName("  SOL RING ");
    assert.equal(card?.scryfallId, "card-id");
    assert.equal(card?.name, "Sol Ring");
    assert.equal(await provider.findByExactName("Carte absente"), null);
  });

  it("assemble les informations des deux faces", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = join(directory, "oracle-cards.jsonl.gz");
    await writeFile(
      bulkPath,
      gzipSync(
        `${JSON.stringify({
          id: "double-card-id",
          oracle_id: "double-oracle-id",
          name: "Face A // Face B",
          cmc: 3,
          type_line: "",
          color_identity: ["R"],
          card_faces: [
            {
              mana_cost: "{1}{R}",
              type_line: "Creature",
              oracle_text: "Texte A",
              colors: ["R"],
              image_uris: { normal: "https://img.test/front.jpg" },
            },
            {
              mana_cost: "{R}",
              type_line: "Sorcery",
              oracle_text: "Texte B",
              colors: ["R"],
            },
          ],
        })}\n`,
      ),
    );

    const provider = new ScryfallCardProvider({ bulkPath });
    const card = await provider.findByExactName("Face A // Face B");

    assert.equal(card?.manaCost, "{1}{R} // {R}");
    assert.equal(card?.typeLine, "Creature // Sorcery");
    assert.equal(card?.oracleText, "Texte A\n//\nTexte B");
    assert.equal(card?.imageUri, "https://img.test/front.jpg");
    assert.deepEqual(card?.colors, ["R"]);
  });

  it("résout une impression exacte par set + numéro de collection depuis le catalogue \"default_cards\" séparé", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(
      printingBulkPath,
      gzipSync(
        [
          JSON.stringify({
            id: "uurg-dmu-225", oracle_id: "uurg-oracle", name: "Uurg, Spawn of Turg",
            mana_cost: "{B}{B}{G}", cmc: 3, type_line: "Legendary Creature — Frog Beast",
            oracle_text: "Uurg's power is equal to the number of land cards in your graveyard.",
            colors: ["B", "G"], color_identity: ["B", "G"],
            image_uris: { normal: "https://img.test/uurg-dmu.jpg" },
            set: "dmu", collector_number: "225",
          }),
          JSON.stringify({
            id: "some-other-printing", oracle_id: "uurg-oracle", name: "Uurg, Spawn of Turg",
            mana_cost: "{B}{B}{G}", cmc: 3, type_line: "Legendary Creature — Frog Beast",
            colors: ["B", "G"], color_identity: ["B", "G"],
            set: "2x2", collector_number: "225",
          }),
        ].join("\n"),
      ),
    );

    const provider = new ScryfallCardProvider({
      printingBulkPath,
      fetch: async () => { throw new Error("Le réseau ne doit pas être utilisé"); },
    });

    const card = await provider.findBySetAndCollector("DMU", "225");
    assert.equal(card?.scryfallId, "uurg-dmu-225");
    assert.equal(card?.imageUri, "https://img.test/uurg-dmu.jpg");
  });

  it("le code d'édition est insensible à la casse pour la recherche par impression", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(
      printingBulkPath,
      gzipSync(
        `${JSON.stringify({
          id: "sol-ring-lea", oracle_id: "sol-ring-oracle", name: "Sol Ring", cmc: 1, type_line: "Artifact",
          color_identity: [], set: "lea", collector_number: "1",
        })}\n`,
      ),
    );
    const provider = new ScryfallCardProvider({ printingBulkPath });
    assert.equal((await provider.findBySetAndCollector("LEA", "1"))?.scryfallId, "sol-ring-lea");
    assert.equal((await provider.findBySetAndCollector("lea", "1"))?.scryfallId, "sol-ring-lea");
  });

  it("une impression introuvable renvoie null sans jeter d'erreur", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(printingBulkPath, gzipSync(""));
    const provider = new ScryfallCardProvider({ printingBulkPath });
    assert.equal(await provider.findBySetAndCollector("ZZZ", "999"), null);
  });

  it("l'index d'impressions n'est jamais chargé si seule la recherche par nom est utilisée", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = join(directory, "oracle-cards.jsonl.gz");
    await writeFile(bulkPath, gzipSync(`${JSON.stringify({ id: "sol-ring-oracle", name: "Sol Ring", cmc: 1, type_line: "Artifact", color_identity: [] })}\n`));
    const provider = new ScryfallCardProvider({
      bulkPath,
      // Any attempt to reach the (unset) default printingBulkPath or the network must never happen.
      printingBulkPath: join(directory, "never-created.jsonl.gz"),
      fetch: async () => { throw new Error("no network for a plain name lookup"); },
    });
    const card = await provider.findByExactName("Sol Ring");
    assert.equal(card?.scryfallId, "sol-ring-oracle");
  });
});

/** The real Scryfall object at https://scryfall.com/card/tltr/H13/the-ring-the-ring-tempts-you. */
function theRingFixture() {
  return {
    id: "ring-token-id",
    oracle_id: "ring-oracle-id",
    name: "The Ring // The Ring Tempts You",
    cmc: 0,
    type_line: "",
    color_identity: [],
    layout: "double_faced_token",
    card_faces: [
      {
        name: "The Ring",
        type_line: "Legendary Artifact — The Ring",
        oracle_text: "The Ring tempts you. Whenever the Ring tempts you, choose the next reward...",
        colors: [],
        image_uris: { normal: "https://img.test/the-ring.jpg" },
      },
      {
        name: "The Ring Tempts You",
        type_line: "Emblem",
        oracle_text: "As long as your Ring-bearer is your chosen creature, it can't be blocked by creatures with greater power.",
        colors: [],
        image_uris: { normal: "https://img.test/the-ring-tempts-you.jpg" },
      },
    ],
  };
}

/**
 * Every test below that calls `findByExactName` must pass an ISOLATED (empty, unless the test
 * says otherwise) `bulkPath` explicitly — omitting it falls back to `defaultBulkPath`, which on a
 * developer machine that has already run the backend for real may point at an actual downloaded
 * Scryfall "oracle-cards" file. That real file is not test-controlled data (it can contain a real
 * card that happens to share a name with a test's synthetic token fixture) and must never leak
 * into a unit test's result.
 */
async function emptyBulkPath(directory: string): Promise<string> {
  const bulkPath = join(directory, "oracle-cards.jsonl.gz");
  await writeFile(bulkPath, gzipSync(""));
  return bulkPath;
}

describe("ScryfallCardProvider token/emblem/face presentation lookup (V2g.1)", () => {
  it('"The Ring" resolves from the synthetic "The Ring // The Ring Tempts You" token object, to its OWN face image/type — never the merged or sibling-face presentation', async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = await emptyBulkPath(directory);
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(printingBulkPath, gzipSync(`${JSON.stringify(theRingFixture())}\n`));

    const provider = new ScryfallCardProvider({
      bulkPath,
      printingBulkPath,
      fetch: async () => {
        throw new Error("Le réseau ne doit pas être utilisé");
      },
    });

    // Nothing warms the index first — the very first call already carries the fallback, so a miss
    // on the oracle-cards index is never cached as a dead end before the token index is consulted.
    const card = await provider.findByExactName("The Ring");
    assert.equal(card?.name, "The Ring");
    assert.equal(card?.imageUri, "https://img.test/the-ring.jpg");
    assert.equal(card?.typeLine, "Legendary Artifact — The Ring");
    assert.notEqual(card?.imageUri, "https://img.test/the-ring-tempts-you.jpg");
  });

  it('a legitimate second face ("The Ring Tempts You") resolves to ITS OWN image/type, not the first face\'s', async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = await emptyBulkPath(directory);
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(printingBulkPath, gzipSync(`${JSON.stringify(theRingFixture())}\n`));
    const provider = new ScryfallCardProvider({ bulkPath, printingBulkPath });

    const card = await provider.findByExactName("The Ring Tempts You");
    assert.equal(card?.name, "The Ring Tempts You");
    assert.equal(card?.imageUri, "https://img.test/the-ring-tempts-you.jpg");
    assert.equal(card?.typeLine, "Emblem");
  });

  it("a normal card lookup is unaffected by an unrelated token/helper object sharing the printing bulk file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = join(directory, "oracle-cards.jsonl.gz");
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(
      bulkPath,
      gzipSync(
        `${JSON.stringify({
          id: "sol-ring-id", oracle_id: "sol-ring-oracle", name: "Sol Ring", mana_cost: "{1}", cmc: 1,
          type_line: "Artifact", oracle_text: "{T}: Add {C}{C}.", colors: [], color_identity: [],
          image_uris: { normal: "https://img.test/sol-ring.jpg" },
        })}\n`,
      ),
    );
    await writeFile(printingBulkPath, gzipSync(`${JSON.stringify(theRingFixture())}\n`));
    const provider = new ScryfallCardProvider({ bulkPath, printingBulkPath });

    const card = await provider.findByExactName("Sol Ring");
    assert.equal(card?.imageUri, "https://img.test/sol-ring.jpg");
  });

  it("a real card's exact name always wins over a same-named token/helper FACE — the token/helper fallback only ever fills a gap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = join(directory, "oracle-cards.jsonl.gz");
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(
      bulkPath,
      gzipSync(
        `${JSON.stringify({
          id: "real-fire-id", oracle_id: "real-fire-oracle", name: "Fire", mana_cost: "{R}", cmc: 1,
          type_line: "Instant", oracle_text: "Fire deals 2 damage to any target.", colors: ["R"], color_identity: ["R"],
          image_uris: { normal: "https://img.test/real-fire.jpg" },
        })}\n`,
      ),
    );
    await writeFile(
      printingBulkPath,
      gzipSync(
        `${JSON.stringify({
          id: "decoy-token-id", oracle_id: "decoy-token-oracle", name: "Fire // Fire's Echo", cmc: 0,
          type_line: "", color_identity: ["R"], layout: "double_faced_token",
          card_faces: [
            { name: "Fire", type_line: "Token — decoy", colors: ["R"], image_uris: { normal: "https://img.test/token-fire.jpg" } },
            { name: "Fire's Echo", type_line: "Token — decoy", colors: ["R"], image_uris: { normal: "https://img.test/token-fires-echo.jpg" } },
          ],
        })}\n`,
      ),
    );
    const provider = new ScryfallCardProvider({ bulkPath, printingBulkPath });

    const card = await provider.findByExactName("Fire");
    assert.equal(card?.imageUri, "https://img.test/real-fire.jpg", "the real card must win — a token face alias never shadows it");
  });

  it("an ordinary single-name token (no card_faces) resolves via the token/helper index", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = await emptyBulkPath(directory);
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(
      printingBulkPath,
      gzipSync(
        `${JSON.stringify({
          id: "test-fixture-token-id", oracle_id: "test-fixture-token-oracle", name: "Asphodel Test Fixture Token", cmc: 0,
          type_line: "Token Creature — Soldier", color_identity: [], colors: [], layout: "token",
          image_uris: { normal: "https://img.test/soldier-token.jpg" },
        })}\n`,
      ),
    );
    const provider = new ScryfallCardProvider({ bulkPath, printingBulkPath });

    const card = await provider.findByExactName("Asphodel Test Fixture Token");
    assert.equal(card?.imageUri, "https://img.test/soldier-token.jpg");
  });

  it("an unresolvable name (neither a real card nor any token/helper) returns null cleanly, never an error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = join(directory, "oracle-cards.jsonl.gz");
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(bulkPath, gzipSync(""));
    await writeFile(printingBulkPath, gzipSync(""));
    const provider = new ScryfallCardProvider({ bulkPath, printingBulkPath });
    assert.equal(await provider.findByExactName("Nothing At All"), null);
  });

  it("repeated lookups reuse the in-memory token index — the bulk file is scanned at most once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = await emptyBulkPath(directory);
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(printingBulkPath, gzipSync(`${JSON.stringify(theRingFixture())}\n`));
    const provider = new ScryfallCardProvider({ bulkPath, printingBulkPath });

    assert.equal((await provider.findByExactName("The Ring"))?.imageUri, "https://img.test/the-ring.jpg");
    // A second lookup that rescanned the bulk file would throw ENOENT here — proving the in-memory
    // index built on the first call is reused, never rebuilt, regardless of which name is asked for.
    await rm(printingBulkPath, { force: true });
    assert.equal((await provider.findByExactName("The Ring Tempts You"))?.imageUri, "https://img.test/the-ring-tempts-you.jpg");
  });

  it('findBySetAndCollector (deck import) is unaffected by a token/helper object sharing the same "default_cards" bulk file', async () => {
    const directory = await mkdtemp(join(tmpdir(), "asphodel-scryfall-"));
    temporaryDirectories.push(directory);
    const bulkPath = await emptyBulkPath(directory);
    const printingBulkPath = join(directory, "default-cards.jsonl.gz");
    await writeFile(
      printingBulkPath,
      gzipSync(
        [
          JSON.stringify({
            id: "uurg-dmu-225", oracle_id: "uurg-oracle", name: "Uurg, Spawn of Turg",
            mana_cost: "{B}{B}{G}", cmc: 3, type_line: "Legendary Creature — Frog Beast",
            colors: ["B", "G"], color_identity: ["B", "G"],
            image_uris: { normal: "https://img.test/uurg-dmu.jpg" },
            set: "dmu", collector_number: "225",
          }),
          JSON.stringify(theRingFixture()),
        ].join("\n"),
      ),
    );
    const provider = new ScryfallCardProvider({ bulkPath, printingBulkPath });

    const printing = await provider.findBySetAndCollector("dmu", "225");
    assert.equal(printing?.imageUri, "https://img.test/uurg-dmu.jpg");
    const ring = await provider.findByExactName("The Ring");
    assert.equal(ring?.imageUri, "https://img.test/the-ring.jpg");
  });
});
