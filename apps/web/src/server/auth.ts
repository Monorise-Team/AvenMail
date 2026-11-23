import "server-only";
import { randomBytes } from "node:crypto";
import type { Session, User } from "@aven/contracts";
import { and, eq, gt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { ApiFailure, type CookieJar } from "./api";
import { config } from "./config";
import { hashToken } from "./crypto";
import { getDb, schema } from "./db/client";
import { uuidv7 } from "./ids";

export const SESSION_COOKIE = "aven_session";
const DAY = 24 * 60 * 60 * 1000;
const LIFETIME = { web: 30 * DAY, app: 90 * DAY } as const;

function tokenFrom(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  return request.cookies.get(SESSION_COOKIE)?.value ?? null;
}

/** Zalogowany użytkownik albo błąd UNAUTHENTICATED. */
export async function requireUser(request: NextRequest): Promise<User> {
  const token = tokenFrom(request);
  if (!token) throw new ApiFailure(401, "UNAUTHENTICATED", "Brak sesji");
  const db = await getDb();
  const [row] = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) throw new ApiFailure(401, "UNAUTHENTICATED", "Sesja wygasła albo nie istnieje");
  return row;
}

/**
 * Logowanie deweloperskie (ADR-0090): tylko z AVEN_DEV_AUTH=1, dopóki nie ma logowania przez Core.
 * Przeglądarka dostaje ciasteczko niedostępne dla skryptów, aplikacje token.
 */
export async function devSignIn(
  input: { email: string; name: string; app: boolean },
  cookies: CookieJar,
): Promise<Session> {
  if (!config.devAuth) throw new ApiFailure(403, "PERMISSION_DENIED", "Logowanie deweloperskie jest wyłączone");
  const db = await getDb();
  const email = input.email.toLowerCase();
  await db
    .insert(schema.users)
    .values({ id: uuidv7(), email, name: input.name })
    .onConflictDoUpdate({ target: schema.users.email, set: { name: input.name } });
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) throw new ApiFailure(500, "INTERNAL", "Nie udało się zapisać użytkownika");

  const kind = input.app ? "app" : "web";
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LIFETIME[kind]);
  await db
    .insert(schema.sessions)
    .values({ id: uuidv7(), userId: user.id, tokenHash: hashToken(token), kind, expiresAt });

  if (kind === "web") {
    cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  }
  return {
    user: { id: user.id, email: user.email, name: user.name },
    token: kind === "app" ? token : null,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function signOut(request: NextRequest, cookies: CookieJar): Promise<void> {
  const token = tokenFrom(request);
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
  }
  cookies.delete(SESSION_COOKIE);
}
