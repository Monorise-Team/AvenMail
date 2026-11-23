#!/usr/bin/env node
/**
 * Ustawienia do pracy lokalnej:
 * - apps/web/.env.local: klucz szyfrujący hasła do skrzynek, sekret sesji, baza (rola aplikacji), adresy
 *   MonoriseCore i sekret klienta avenmail-web z Core (z pliku, który zapisuje `pnpm oauth:seed` w MonoriseCore),
 * - packages/db/.env: baza dla migracji (właściciel tabel).
 * Istniejących wartości nie zmienia: dopisuje tylko brakujące.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const coreSecretsFile =
  process.env.CORE_OAUTH_SECRETS_FILE ?? join(root, "../MonoriseCore/apps/auth/.data/oauth-clients.json");
const coreSecret = existsSync(coreSecretsFile)
  ? (JSON.parse(readFileSync(coreSecretsFile, "utf8"))["avenmail-web"] ?? "")
  : "";

function ensure(file, header, values) {
  const path = join(root, file);
  const current = existsSync(path) ? readFileSync(path, "utf8") : `${header}\n`;
  const present = new Set(current.split("\n").map((line) => line.split("=")[0]?.trim()));
  const added = Object.entries(values).filter(([key]) => !present.has(key));
  if (added.length) {
    const text = `${current.replace(/\n*$/, "\n")}${added.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
    writeFileSync(path, text, { mode: 0o600 });
  }
  console.log(added.length ? `${file}: dopisano ${added.map(([key]) => key).join(", ")}` : `${file}: bez zmian`);
  for (const old of ["AVEN_DEV_AUTH", "AVEN_PGLITE_DIR"]) {
    if (present.has(old)) console.log(`${file}: ${old} nie jest już używane, możesz je usunąć`);
  }
  return path;
}

ensure("apps/web/.env.local", "# Tylko lokalnie. Nigdy nie commituj tego pliku.", {
  AVEN_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  AVEN_SESSION_SECRET: randomBytes(32).toString("base64url"),
  AVEN_ALLOW_PRIVATE_MAIL_HOSTS: "1",
  AVEN_MAIL_URL: "http://aven-mail.localhost:3000",
  AVEN_API_URL: "http://aven.localhost:3000",
  DATABASE_URL: "postgresql://aven_mail_app:aven_mail_app@localhost:5434/aven_mail",
  CORE_AUTH_URL: "http://localhost:3100",
  CORE_API_URL: "http://localhost:3200",
  AVEN_OAUTH_CLIENT_ID: "avenmail-web",
  AVEN_OAUTH_CLIENT_SECRET: coreSecret,
});
ensure("packages/db/.env", "# Tylko lokalnie: właściciel tabel, do migracji.", {
  DATABASE_URL: "postgresql://aven_mail_owner:aven_mail_owner@localhost:5434/aven_mail",
});
if (!coreSecret) {
  console.log(
    "Brak sekretu klienta avenmail-web: uruchom `pnpm oauth:seed` w MonoriseCore, potem jeszcze raz `pnpm setup:env`\n" +
      "(albo usuń pusty wpis AVEN_OAUTH_CLIENT_SECRET z apps/web/.env.local, żeby skrypt mógł go dopisać).",
  );
}
