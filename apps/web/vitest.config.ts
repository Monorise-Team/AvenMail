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
    env: {
      AVEN_PGLITE_DIR: "memory://",
      AVEN_DEV_AUTH: "1",
      AVEN_ALLOW_PRIVATE_MAIL_HOSTS: "1",
      AVEN_CREDENTIALS_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    },
  },
});
