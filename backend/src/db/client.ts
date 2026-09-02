import "dotenv/config";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const backendRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultDatabasePath = resolve(backendRoot, "data/asphodel.sqlite");
const migrationsFolder = resolve(backendRoot, "drizzle");

export type AsphodelDatabase = LibSQLDatabase<typeof schema>;

export interface DatabaseConnection {
  client: Client;
  db: AsphodelDatabase;
  close: () => void;
}

function ensureDatabaseDirectory(url: string): void {
  if (!url.startsWith("file:") || url === "file::memory:") return;

  const fileName = url.slice("file:".length).split("?")[0];
  if (!fileName) return;

  mkdirSync(dirname(resolve(backendRoot, fileName)), { recursive: true });
}

export async function createDatabase(
  url = process.env.DB_FILE_NAME ?? `file:${defaultDatabasePath}`,
): Promise<DatabaseConnection> {
  ensureDatabaseDirectory(url);

  const client = createClient({ url });
  const db = drizzle(client, { schema });

  await client.execute("PRAGMA foreign_keys = ON");
  await migrate(db, { migrationsFolder });

  return {
    client,
    db,
    close: () => client.close(),
  };
}
