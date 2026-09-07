import assert from "node:assert/strict";
import { it } from "node:test";
import { CardsNotFoundError } from "./app-errors.js";
import { DeckService } from "./decks/deck-service.js";
import { createTestDatabase, FakeCardProvider } from "./test-helpers.js";

async function createService(printings?: Map<string, string>, missingNames?: Set<string>) {
  const database = await createTestDatabase();
  const provider = new FakeCardProvider(missingNames, printings);
  const service = new DeckService(database.db, provider);
  return { service, provider, close: () => database.close() };
}

it("resolves the exact printing named by a decklist's (SET) NUMBER suffix", async () => {
  const { service, provider, close } = await createService(new Map([["dmu/225", "Uurg, Spawn of Turg"]]));
  try {
    const deck = await service.createDeck(
      "Uurg deck",
      "Commander\n1x Uurg, Spawn of Turg (DMU) 225\n\nMainboard\n99x Forest",
    );
    assert.equal(deck.cards.find((c) => c.section === "commander")?.name, "Uurg, Spawn of Turg");
    assert.deepEqual(provider.printingCalls, ["dmu/225"]);
  } finally {
    await close();
  }
});

it("is case-insensitive on the set code", async () => {
  const { service, provider, close } = await createService(new Map([["dmu/225", "Uurg, Spawn of Turg"]]));
  try {
    await service.createDeck("Uurg deck", "Commander\n1x Uurg, Spawn of Turg (dmu) 225\n\nMainboard\n99x Forest");
    await service.createDeck("Uurg deck 2", "Commander\n1x Uurg, Spawn of Turg (DMU) 225\n\nMainboard\n99x Forest");
    assert.deepEqual(provider.printingCalls, ["dmu/225"], "both cases must hit the same normalized printing key");
  } finally {
    await close();
  }
});

it("falls back to an exact name lookup when no printing suffix was given (unchanged behavior)", async () => {
  const { service, provider, close } = await createService();
  try {
    const deck = await service.createDeck("Krenko deck", "Commander\n1x Krenko, Tin Street Kingpin\n\nMainboard\n99x Mountain");
    assert.equal(deck.cards.find((c) => c.section === "commander")?.name, "Krenko, Tin Street Kingpin");
    assert.deepEqual(provider.calls, ["Krenko, Tin Street Kingpin", "Mountain"]);
  } finally {
    await close();
  }
});

it("falls back to the name lookup when the named printing is not found, and still succeeds", async () => {
  const { service, provider, close } = await createService(); // no known printings at all
  try {
    const deck = await service.createDeck(
      "Uurg deck",
      "Commander\n1x Uurg, Spawn of Turg (ZZZ) 999\n\nMainboard\n99x Forest",
    );
    assert.equal(deck.cards.find((c) => c.section === "commander")?.name, "Uurg, Spawn of Turg");
    assert.deepEqual(provider.printingCalls, ["zzz/999"], "the printing lookup must still be attempted, not skipped");
    assert.ok(provider.calls.includes("Uurg, Spawn of Turg"), "must fall back to the name lookup afterward");
  } finally {
    await close();
  }
});

it("fails clearly when neither the printing nor the name resolves to any card", async () => {
  const { service, close } = await createService(undefined, new Set(["Totally Made Up Card"]));
  try {
    await assert.rejects(
      service.createDeck("Bad deck", "Commander\n1x Totally Made Up Card (ZZZ) 999\n\nMainboard\n99x Forest"),
      (error: unknown) => error instanceof CardsNotFoundError,
    );
  } finally {
    await close();
  }
});

it('imports a public Archidekt spec through shared persistence and can reload the library id', async () => {
  const { ArchidektDeckSource } = await import('./decks/archidekt-deck-source.js');
  const { ForgeDeckAdapter } = await import('./forge/forge-deck-adapter.js');
  const db = await createTestDatabase();
  const payload = { name:'Uurg imported',cards:[{quantity:1,categories:['Commander'],card:{oracleCard:{name:'Uurg, Spawn of Turg'}}},{quantity:99,card:{oracleCard:{name:'Forest'}}}] };
  try {
    const requests:string[]=[];
    const source=new ArchidektDeckSource(async url=>{requests.push(url);return {ok:true,status:200,json:async()=>payload};});
    const service=new DeckService(db.db,new FakeCardProvider(),source);
    const deck=await service.importArchidektDeck('https://archidekt.com/decks/123/test');
    assert.equal(deck.name,'Uurg imported'); assert.equal(deck.totalCards,100);
    assert.equal(deck.cards.find(c=>c.section==='commander')?.name,'Uurg, Spawn of Turg');
    assert.equal(new ForgeDeckAdapter().toForgeDeckSpec(await service.getDeck(deck.id)).sourceDeckId,deck.id);
    assert.deepEqual(requests,['https://archidekt.com/api/decks/123/']);
    assert.equal((await service.listDecks()).length,1);
  } finally { db.close(); }
});

