import "server-only";
import type { MailAccount, MailAccountInput } from "@aven/contracts";
import { uuidv7, withUser, type Actor, type MailAccountModel as MailAccountRow } from "@aven/db";
import { verifyMailbox, type HostPolicy, type MailboxConfig } from "@aven/mail-engine";
import { ApiFailure } from "./api";
import { config } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb } from "./db";

/** Polityka połączeń: na produkcji tylko publiczne serwery i szyfrowanie; lokalnie także GreenMail. */
export const policy = (): HostPolicy => ({
  allowPrivateHosts: config.allowPrivateMailHosts,
  allowInsecure: config.allowPrivateMailHosts,
});

/** Hasło jest związane ze skrzynką i jej właścicielem (konto Monorise), więc nie da się go przenieść. */
const passwordContext = (userId: string, mailboxId: string) => `mail_accounts:${mailboxId}:${userId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identyfikator z adresu: inny niż UUID to po prostu brak skrzynki, a nie błąd bazy. */
function assertMailboxId(mailboxId: string): void {
  if (!UUID.test(mailboxId)) throw new ApiFailure(404, "NOT_FOUND", "Nie ma takiej skrzynki");
}

function toAccount(row: MailAccountRow): MailAccount {
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

/** Skrzynki osoby. RLS w bazie i tak nie pokaże cudzych (ADR-0037). */
export async function listAccounts(actor: Actor): Promise<MailAccount[]> {
  const rows = await withUser(getDb(), actor, (tx) => tx.mailAccount.findMany({ orderBy: { createdAt: "asc" } }));
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
export async function createAccount(actor: Actor, input: MailAccountInput): Promise<MailAccount> {
  // Połączenie z serwerem poczty trwa, więc odbywa się przed transakcją w bazie.
  await verifyMailbox(toConfig(input), policy());
  const email = input.email.toLowerCase();
  const row = await withUser(getDb(), actor, async (tx) => {
    const existing = await tx.mailAccount.findFirst({ where: { email }, select: { id: true } });
    const id = existing?.id ?? uuidv7();
    const values = {
      email,
      displayName: input.displayName || null,
      username: input.username || null,
      imapHost: input.imap.host.toLowerCase(),
      imapPort: input.imap.port,
      imapSecurity: input.imap.security,
      smtpHost: input.smtp.host.toLowerCase(),
      smtpPort: input.smtp.port,
      smtpSecurity: input.smtp.security,
      passwordCiphertext: encryptSecret(input.password, passwordContext(actor.userId, id)),
    };
    return tx.mailAccount.upsert({
      where: { id },
      create: { id, organizationId: actor.organizationId, userId: actor.userId, ...values },
      update: values,
    });
  });
  return toAccount(row);
}

export async function deleteAccount(actor: Actor, mailboxId: string): Promise<void> {
  assertMailboxId(mailboxId);
  const deleted = await withUser(getDb(), actor, (tx) => tx.mailAccount.deleteMany({ where: { id: mailboxId } }));
  if (!deleted.count) throw new ApiFailure(404, "NOT_FOUND", "Nie ma takiej skrzynki");
}

/** Konfiguracja połączenia skrzynki osoby, z odszyfrowanym hasłem (tylko w pamięci). */
export async function mailboxConfig(actor: Actor, mailboxId: string): Promise<MailboxConfig> {
  assertMailboxId(mailboxId);
  const row = await withUser(getDb(), actor, (tx) => tx.mailAccount.findFirst({ where: { id: mailboxId } }));
  if (!row) throw new ApiFailure(404, "NOT_FOUND", "Nie ma takiej skrzynki");
  const account = toAccount(row);
  return {
    email: account.email,
    displayName: account.displayName,
    username: account.username,
    password: decryptSecret(row.passwordCiphertext, passwordContext(actor.userId, row.id)),
    imap: account.imap,
    smtp: account.smtp,
  };
}
