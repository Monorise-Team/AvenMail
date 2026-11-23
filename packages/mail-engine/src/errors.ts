import type { ErrorCode } from "@aven/contracts";

/** Błąd silnika poczty z kodem z kontraktu API; `message` jest dla programistów, nie dla użytkownika. */
export class MailError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MailError";
    this.code = code;
  }
}

/** Zamienia błąd biblioteki IMAP albo SMTP na MailError, bez ujawniania szczegółów serwera. */
export function toMailError(error: unknown, what: "IMAP" | "SMTP"): MailError {
  if (error instanceof MailError) return error;
  const err = error as { authenticationFailed?: boolean; code?: string; responseCode?: number; message?: string };
  const message = String(err?.message ?? "");
  if (err?.authenticationFailed || err?.code === "EAUTH" || /auth|login|credentials|password/i.test(message)) {
    return new MailError("MAIL_AUTH_FAILED", `${what}: serwer odrzucił login albo hasło`, { cause: error });
  }
  if (err?.code === "ETIMEDOUT" || err?.code === "ETIMEOUT" || /timed? ?out/i.test(message)) {
    return new MailError("MAIL_TIMEOUT", `${what}: serwer nie odpowiedział na czas`, { cause: error });
  }
  if (err?.code === "EENVELOPE" || (err?.responseCode ?? 0) >= 500) {
    return new MailError("MAIL_REJECTED", `${what}: serwer odrzucił wiadomość`, { cause: error });
  }
  return new MailError("MAIL_CONNECTION_FAILED", `${what}: nie udało się połączyć z serwerem`, { cause: error });
}
