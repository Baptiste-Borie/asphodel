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
