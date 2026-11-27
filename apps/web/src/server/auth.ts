import "server-only";
import type { Actor } from "@aven/db";
import { AuthError, AuthUnavailableError, bearerToken, type AuthContext } from "@monorise-team/auth";
import { createWebAuth, type Session, type WebAuth } from "@monorise-team/auth/next";
import { createLocalJWKSet } from "jose";
import { ApiFailure } from "./api";
import { config } from "./config";
import { sessionStore } from "./sessions";

let instance: WebAuth | undefined;

/**
 * Logowanie przez MonoriseCore (ADR-0095, ADR-0098): przeglądarka przez BFF z sesją w bazie AvenMail (ADR-0050),
 * aplikacje na komputer i telefon tokenem z Core w nagłówku Authorization. Tworzone przy pierwszym użyciu,
 * żeby build działał bez sekretów.
 */
export function getAuth(): WebAuth {
  instance ??= createWebAuth({
    issuer: config.coreAuthUrl,
    clientId: config.oauthClientId,
    clientSecret: config.oauthClientSecret || undefined,
    appUrl: config.appUrl,
    // Pierwsze API to AvenMail (tokeny sesji), drugie Core API (dane osoby i firmy).
    resources: [config.apiUrl, config.coreApiUrl],
    secret: config.sessionSecrets,
    store: sessionStore,
    keys: config.coreJwks ? createLocalJWKSet(JSON.parse(config.coreJwks) as { keys: [] }) : undefined,
  });
  return instance;
}

/** Resetuje leniwą instancję WebAuth (używane w testach przy zmianie adresu atrapy Core). */
export function resetAuthForTests(): void {
  instance = undefined;
}

/** Kto pyta: konto Monorise, pracownik i firma (zawsze z tokenu albo sesji Core, ADR-0037). */
export interface Caller extends Actor {
  /** Konto Monorise (to samo co userId); pole zostaje dla kluczy limitów i logów. */
  id: string;
  /** Konto Monorise (to samo co userId), spójnie z pozostałymi produktami Monorise. */
  accountId: string;
  employeeId: string;
  context: AuthContext;
  session: Session | null;
  /** Token z nagłówka Authorization, gdy pyta aplikacja na komputer albo telefon. */
  token: string | null;
}

/** Zalogowana osoba albo błąd UNAUTHENTICATED (401), PERMISSION_DENIED (403, CSRF) lub 503 przy awarii Core. */
export async function requireUser(request: Request): Promise<Caller> {
  try {
    const { context, session, via } = await getAuth().authenticate(request);
    return {
      id: context.accountId,
      userId: context.accountId,
      accountId: context.accountId,
      organizationId: context.organizationId,
      employeeId: context.employeeId,
      context,
      session,
      token: via === "bearer" ? bearerToken(request.headers.get("authorization")) : null,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw new ApiFailure(
        error.statusCode,
        error.code,
        error.code === "UNAUTHENTICATED" ? "Zaloguj się kontem Monorise" : "Żądanie spoza AvenMail",
      );
    }
    if (error instanceof AuthUnavailableError) {
      throw new ApiFailure(503, "INTERNAL_ERROR", "Logowanie Monorise jest chwilowo niedostępne");
    }
    throw error;
  }
}
