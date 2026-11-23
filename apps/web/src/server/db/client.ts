import "server-only";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzlePglite<typeof schema>>;

const MIGRATIONS = join(process.cwd(), "drizzle");

async function open(): Promise<Database> {
  if (config.databaseUrl) {
    // PostgreSQL (staging i produkcja: RDS); migracje przed wdrożeniem, lokalnie przy starcie
    const client = postgres(config.databaseUrl, { max: 5 });
    const db = drizzlePostgres(client, { schema });
    await migratePostgres(db, { migrationsFolder: MIGRATIONS });
    return db as unknown as Database;
  }
  // PGlite: PostgreSQL w procesie, bez instalowania bazy (lokalnie i w testach). Sam nie zakłada
  // katalogów nadrzędnych, więc tworzymy je wcześniej.
  if (!config.pgliteDir.includes("://")) mkdirSync(config.pgliteDir, { recursive: true });
  const client = new PGlite(config.pgliteDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db;
}

const globalForDb = globalThis as unknown as { avenDb?: Promise<Database> };

/** Jedno połączenie na proces (także po przeładowaniu modułów w trybie deweloperskim). */
export function getDb(): Promise<Database> {
  globalForDb.avenDb ??= open().catch((error: unknown) => {
    globalForDb.avenDb = undefined;
    throw error;
  });
  return globalForDb.avenDb;
}

export { schema };
