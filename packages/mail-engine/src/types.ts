import type { ServerSettings } from "@aven/contracts";

/** Dane skrzynki potrzebne do połączenia: hasło tylko w pamięci, na czas jednego zadania. */
export interface MailboxConfig {
  email: string;
  displayName?: string | null;
  username?: string | null;
  password: string;
  imap: ServerSettings;
  smtp: ServerSettings;
}
