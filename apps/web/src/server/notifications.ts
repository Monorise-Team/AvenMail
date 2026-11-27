import "server-only";
import { CoreApiError, type CoreClient } from "@monorise-team/sdk";
import { config } from "./config";
import { getMachineCoreClient } from "./core";
import { CoreMachineTokenError } from "./core-machine";

/** Kategoria powiadomień e-mail MonoriseCore o problemach z połączeniem ze skrzynką w AvenMail (ADR-0048). */
export const AVENMAIL_ALERTS_NOTIFICATION_CATEGORY = "avenmail.alerts" as const;

type SdkNotificationCategory = Parameters<CoreClient["sendNotification"]>[0]["body"]["category"];

/** Krótki limit czasu dla best-effort zlecenia powiadomienia do MonoriseCore (ms). */
export const DEFAULT_NOTIFICATION_TIMEOUT_MS = 3_000;

export interface MailboxAlertMessageInput {
  email: string;
}

export interface MailboxAlertMessage {
  title: string;
  body: string;
}

/**
 * Buduje neutralną płciowo polską treść alertu o odrzuconym logowaniu do podłączonej skrzynki pocztowej.
 */
export function buildMailboxAlertMessage(input: MailboxAlertMessageInput): MailboxAlertMessage {
  const email = input.email.trim();
  const title = `Nie możemy połączyć się ze skrzynką ${email}`;
  const body = `Serwer poczty odrzucił logowanie do skrzynki ${email}. Sprawdź hasło lub zaktualizuj ustawienia połączenia w AvenMail.`;
  return { title, body };
}

/**
 * Buduje adres strony tej skrzynki na originie aplikacji AvenMail (`AVEN_MAIL_URL`), np.
 * `http://aven-mail.localhost:3000/?account=<uuid>`. Zwraca `null`, gdy adres bazowy albo id są niepoprawne.
 */
export function buildMailboxActionUrl(appUrl: string, mailboxId: string): string | null {
  try {
    const parsed = new URL(appUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const normalizedId = mailboxId.trim();
    if (!normalizedId) {
      return null;
    }
    return `${parsed.origin}/?account=${encodeURIComponent(normalizedId)}`;
  } catch {
    return null;
  }
}

/**
 * Deterministyczny klucz idempotencji (`Idempotency-Key`, 1–255 drukowalnych znaków ASCII)
 * dla alertu skrzynki. Domyślnie grupuje próby w oknie bieżącego dnia UTC, dzięki czemu
 * równoczesne nieudane żądania IMAP/SMTP nie wysyłają wielokrotnych powiadomień.
 */
export function buildMailboxAlertIdempotencyKey(params: {
  mailboxId: string;
  recipientAccountId: string;
  windowKey?: string;
  now?: () => Date;
}): string {
  const bucket = (params.windowKey?.trim() || (params.now ? params.now() : new Date()).toISOString().slice(0, 10))
    .replace(/[^\x21-\x7E]/g, "-")
    .slice(0, 64);
  return `avenmail:mailbox-auth-failed:${params.mailboxId}:${params.recipientAccountId}:${bucket}`;
}

function describeNotificationError(error: unknown): string {
  if (error instanceof CoreApiError) {
    return `CoreApiError (HTTP ${error.status}, ${error.code}, requestId=${error.requestId})`;
  }
  if (error instanceof CoreMachineTokenError) {
    const parts = [error.status !== undefined ? `HTTP ${error.status}` : null, error.code ?? null].filter(Boolean);
    return parts.length > 0 ? `CoreMachineTokenError (${parts.join(", ")})` : "CoreMachineTokenError";
  }
  if (error instanceof Error) {
    return error.name;
  }
  return "UnknownError";
}

export interface NotifyMailboxAlertParams {
  organizationId: string;
  recipientAccountId: string;
  mailboxId: string;
  email: string;
  /** Opcjonalny klucz okna deduplikacji (domyślnie data UTC w formacie RRRR-MM-DD). */
  windowKey?: string;
}

export interface NotifyMailboxAlertOptions {
  core?: Pick<CoreClient, "sendNotification">;
  appUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
  warn?: (message: string) => void;
}

/**
 * Zleca powiadomienie e-mail o problemie z logowaniem do skrzynki przez MonoriseCore (`avenmail.alerts`)
 * w trybie best-effort: z krótkim limitem czasu, polityką ponawiania SDK i deterministycznym
 * nagłówkiem `Idempotency-Key`. Błąd Core nigdy nie przerywa żądania użytkownika i nie trafia
 * do logów z adresem e-mail, danymi osobowymi, hasłami ani tokenami.
 */
export async function notifyMailboxAlert(
  params: NotifyMailboxAlertParams,
  options: NotifyMailboxAlertOptions = {},
): Promise<void> {
  const core = options.core ?? getMachineCoreClient();
  const appUrl = options.appUrl ?? config.appUrl;
  const timeoutMs = options.timeoutMs ?? DEFAULT_NOTIFICATION_TIMEOUT_MS;
  const warn = options.warn ?? ((message: string) => console.warn(message));

  const { title, body } = buildMailboxAlertMessage({ email: params.email });
  const actionUrl = buildMailboxActionUrl(appUrl, params.mailboxId);
  const idempotencyKey = buildMailboxAlertIdempotencyKey({
    mailboxId: params.mailboxId,
    recipientAccountId: params.recipientAccountId,
    windowKey: params.windowKey,
    now: options.now,
  });

  try {
    await core.sendNotification({
      path: { organizationId: params.organizationId },
      body: {
        recipientAccountId: params.recipientAccountId,
        // `@monorise-team/sdk` 0.0.1-dev.26 nie zawiera jeszcze `"avenmail.alerts"` w unii
        // `NotificationCategoryKey` (do usunięcia po dodaniu kategorii w MonoriseCore i odświeżeniu SDK).
        category: AVENMAIL_ALERTS_NOTIFICATION_CATEGORY as unknown as SdkNotificationCategory,
        title,
        body,
        ...(actionUrl ? { actionUrl } : {}),
      },
      headers: { "Idempotency-Key": idempotencyKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    warn(
      `[avenmail.notifications] Nie udało się wysłać alertu dla skrzynki ${params.mailboxId} (${describeNotificationError(error)}).`,
    );
  }
}
