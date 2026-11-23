import "server-only";
import type { MailAccount, MailAccountInput } from "@aven/contracts";
import { verifyMailbox, type HostPolicy, type MailboxConfig } from "@aven/mail-engine";
import { and, asc, eq } from "drizzle-orm";
import { ApiFailure } from "./api";
import { config } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb, schema } from "./db/client";
import { uuidv7 } from "./ids";

/** Polityka połączeń: na produkcji tylko publiczne serwery i szyfrowanie; lokalnie także GreenMail. */
export const policy = (): HostPolicy => ({
  allowPrivateHosts: config.allowPrivateMailHosts,
  allowInsecure: config.allowPrivateMailHosts,
});

const passwordContext = (userId: string, accountId: string) => `mail_accounts:${accountId}:${userId}`;

type Row = typeof schema.mailAccounts.$inferSelect;

function toAccount(row: Row): MailAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    username: row.username,
    imap: { host: row.imapHost, port: row.imapPort, security: row.imapSecurity },
    smtp: { host: row.smtpHost, port: row.smtpPort, security: row.smtpSecurity },
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAccounts(userId: string): Promise<MailAccount[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.mailAccounts)
    .where(eq(schema.mailAccounts.userId, userId))
    .orderBy(asc(schema.mailAccounts.createdAt));
  return rows.map(toAccount);
}

const toConfig = (input: MailAccountInput): MailboxConfig => ({
  email: input.email,
  displayName: input.displayName ?? null,
  username: input.username ?? null,
  password: input.password,
  imap: input.imap,
  smtp: input.smtp,
});

/** Sprawdza logowanie do IMAP i SMTP bez zapisywania czegokolwiek. */
export async function testAccount(input: MailAccountInput): Promise<void> {
  await verifyMailbox(toConfig(input), policy());
}

/** Zapisuje skrzynkę po udanym połączeniu; hasło szyfruje, nigdy go nie zwraca. */
export async function createAccount(userId: string, input: MailAccountInput): Promise<MailAccount> {
  await verifyMailbox(toConfig(input), policy());
  const db = await getDb();
  const email = input.email.toLowerCase();
  const [existing] = await db
    .select({ id: schema.mailAccounts.id })
    .from(schema.mailAccounts)
    .where(and(eq(schema.mailAccounts.userId, userId), eq(schema.mailAccounts.email, email)))
    .limit(1);
  const id = existing?.id ?? uuidv7();
  const values = {
    id,
    userId,
    email,
    displayName: input.displayName || null,
    username: input.username || null,
    imapHost: input.imap.host.toLowerCase(),
    imapPort: input.imap.port,
    imapSecurity: input.imap.security,
    smtpHost: input.smtp.host.toLowerCase(),
    smtpPort: input.smtp.port,
    smtpSecurity: input.smtp.security,
    passwordCiphertext: encryptSecret(input.password, passwordContext(userId, id)),
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(schema.mailAccounts)
    .values(values)
    .onConflictDoUpdate({ target: schema.mailAccounts.id, set: values })
    .returning();
  return toAccount(row!);
}

export async function deleteAccount(userId: string, accountId: string): Promise<void> {
  const db = await getDb();
  const deleted = await db
    .delete(schema.mailAccounts)
    .where(and(eq(schema.mailAccounts.id, accountId), eq(schema.mailAccounts.userId, userId)))
    .returning({ id: schema.mailAccounts.id });
  if (!deleted.length) throw new ApiFailure(404, "NOT_FOUND", "Nie ma takiej skrzynki");
}

/** Konfiguracja połączenia skrzynki należącej do użytkownika, z odszyfrowanym hasłem (tylko w pamięci). */
export async function mailboxConfig(userId: string, accountId: string): Promise<MailboxConfig> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.mailAccounts)
    .where(and(eq(schema.mailAccounts.id, accountId), eq(schema.mailAccounts.userId, userId)))
    .limit(1);
  if (!row) throw new ApiFailure(404, "NOT_FOUND", "Nie ma takiej skrzynki");
  const account = toAccount(row);
  return {
    email: account.email,
    displayName: account.displayName,
    username: account.username,
    password: decryptSecret(row.passwordCiphertext, passwordContext(userId, row.id)),
    imap: account.imap,
    smtp: account.smtp,
  };
}
