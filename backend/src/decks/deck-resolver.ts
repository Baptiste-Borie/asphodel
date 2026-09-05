import type { ForgeDeckSpec } from "../forge/forge-protocol.js";
import { isArchidektDeckUrl } from "./archidekt-deck-source.js";

/** How a caller (CLI flag, web API body) named a deck. Shared by run-human-vs-asphodel.ts and the web playtest API so deck resolution exists in exactly one place. */
export type DeckInput =
  | { type: "fixture" }
  | { type: "library"; value: string }
  | { type: "archidekt"; value: string };

/** A bare id ("12") means the local Deck Library; an archidekt.com URL means a public Archidekt deck; nothing means the caller's fixture. */
export function parseDeckArg(value: string | undefined): DeckInput {
  if (!value) return { type: "fixture" };
  if (isArchidektDeckUrl(value)) return { type: "archidekt", value };
  return { type: "library", value };
}

export async function resolveDeckInput(input: DeckInput, fixture: ForgeDeckSpec): Promise<ForgeDeckSpec> {
  if (input.type === "fixture") return fixture;
  if (input.type === "archidekt") {
    const { ArchidektDeckSource } = await import("./archidekt-deck-source.js");
    return new ArchidektDeckSource().fetchDeckSpec(input.value);
  }
  const id = Number(input.value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error(`Deck Library id must be a positive integer, got: ${input.value}`);
  }
  // Loaded lazily: the Deck Library needs a local sqlite database the fixture/Archidekt paths do not.
  const [{ createDatabase }, { ScryfallCardProvider }, { DeckService }, { ForgeDeckAdapter }] = await Promise.all([
    import("../db/client.js"), import("../cards/scryfall-provider.js"), import("./deck-service.js"), import("../forge/forge-deck-adapter.js"),
  ]);
  const database = await createDatabase();
  try {
    const deckService = new DeckService(database.db, new ScryfallCardProvider());
    return new ForgeDeckAdapter().toForgeDeckSpec(await deckService.getDeck(id));
  } finally {
    database.close();
  }
}
