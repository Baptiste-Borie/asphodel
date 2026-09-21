export interface LabFace {
  name: string;
  image: string;
}
export interface LabPrinting {
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  lang: string;
  image: string;
  faces?: LabFace[] | undefined;
}
export interface LabCard {
  name: string;
  mana_cost: string | null;
  cmc: number;
  type_line: string;
  oracle_text: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  set_name: string;
  set: string;
  collector_number: string;
  rarity: string;
  lang: string;
  color_identity: string[];
  image: string;
  related: string[];
  commander_legal?: string;
  printings?: number;
  otherPrintings?: LabPrinting[];
  faces?: LabFace[] | undefined;
}
export interface LabSearchQuery {
  query?: string;
  name?: string;
  oracle?: string;
  types?: string[];
  sets?: string[];
  colors?: string;
  identity?: string;
  manaValue?: string;
  rarity?: string;
  language?: string;
  raw?: string;
  offset?: number;
  limit?: number;
}
export interface LabSearchResult {
  cards: LabCard[];
  total: number;
  nextOffset: number | null;
  catalogPrintings: number;
  snapshotDate: string;
}
export interface LabCatalog {
  sets: {value: string; label: string}[];
  types: string[];
  languages: string[];
  printings: number;
  snapshotDate: string;
}
