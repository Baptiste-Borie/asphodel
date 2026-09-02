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
}
