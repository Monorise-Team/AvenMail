#!/usr/bin/env node
/**
 * Tworzy apps/web/.env.local do pracy lokalnej: losowy klucz szyfrujący hasła do skrzynek, logowanie
 * deweloperskie i zgoda na lokalny serwer poczty (GreenMail). Istniejącego pliku nie nadpisuje.
 */
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const file = join(import.meta.dirname, "../apps/web/.env.local");
if (existsSync(file)) {
  console.log("apps/web/.env.local już istnieje, zostawiam go bez zmian.");
  process.exit(0);
}
writeFileSync(
  file,
  [
    "# Tylko lokalnie. Nigdy nie commituj tego pliku.",
    `AVEN_CREDENTIALS_KEY=${randomBytes(32).toString("base64")}`,
    "AVEN_DEV_AUTH=1",
    "AVEN_ALLOW_PRIVATE_MAIL_HOSTS=1",
    "AVEN_MAIL_URL=http://aven-mail.localhost:3000",
    "",
  ].join("\n"),
  { mode: 0o600 },
);
console.log("Zapisano apps/web/.env.local (klucz szyfrujący, logowanie deweloperskie).");
