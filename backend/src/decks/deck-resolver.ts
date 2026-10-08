import type { ForgeDeckSpec } from "../forge/forge-protocol.js";
import { isArchidektDeckUrl } from "./archidekt-deck-source.js";

/** How a caller (CLI flag, web API body) named a deck. Shared by run-human-vs-asphodel.ts and the web playtest API so deck resolution exists in exactly one place. */
export type DeckInput =
  | { type: "fixture" }
  | { type: "library"; value: string; versionId?: string; projectId?: string }
  | { type: "archidekt"; value: string };

/** A bare id ("12") means the local Deck Library; an archidekt.com URL means a public Archidekt deck; nothing means the caller's fixture. */
export function parseDeckArg(value: string | undefined): DeckInput {
  if (!value) return { type: "fixture" };
  if (isArchidektDeckUrl(value)) return { type: "archidekt", value };
  return { type: "library", value };
}

export async function resolveDeckInput(input: DeckInput, fixture: ForgeDeckSpec): Promise<ForgeDeckSpec> {
  return (await resolvePlayedDeck(input,fixture)).deck;
}

export async function resolvePlayedDeck(input: DeckInput, fixture: ForgeDeckSpec,
  service?: Pick<import('./deck-service.js').DeckService,'getDeck'>,
): Promise<{ deck: ForgeDeckSpec; played: import('../../../shared/playtest-review.mjs').PlayedDeck }> {
  const {parsePlayedDeck} = await import('../../../shared/playtest-review.mjs');
  if (input.type === 'fixture') return {deck:structuredClone(fixture),played:parsePlayedDeck(fixture)};
  if (input.type === 'archidekt') {
    const {ArchidektDeckSource} = await import('./archidekt-deck-source.js');
    const deck = await new ArchidektDeckSource().fetchDeckSpec(input.value);
    return {deck,played:parsePlayedDeck(deck)};
  }
  const id = Number(input.value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Deck Library id must be a positive integer, got: ${input.value}`);
  const {ForgeDeckAdapter,ForgeDeckAdapterError} = await import('../forge/forge-deck-adapter.js');
  let database: import('../db/client.js').DatabaseConnection | undefined;
  try {
    if (!service) {
      const [{createDatabase},{ScryfallCardProvider},{DeckService}] = await Promise.all([
        import('../db/client.js'),import('../cards/scryfall-provider.js'),import('./deck-service.js'),
      ]);
      database = await createDatabase(); service = new DeckService(database.db,new ScryfallCardProvider());
    }
    // One read produces both the engine list and its historical identity.
    const saved = await service.getDeck(id);
    if (input.projectId && saved.project?.projectId !== input.projectId) throw new ForgeDeckAdapterError('INVALID_FORGE_DECK','Le projet a changé. Rouvre le deck depuis le builder.');
    const version = input.versionId ? saved.project?.versions?.find(v=>v.id===input.versionId) : undefined;
    if (input.versionId && !version) throw new ForgeDeckAdapterError('INVALID_FORGE_DECK','Cette version a été supprimée. Choisis une autre référence.');
    const list = version ? {id,name:version.state.name,cards:version.state.groups.flatMap(g=>g.entries.map(e=>({name:e.card.name,quantity:e.quantity,
      section:g.commander ? 'commander' as const : g.maybeboard ? 'maybeboard' as const : 'mainboard' as const})))} : saved;
    const deck = new ForgeDeckAdapter().toForgeDeckSpec(list);
    return {deck,played:parsePlayedDeck({...deck,...(saved.project ? {projectId:saved.project.projectId} : {}),
      ...(version ? {versionId:version.id,versionName:version.name} : {})})};
  } finally { database?.close(); }
}
