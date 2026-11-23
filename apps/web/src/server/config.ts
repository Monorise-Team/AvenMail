import "server-only";

/** Ustawienia serwera ze zmiennych środowiskowych (lokalnie `.env.local`, tworzy go `pnpm setup:env`). */
export const config = {
  /** Klucz szyfrujący hasła do skrzynek: 32 bajty w base64. Docelowo z AWS KMS (ADR-0088). */
  credentialsKey: process.env.AVEN_CREDENTIALS_KEY ?? "",
  /** Logowanie deweloperskie bez Core; nigdy na produkcji (ADR-0090). */
  devAuth: process.env.AVEN_DEV_AUTH === "1",
  /** Serwery poczty w sieci prywatnej i bez szyfrowania: tylko lokalnie i w testach (GreenMail). */
  allowPrivateMailHosts: process.env.AVEN_ALLOW_PRIVATE_MAIL_HOSTS === "1",
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** Katalog bazy PGlite, gdy nie ma DATABASE_URL; `memory://` w testach. */
  pgliteDir: process.env.AVEN_PGLITE_DIR ?? ".data/pglite",
  /** Adresy aplikacji na komputer (Tauri) i środowisk lokalnych, które mogą wołać API z tokenem. */
  allowedOrigins: (process.env.AVEN_ALLOWED_ORIGINS ?? "tauri://localhost,http://tauri.localhost,http://127.0.0.1:1420")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  secureCookies: process.env.NODE_ENV === "production",
};
