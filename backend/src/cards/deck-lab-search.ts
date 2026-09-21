import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { AppError } from '../app-errors.js';
import { compileLabQuery } from './deck-lab-query.js';
import type { LabCard, LabCatalog, LabSearchQuery, LabSearchResult } from '../../../shared/deck-lab.js';

interface BulkFace { name?: string; mana_cost?: string; oracle_text?: string; image_uris?: {normal?: string}; colors?: string[] }
interface BulkCard {
  id: string; oracle_id?: string; name: string; mana_cost?: string; cmc?: number; type_line?: string;
  oracle_text?: string; power?: string; toughness?: string; loyalty?: string;
  set_name: string; set: string; collector_number: string; rarity: string; lang: string;
  colors?: string[]; color_identity?: string[]; image_uris?: {normal?: string};
  card_faces?: BulkFace[]; all_parts?: {name: string}[]; legalities?: {commander?: string};
}
const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
const normalize = (value: string) => value.normalize('NFKC').toLowerCase();
const SCHEMA_VERSION = '1';

/** Derived read-only search catalog, separate from the user's deck database. */
export class DeckLabSearch {
  private database: DatabaseSync | undefined;
  private loading: Promise<void> | undefined;
  private catalog: LabCatalog | undefined;
  constructor(private readonly options: {bulkPath?: string; indexPath?: string} = {}) {}

  private async ensureReady(): Promise<void> {
    if (!this.loading) this.loading = this.load().catch(error => { this.database?.close(); this.database = undefined; this.loading = undefined; throw error; });
    await this.loading;
  }
  private async load() {
    const bulkPath = this.options.bulkPath ?? resolve(backendRoot,process.env.SCRYFALL_PRINTING_BULK_PATH ?? 'data/scryfall-default-cards.jsonl.gz');
    const source = await stat(bulkPath).catch(() => { throw new AppError('The local Scryfall Default Cards snapshot is unavailable. Restore the bulk file before searching.',503,'CARD_CATALOG_UNAVAILABLE'); });
    const indexPath = this.options.indexPath ?? resolve(backendRoot,'data/deck-lab-search.sqlite');
    if (indexPath !== ':memory:') await mkdir(dirname(indexPath),{recursive:true});
    const db = this.database = new DatabaseSync(indexPath);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const fingerprint = `${SCHEMA_VERSION}:${bulkPath}:${source.size}:${source.mtimeMs}`;
    const existing = db.prepare("SELECT value FROM metadata WHERE key='fingerprint'").get() as {value:string} | undefined;
    if (existing?.value === fingerprint) {
      this.catalog = JSON.parse((db.prepare("SELECT value FROM metadata WHERE key='catalog'").get() as {value:string}).value) as LabCatalog;
      return;
    }
    db.exec(`BEGIN; DROP TABLE IF EXISTS cards; CREATE TABLE cards (
      id TEXT PRIMARY KEY, oracle_id TEXT NOT NULL, name_search TEXT NOT NULL, oracle_search TEXT NOT NULL,
      type_search TEXT NOT NULL, set_code TEXT NOT NULL, rarity TEXT NOT NULL, language TEXT NOT NULL,
      colors TEXT NOT NULL, identity TEXT NOT NULL, cmc REAL NOT NULL, commander TEXT NOT NULL, payload TEXT NOT NULL
    )`);
    const insert = db.prepare('INSERT OR REPLACE INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const sets = new Map<string,string>(); const types = new Set<string>(); const languages = new Set<string>();
    let printings = 0;
    const stream = createReadStream(bulkPath);
    const unzip = createGunzip();
    stream.on('error', error => unzip.destroy(error));
    const lines = createInterface({input:stream.pipe(unzip),crlfDelay:Infinity});
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const card = JSON.parse(line) as BulkCard;
        const faces = card.card_faces ?? [];
        const oracle = card.oracle_text ?? faces.map(f=>[f.name,f.oracle_text].filter(Boolean).join('\n')).join('\n\n');
        const payload: LabCard = {
          name:card.name,mana_cost:card.mana_cost ?? (faces.map(f=>f.mana_cost).filter(Boolean).join(' // ') || null),
          cmc:card.cmc ?? 0,type_line:card.type_line ?? '',oracle_text:oracle || null,
          power:card.power ?? null,toughness:card.toughness ?? null,loyalty:card.loyalty ?? null,
          set_name:card.set_name,set:card.set,collector_number:card.collector_number,rarity:card.rarity,
          lang:card.lang,color_identity:card.color_identity ?? [],image:card.image_uris?.normal ?? faces[0]?.image_uris?.normal ?? '',
          related:[...new Set([...(card.all_parts ?? []).map(p=>p.name),...faces.map(f=>f.name ?? '')])].filter(n=>n && n!==card.name),
          commander_legal:card.legalities?.commander ?? 'not_legal',
        };
        insert.run(card.id,card.oracle_id ?? card.id,normalize(card.name),normalize(oracle),normalize(card.type_line ?? ''),card.set,card.rarity,card.lang,
          (card.colors ?? faces.flatMap(f=>f.colors ?? [])).join('').toLowerCase(),(card.color_identity ?? []).join('').toLowerCase(),card.cmc ?? 0,payload.commander_legal!,JSON.stringify(payload));
        sets.set(card.set,card.set_name); languages.add(card.lang);
        for (const word of (card.type_line ?? '').replace(/—|\/\//g,' ').split(/\s+/)) if (word) types.add(word);
        printings++;
        if (printings % 1000 === 0) await setImmediate();
      }
      db.exec('CREATE INDEX cards_set ON cards(set_code); CREATE INDEX cards_oracle ON cards(oracle_id); CREATE INDEX cards_name ON cards(name_search);');
      this.catalog = {sets:[...sets].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label)),types:[...types].sort(),languages:[...languages].sort(),printings,snapshotDate:source.mtime.toISOString()};
      const meta = db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)');
      meta.run('catalog',JSON.stringify(this.catalog)); meta.run('fingerprint',fingerprint);
      db.exec('COMMIT');
      db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { lines.close(); stream.destroy(); unzip.destroy(); }
  }
  async getCatalog(): Promise<LabCatalog> { await this.ensureReady(); return this.catalog!; }
  async search(query: LabSearchQuery): Promise<LabSearchResult> {
    const filter = compileLabQuery(query);
    await this.ensureReady();
    const db = this.database!;
    const offset = query.offset ?? 0; const limit = query.limit ?? 60;
    // Filter printings first, then deduplicate. A chosen set can never disappear
    // because an unrelated printing happened to be the oracle's representative.
    const from = query.unique === 'prints' ? `SELECT id FROM cards WHERE ${filter.sql}` : `SELECT MIN(id) AS id FROM cards WHERE ${filter.sql} GROUP BY oracle_id`;
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM (${from})`).get(...filter.values) as {count:number}).count;
    const rows = db.prepare(`SELECT payload FROM cards WHERE id IN (${from}) ORDER BY name_search, id LIMIT ? OFFSET ?`).all(...filter.values,limit,offset) as {payload:string}[];
    return {cards:rows.map(r=>JSON.parse(r.payload) as LabCard),total,nextOffset:offset+rows.length<total ? offset+rows.length : null,catalogPrintings:this.catalog!.printings,snapshotDate:this.catalog!.snapshotDate};
  }
  async close() { try { await this.loading; } finally { this.database?.close(); this.database=undefined; this.loading=undefined; } }
}
