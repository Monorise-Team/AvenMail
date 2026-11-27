import "server-only";

const list = (value: string | undefined, fallback = "") =>
  (value ?? fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const parseEventFeedIntervalMs = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const trimmed = value.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(trimmed)) return 0;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : 0;
};

/** Ustawienia serwera ze zmiennych środowiskowych (lokalnie `.env.local`, tworzy go `pnpm setup:env`). */
export const config = {
  /** Klucz szyfrujący hasła do skrzynek: 32 bajty w base64. Docelowo z AWS KMS (ADR-0088). */
  get credentialsKey() {
    return process.env.AVEN_CREDENTIALS_KEY ?? "";
  },
  /** Serwery poczty w sieci prywatnej i bez szyfrowania: tylko lokalnie i w testach (GreenMail). */
  get allowPrivateMailHosts() {
    return process.env.AVEN_ALLOW_PRIVATE_MAIL_HOSTS === "1";
  },
  /** Baza aven_mail, rola aplikacji aven_mail_app (bez omijania RLS). */
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "";
  },
  /** Adresy aplikacji na komputer (Tauri) i środowisk lokalnych, które mogą wołać API z tokenem. */
  get allowedOrigins() {
    return list(process.env.AVEN_ALLOWED_ORIGINS, "tauri://localhost,http://tauri.localhost,http://127.0.0.1:1420");
  },

  // ── Logowanie przez MonoriseCore (ADR-0095) ────────────────────────────────────────────────────────
  /** Serwer logowania Core (wystawca tokenów), np. https://auth.monorise.studio. */
  get coreAuthUrl() {
    return process.env.CORE_AUTH_URL ?? "http://localhost:3100";
  },
  /** Core API, np. https://api.monorise.studio. */
  get coreApiUrl() {
    return process.env.CORE_API_URL ?? "http://localhost:3200";
  },
  /** Poczta w przeglądarce (BFF), np. https://aven-mail.monorise.studio. */
  get appUrl() {
    return process.env.AVEN_MAIL_URL ?? "http://aven-mail.localhost:3000";
  },
  /** API AvenMail, odbiorca tokenów z Core, np. https://aven.monorise.studio. */
  get apiUrl() {
    return process.env.AVEN_API_URL ?? "http://aven.localhost:3000";
  },
  get oauthClientId() {
    return process.env.AVEN_OAUTH_CLIENT_ID ?? "avenmail-web";
  },
  /** Sekret klienta z Core (lokalnie z `pnpm oauth:seed` w MonoriseCore). */
  get oauthClientSecret() {
    return process.env.AVEN_OAUTH_CLIENT_SECRET ?? "";
  },
  /** Sekret szyfrujący sesje (co najmniej 32 znaki); przy wymianie „nowy,stary”. */
  get sessionSecrets() {
    return list(process.env.AVEN_SESSION_SECRET);
  },
  /** Klucze publiczne Core wpisane na stałe (JWKS w JSON) zamiast pobierania z Core: testy. */
  get coreJwks() {
    return process.env.AVEN_CORE_JWKS ?? "";
  },
  /** Interwał odpytywania kanału zdarzeń Core w ms (0 wyłącza; domyślnie 5000 w development, 0 poza nim). */
  get eventFeedIntervalMs() {
    const fallback = process.env.NODE_ENV === "development" ? 5000 : 0;
    return parseEventFeedIntervalMs(process.env.AVEN_EVENT_FEED_INTERVAL_MS, fallback);
  },
};
