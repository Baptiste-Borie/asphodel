/** Read-only facts from the installed catalog; never a replacement for chosen art. */
export interface CommanderFacts {
  requestedName: string; name: string; oracleId: string;
  typeLine: string; oracleText: string | null; colorIdentity: string[];
  commanderLegal?: string; power: string | null; toughness: string | null;
  /** Optional for compatibility with old catalog responses. Null means unavailable. */
  manaCost?: string | null;
}
export interface CommanderCatalogResult {
  cards: CommanderFacts[]; missing: string[]; snapshotDate: string; catalogPrintings: number;
}
export const commanderName = (name: string) => name.normalize('NFKC').trim().toLowerCase();
