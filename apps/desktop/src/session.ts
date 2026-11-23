/**
 * Token logowania aplikacji na komputer. Na razie w localStorage okna Tauri; przeniesienie do systemowego
 * sejfu (Keychain, Credential Manager, Secret Service) to osobne zadanie, wymagane przed wydaniem (ADR-0089).
 */
const KEY = "aven-desktop-token";

export function readToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Brak dostępu do localStorage: sesja trwa do zamknięcia okna
  }
}
