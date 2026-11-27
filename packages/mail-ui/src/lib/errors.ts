import { ApiError } from "@aven/client";

/** Komunikaty błędów API po polsku, dla użytkownika (kod błędu jest stały, ADR-0044). */
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Sesja wygasła. Zaloguj się ponownie.",
  PERMISSION_DENIED: "Nie masz do tego dostępu.",
  PRODUCT_ACCESS_REQUIRED: "AvenMail nie jest włączony dla Twojego konta. Poproś Ownera firmy o dostęp.",
  NOT_FOUND: "Nie znaleziono. Mogło zostać usunięte na innym urządzeniu.",
  VALIDATION_FAILED: "Sprawdź wpisane dane.",
  CONFLICT: "Operacja jest w konflikcie z bieżącym stanem danych.",
  RATE_LIMITED: "Za dużo prób. Spróbuj ponownie za kilka minut.",
  MAIL_AUTH_FAILED:
    "Serwer poczty odrzucił login albo hasło. Sprawdź hasło (u części dostawców potrzebne jest hasło aplikacji).",
  MAIL_CONNECTION_FAILED: "Nie udało się połączyć z serwerem poczty. Sprawdź adres serwera i port.",
  MAIL_HOST_NOT_ALLOWED:
    "Ten serwer albo port nie jest dozwolony. Użyj publicznego serwera poczty i portów 993 (IMAP) oraz 465 albo 587 (SMTP).",
  MAIL_TIMEOUT: "Serwer poczty nie odpowiedział na czas. Spróbuj ponownie.",
  MAIL_REJECTED: "Serwer poczty odrzucił wiadomość.",
  INTERNAL_ERROR: "Coś poszło nie tak po naszej stronie. Spróbuj ponownie.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const field = error.details[0];
    if (error.code === "VALIDATION_FAILED" && field) return `${MESSAGES.VALIDATION_FAILED} ${field.message}`;
    return MESSAGES[error.code] ?? error.message;
  }
  return MESSAGES.INTERNAL_ERROR!;
}
