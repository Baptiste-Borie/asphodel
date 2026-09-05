import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { CardProviderUnavailableError } from "../app-errors.js";
import type { CardProvider, ResolvedCard } from "./card-provider.js";

interface ScryfallFace {
  colors?: string[];
  image_uris?: { normal?: string };
  mana_cost?: string;
  oracle_text?: string;
  type_line?: string;
}

interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  image_uris?: { normal?: string };
  card_faces?: ScryfallFace[];
  /** Present on every Scryfall card object; only actually used by the printing (set+collector) index. */
  set?: string;
  collector_number?: string;
}

interface ScryfallBulkMetadata {
  jsonl_download_uri?: string;
}

export interface ScryfallCardProviderOptions {
  bulkPath?: string;
  /** Local path for the printing-level ("Default Cards") bulk file — only ever downloaded/read the first time a set+collector lookup is actually requested. */
  printingBulkPath?: string;
  fetch?: typeof globalThis.fetch;
  refreshIntervalMs?: number;
  userAgent?: string;
}

const backendRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultBulkPath = resolve(
  backendRoot,
  process.env.SCRYFALL_BULK_PATH ?? "data/scryfall-oracle-cards.jsonl.gz",
);
const defaultPrintingBulkPath = resolve(
  backendRoot,
  process.env.SCRYFALL_PRINTING_BULK_PATH ?? "data/scryfall-default-cards.jsonl.gz",
);
const defaultRefreshIntervalMs = 24 * 60 * 60 * 1_000;

function normalizeCardName(name: string): string {
  return name.trim().normalize("NFKC").toLowerCase();
}

/** Set codes are case-insensitive; collector numbers are kept exactly as printed ("225", "123a", "★12" are all valid and never coerced to a number). */
function printingKey(setCode: string, collectorNumber: string): string {
  return `${setCode.trim().toLowerCase()}/${collectorNumber.trim()}`;
}

function joinFaceValue(
  faces: ScryfallFace[] | undefined,
  key: "mana_cost" | "oracle_text" | "type_line",
  separator: string,
): string | null {
  const values = faces?.map((face) => face[key]).filter(Boolean) as
    | string[]
    | undefined;

  return values && values.length > 0 ? values.join(separator) : null;
}

function uniqueFaceColors(faces: ScryfallFace[] | undefined): string[] {
  return [...new Set(faces?.flatMap((face) => face.colors ?? []) ?? [])];
}

function resolveCard(card: ScryfallCard): ResolvedCard {
  const firstFaceImage = card.card_faces?.find(
    (face) => face.image_uris?.normal,
  )?.image_uris?.normal;

  return {
    scryfallId: card.id,
    oracleId: card.oracle_id ?? null,
    name: card.name,
    manaCost:
      card.mana_cost ?? joinFaceValue(card.card_faces, "mana_cost", " // "),
    manaValue: card.cmc,
    typeLine:
      card.type_line ||
      joinFaceValue(card.card_faces, "type_line", " // ") ||
      "Type inconnu",
    oracleText:
      card.oracle_text ??
      joinFaceValue(card.card_faces, "oracle_text", "\n//\n"),
    colors: card.colors ?? uniqueFaceColors(card.card_faces),
    colorIdentity: card.color_identity,
    imageUri: card.image_uris?.normal ?? firstFaceImage ?? null,
  };
}

async function forEachBulkCard(
  path: string,
  visit: (card: ScryfallCard) => void,
): Promise<void> {
  const lines = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (line.trim()) visit(JSON.parse(line) as ScryfallCard);
  }
}

/**
 * Backed by two independent local bulk sources, each fetched/parsed lazily and only once actually
 * needed:
 *  - "oracle-cards" (one representative printing per oracle card) powers `findByExactName` — this
 *    is unchanged from before this printing-aware lookup existed.
 *  - "default_cards" (every real printing, correctly carrying `set`/`collector_number`) powers
 *    `findBySetAndCollector`. "oracle-cards" alone cannot answer a printing-specific lookup
 *    reliably — it only ever exposes the one printing Scryfall picked as representative for that
 *    oracle card, which is frequently NOT the printing a decklist actually names.
 * Neither index issues one network request per card: each is one bulk file fetch, cached on disk
 * like the original oracle-cards file, and parsed into one in-memory Map.
 */
