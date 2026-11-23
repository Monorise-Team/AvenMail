import "server-only";

const list = (value: string | undefined, fallback = "") =>
  (value ?? fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Ustawienia serwera ze zmiennych środowiskowych (lokalnie `.env.local`, tworzy go `pnpm setup:env`). */
export const config = {
  /** Klucz szyfrujący hasła do skrzynek: 32 bajty w base64. Docelowo z AWS KMS (ADR-0088). */
  credentialsKey: process.env.AVEN_CREDENTIALS_KEY ?? "",
  /** Serwery poczty w sieci prywatnej i bez szyfrowania: tylko lokalnie i w testach (GreenMail). */
  allowPrivateMailHosts: process.env.AVEN_ALLOW_PRIVATE_MAIL_HOSTS === "1",
  /** Baza aven_mail, rola aplikacji aven_mail_app (bez omijania RLS). */
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** Adresy aplikacji na komputer (Tauri) i środowisk lokalnych, które mogą wołać API z tokenem. */
  allowedOrigins: list(
    process.env.AVEN_ALLOWED_ORIGINS,
    "tauri://localhost,http://tauri.localhost,http://127.0.0.1:1420",
  ),

  // ── Logowanie przez MonoriseCore (ADR-0095) ────────────────────────────────────────────────────────
  /** Serwer logowania Core (wystawca tokenów), np. https://auth.monorise.studio. */
  coreAuthUrl: process.env.CORE_AUTH_URL ?? "http://localhost:3100",
  /** Core API, np. https://api.monorise.studio. */
  coreApiUrl: process.env.CORE_API_URL ?? "http://localhost:3200",
  /** Poczta w przeglądarce (BFF), np. https://aven-mail.monorise.studio. */
  appUrl: process.env.AVEN_MAIL_URL ?? "http://aven-mail.localhost:3000",
  /** API AvenMail, odbiorca tokenów z Core, np. https://aven.monorise.studio. */
  apiUrl: process.env.AVEN_API_URL ?? "http://aven.localhost:3000",
  oauthClientId: process.env.AVEN_OAUTH_CLIENT_ID ?? "avenmail-web",
  /** Sekret klienta z Core (lokalnie z `pnpm oauth:seed` w MonoriseCore). */
  oauthClientSecret: process.env.AVEN_OAUTH_CLIENT_SECRET ?? "",
  /** Sekret szyfrujący sesje (co najmniej 32 znaki); przy wymianie „nowy,stary”. */
  sessionSecrets: list(process.env.AVEN_SESSION_SECRET),
  /** Klucze publiczne Core wpisane na stałe (JWKS w JSON) zamiast pobierania z Core: testy. */
  coreJwks: process.env.AVEN_CORE_JWKS ?? "",
};
