import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config";

const VERSION = "v1";

function key(): Buffer {
  const raw = Buffer.from(config.credentialsKey, "base64");
  if (raw.length !== 32) {
    throw new Error("AVEN_CREDENTIALS_KEY musi mieć 32 bajty w base64 (lokalnie uruchom: pnpm setup:env)");
  }
  return raw;
}

/**
 * Szyfruje hasło do skrzynki (AES-256-GCM). `context` (np. id skrzynki i użytkownika) jest wliczony w podpis,
 * więc szyfrogramu nie da się przenieść do innego wiersza bazy.
 */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(ciphertext: string, context: string): string {
  const [version, iv, tag, data] = ciphertext.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Nieznany format zaszyfrowanego hasła");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Skrót tokenu sesji: w bazie nie ma samych tokenów. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
