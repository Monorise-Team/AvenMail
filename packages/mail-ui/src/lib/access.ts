import type { Capabilities } from "@aven/contracts";

export const DEFAULT_NO_ACCESS_MESSAGE = "AvenMail nie jest włączony dla Twojego konta. Poproś Ownera firmy o dostęp.";

export const DEFAULT_NO_ROLE_MESSAGE =
  "Twoje konto nie ma jeszcze przypisanej roli w AvenMail. Poproś administratora firmy o nadanie dostępu.";

export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  expired: "Sesja logowania wygasła. Spróbuj zalogować się ponownie.",
  denied: "Logowanie zostało przerwane.",
  unavailable: "Serwer logowania Monorise jest chwilowo niedostępny.",
  failed: "Nie udało się dokończyć logowania. Spróbuj ponownie.",
};

/**
 * Zwraca komunikat blokady, gdy konto nie ma dostępu do produktu ani żadnego uprawnienia w AvenMail.
 * Zwraca `null`, gdy osoba może korzystać z aplikacji.
 */
export function resolveAccessDenialMessage(capabilities: Capabilities): string | null {
  if (!capabilities.hasProductAccess) {
    return DEFAULT_NO_ACCESS_MESSAGE;
  }
  const hasAnyPermission = capabilities.readMail || capabilities.sendMail || capabilities.manageMailboxes;
  if (!hasAnyPermission) {
    return DEFAULT_NO_ROLE_MESSAGE;
  }
  return null;
}

export function canReadMail(capabilities: Capabilities): boolean {
  return capabilities.hasProductAccess && capabilities.readMail;
}

export function canSendMail(capabilities: Capabilities): boolean {
  return capabilities.hasProductAccess && capabilities.sendMail;
}

export function canManageMailboxes(capabilities: Capabilities): boolean {
  return capabilities.hasProductAccess && capabilities.manageMailboxes;
}

/** Usuwa wewnętrzny prefiks `/mail` (powstający przy bezpośrednim wejściu zamiast przepisania przez proxy). */
export function normalizeMailPathname(pathname: string): string {
  const clean = pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (clean === "/mail" || clean === "/mail/") return "/";
  if (clean.startsWith("/mail/")) return clean.slice(5);
  return clean || "/";
}

/** Buduje bezpieczny parametr `returnTo` do logowania (tylko ścieżka względna tej samej aplikacji). */
export function sanitizeReturnTo(pathname: string, search = ""): string {
  const normalized = normalizeMailPathname(pathname);
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return "/";
  }
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete("auth_error");
  const query = params.toString();
  return query ? `${normalized}?${query}` : normalized;
}

/** Odczytuje identyfikator skrzynki z parametru `?account=` (np. z linku w powiadomieniu o alercie). */
export function readAccountParam(search: string): string | null {
  const value = new URLSearchParams(search).get("account")?.trim();
  return value ? value : null;
}
