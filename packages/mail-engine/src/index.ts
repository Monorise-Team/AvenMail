/**
 * Silnik poczty AvenMail: IMAP i SMTP po stronie serwera (ADR-0088). Każde zadanie otwiera własne połączenie
 * i je zamyka; treść wiadomości nie jest nigdzie zapisywana, tylko przekazywana do aplikacji.
 */
import { withImap } from "./imap.js";
import type { HostPolicy } from "./hosts.js";
import { verifySmtp } from "./smtp.js";
import type { MailboxConfig } from "./types.js";

export { MailError, toMailError } from "./errors.js";
export { isPrivateAddress, resolveMailHost, type HostPolicy } from "./hosts.js";
export {
  appendToSent,
  deleteMessage,
  folderRole,
  getMessage,
  listFolders,
  listMessages,
  moveMessage,
  setFlags,
  withImap,
} from "./imap.js";
export { sendMessage, verifySmtp } from "./smtp.js";
export type { MailboxConfig } from "./types.js";

/** Sprawdza logowanie do IMAP i SMTP przed zapisaniem skrzynki. */
export async function verifyMailbox(config: MailboxConfig, policy: HostPolicy): Promise<void> {
  await withImap(config, policy, async () => undefined);
  await verifySmtp(config, policy);
}

/** Domyślna polityka: produkcyjnie tylko publiczne serwery i szyfrowane połączenia. */
export const STRICT_POLICY: HostPolicy = { allowPrivateHosts: false, allowInsecure: false };
