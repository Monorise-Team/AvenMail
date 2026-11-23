import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Moduły tylko dla serwera: w testach nie ma podziału na klienta i serwer
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Klucz „Core” do podpisywania tokenów w testach (AVEN_CORE_JWKS)
    setupFiles: ["./test/setup.ts"],
    env: {
      // Prawdziwy PostgreSQL (pnpm db:up && pnpm db:migrate albo usługa w CI), rola aplikacji z RLS
      DATABASE_URL:
        process.env.AVEN_TEST_APP_DATABASE_URL ??
        "postgresql://aven_mail_app:aven_mail_app@localhost:5434/aven_mail_test",
      AVEN_ALLOW_PRIVATE_MAIL_HOSTS: "1",
      AVEN_CREDENTIALS_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      AVEN_SESSION_SECRET: "sekret-sesji-tylko-do-testow-ma-ponad-32-znaki",
      AVEN_OAUTH_CLIENT_SECRET: "sekret-klienta-tylko-do-testow",
    },
  },
});