export class ScryfallCardProvider implements CardProvider {
  private readonly bulkPath: string;
  private readonly printingBulkPath: string;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly refreshIntervalMs: number;
  private readonly userAgent: string;
  private indexPromise: Promise<Map<string, ResolvedCard>> | undefined;
  private printingIndexPromise: Promise<Map<string, ResolvedCard>> | undefined;

  constructor(options: ScryfallCardProviderOptions = {}) {
    this.bulkPath = options.bulkPath ?? defaultBulkPath;
    this.printingBulkPath = options.printingBulkPath ?? defaultPrintingBulkPath;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.refreshIntervalMs =
      options.refreshIntervalMs ?? defaultRefreshIntervalMs;
    this.userAgent =
      options.userAgent ?? process.env.SCRYFALL_USER_AGENT ?? "Asphodel/0.1";
  }

  async findByExactName(name: string): Promise<ResolvedCard | null> {
    this.indexPromise ??= this.loadIndex();
    const index = await this.indexPromise;
    return index.get(normalizeCardName(name)) ?? null;
  }

  async findBySetAndCollector(setCode: string, collectorNumber: string): Promise<ResolvedCard | null> {
    this.printingIndexPromise ??= this.loadPrintingIndex();
    const index = await this.printingIndexPromise;
    return index.get(printingKey(setCode, collectorNumber)) ?? null;
  }

  private async loadIndex(): Promise<Map<string, ResolvedCard>> {
    await this.ensureBulkFile(this.bulkPath, "oracle-cards");

    const index = new Map<string, ResolvedCard>();
    try {
      await forEachBulkCard(this.bulkPath, (card) => {
        if (card.name && card.id) {
          index.set(normalizeCardName(card.name), resolveCard(card));
        }
      });
    } catch {
      throw new CardProviderUnavailableError(
        "Le catalogue bulk Scryfall local est illisible.",
      );
    }

    return index;
  }

  private async loadPrintingIndex(): Promise<Map<string, ResolvedCard>> {
    await this.ensureBulkFile(this.printingBulkPath, "default_cards");

    const index = new Map<string, ResolvedCard>();
    try {
      await forEachBulkCard(this.printingBulkPath, (card) => {
        if (card.id && card.set && card.collector_number) {
          index.set(printingKey(card.set, card.collector_number), resolveCard(card));
        }
      });
    } catch {
      throw new CardProviderUnavailableError(
        "Le catalogue bulk Scryfall (impressions) local est illisible.",
      );
    }

    return index;
  }

  private async ensureBulkFile(path: string, bulkType: string): Promise<void> {
    const existingFile = await stat(path).catch(() => null);
    const isFresh =
      existingFile &&
      Date.now() - existingFile.mtimeMs < this.refreshIntervalMs;

    if (isFresh) return;

    try {
      await this.downloadBulkFile(path, bulkType);
    } catch (error) {
      if (existingFile) return;
      if (error instanceof CardProviderUnavailableError) throw error;
      throw new CardProviderUnavailableError(
        "Impossible de télécharger le catalogue bulk Scryfall.",
      );
    }
  }

  private async downloadBulkFile(path: string, bulkType: string): Promise<void> {
    const headers = {
      Accept: "application/json;q=0.9,*/*;q=0.8",
      "User-Agent": this.userAgent,
    };

    const metadataResponse = await this.fetchImplementation(
      `https://api.scryfall.com/bulk-data/${bulkType}`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );
    if (!metadataResponse.ok) {
      throw new CardProviderUnavailableError(
        `Scryfall a répondu avec le statut ${metadataResponse.status}.`,
      );
    }

    const metadata = (await metadataResponse.json()) as ScryfallBulkMetadata;
    if (!metadata.jsonl_download_uri) {
      throw new CardProviderUnavailableError(
        "Scryfall n'a pas fourni l'adresse du catalogue bulk JSONL.",
      );
    }

    const downloadResponse = await this.fetchImplementation(
      metadata.jsonl_download_uri,
      { headers, signal: AbortSignal.timeout(5 * 60_000) },
    );
    if (!downloadResponse.ok || !downloadResponse.body) {
      throw new CardProviderUnavailableError(
        `Le téléchargement bulk Scryfall a échoué (${downloadResponse.status}).`,
      );
    }

    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;

    try {
      await pipeline(
        Readable.from(downloadResponse.body),
        createWriteStream(temporaryPath),
      );
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
