import "server-only";
import { createDb, type PrismaClient } from "@aven/db";
import { config } from "./config";

const globalForDb = globalThis as unknown as { avenDb?: PrismaClient };

/**
 * Baza aven_mail (PostgreSQL, ADR-0096). Serwer łączy się rolą aven_mail_app, więc skrzynki są dostępne
 * tylko przez withUser z @aven/db (RLS, ADR-0037). Jedna pula połączeń na proces, także po przeładowaniu
 * modułów w trybie deweloperskim.
 */
export function getDb(): PrismaClient {
  if (!config.databaseUrl) throw new Error("Brak DATABASE_URL (lokalnie: pnpm setup:env, pnpm db:up, pnpm db:migrate)");
  globalForDb.avenDb ??= createDb(config.databaseUrl);
  return globalForDb.avenDb;
}