it("V2f: a real two-commander (Partner) deck stays consistent across every deck path — Archidekt import, Deck Library persistence, and the ForgeDeckSpec the Forge bridge actually receives", async () => {
  const { ArchidektDeckSource } = await import('./decks/archidekt-deck-source.js');
  const { ForgeDeckAdapter } = await import('./forge/forge-deck-adapter.js');
  const db = await createTestDatabase();
  const payload = { name: 'Frodo and Sam imported', cards: [
    { quantity: 1, categories: ['Commander'], card: { oracleCard: { name: 'Frodo, Adventurous Hobbit' } } },
    { quantity: 1, categories: ['Commander'], card: { oracleCard: { name: 'Sam, Loyal Attendant' } } },
    { quantity: 98, card: { oracleCard: { name: 'Forest' } } },
  ] };
  try {
    const source = new ArchidektDeckSource(async () => ({ ok: true, status: 200, json: async () => payload }));
    const service = new DeckService(db.db, new FakeCardProvider(), source);

    // Same normalized shape straight out of the Archidekt boundary, before any persistence at all —
    // this is exactly what "Archidekt direct match" also uses.
    const directSpec = await source.fetchDeckSpec("https://archidekt.com/decks/456/frodo-and-sam");
    assert.deepEqual(
      directSpec.cards.filter((c) => c.section === "commander").map((c) => c.name).sort(),
      ["Frodo, Adventurous Hobbit", "Sam, Loyal Attendant"],
    );

    // Archidekt -> Deck Library: both commanders survive persistence, never collapsed to one.
    const imported = await service.importArchidektDeck("https://archidekt.com/decks/456/frodo-and-sam");
    assert.equal(imported.totalCards, 100);
    assert.deepEqual(
      imported.cards.filter((c) => c.section === "commander").map((c) => c.name).sort(),
      ["Frodo, Adventurous Hobbit", "Sam, Loyal Attendant"],
    );

    // The Deck Library's own list view never collapses to a single arbitrary commander either.
    const [summary] = await service.listDecks();
    assert.deepEqual(summary!.commanders.map((c) => c.name).sort(), ["Frodo, Adventurous Hobbit", "Sam, Loyal Attendant"]);

    // Deck Library -> ForgeDeckSpec (the exact shape the Forge bridge receives) — same two names,
    // same structure as the direct-Archidekt path above; never silently collapsed to one commander.
    const detail = await service.getDeck(imported.id);
    const forgeSpec = new ForgeDeckAdapter().toForgeDeckSpec(detail);
    assert.deepEqual(
      forgeSpec.cards.filter((c) => c.section === "commander").map((c) => c.name).sort(),
      directSpec.cards.filter((c) => c.section === "commander").map((c) => c.name).sort(),
    );
  } finally {
    db.close();
  }
});

it('failed URL imports never persist a partial deck: host, privacy, size, commander and resolution', async () => {
  const { ArchidektDeckSource } = await import('./decks/archidekt-deck-source.js');
  const db = await createTestDatabase();
  const payload={name:'Failed',cards:[{quantity:1,categories:['Commander'],card:{oracleCard:{name:'Uurg'}}},{quantity:99,card:{oracleCard:{name:'Forest'}}}]};
  try {
    for(const failure of ['host','private','size','commander','resolution']) {
      const copy=structuredClone(payload); if(failure==='size') copy.cards[1]!.quantity=1; if(failure==='commander') copy.cards[0]!.categories=[];
      const source=new ArchidektDeckSource(async()=>({ok:failure!=='private',status:failure==='private'?403:200,json:async()=>copy}));
      const service=new DeckService(db.db,new FakeCardProvider(new Set(failure==='resolution'?['Forest']:[])),source);
      await assert.rejects(service.importArchidektDeck(failure==='host'?'https://evil.example/decks/123':'https://archidekt.com/decks/123'));
      assert.equal((await service.listDecks()).length,0);
    }
  } finally {db.close();}
});
