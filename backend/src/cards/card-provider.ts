export interface ResolvedCard {
  scryfallId: string;
  oracleId: string | null;
  name: string;
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  oracleText: string | null;
  colors: string[];
  colorIdentity: string[];
  imageUri: string | null;
}

export interface CardProvider {
  findByExactName(name: string): Promise<ResolvedCard | null>;
  /** Resolves one exact printing (e.g. from a "(DMU) 225" export line). Set code is case-insensitive; collector number is compared exactly as given. */
  findBySetAndCollector(setCode: string, collectorNumber: string): Promise<ResolvedCard | null>;
}
