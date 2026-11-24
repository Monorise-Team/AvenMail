import { SessionExpiredError, type AppTokens, type SignInProvider, type TokenStore } from "@aven/client";
import {
  authorizeUrl,
  createPkce,
  DEFAULT_SCOPES,
  exchangeCode,
  OAuthError,
  randomToken,
  refreshTokens,
  revokeToken,
  type TokenResponse,
} from "@monorise-team/auth";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Serwer logowania MonoriseCore i API AvenMail (identyfikator API to zarazem jego adres). */
const CORE = (import.meta.env.VITE_CORE_AUTH_URL as string | undefined) ?? "http://localhost:3100";
export const API = (import.meta.env.VITE_AVEN_API as string | undefined) ?? "http://aven.localhost:3000";

/** Klient publiczny (bez sekretu); zapytania do Core idą przez Tauri, więc nie blokuje ich CORS okna. */
const client = { issuer: CORE, clientId: "avenmail-desktop", fetch: tauriFetch as typeof fetch };

function toTokens(response: TokenResponse, previousRefreshToken?: string): AppTokens {
  const refreshToken = response.refresh_token ?? previousRefreshToken;
  if (!refreshToken) throw new Error("Core nie wydał tokenu odświeżania");
  return { accessToken: response.access_token, refreshToken, expiresAt: Date.now() + response.expires_in * 1000 };
}

/**
 * Logowanie kontem Monorise na komputerze (RFC 8252): ekran logowania Core w przeglądarce systemowej
 * i powrót na 127.0.0.1, gdzie powłoka Tauri czeka na kod. PKCE, `state` i `iss` przy każdym logowaniu.
 */
export const desktopSignIn: SignInProvider = {
  async signIn() {
    const port = await invoke<number>("oauth_listen");
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const pkce = await createPkce();
    const state = randomToken();
    const url = authorizeUrl({
      ...client,
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
      scopes: DEFAULT_SCOPES,
      resources: [API],
    });
    await openUrl(url.toString());

    const query = new URL(await invoke<string>("oauth_wait"), "http://127.0.0.1").searchParams;
    if (query.get("state") !== state || query.get("iss") !== CORE) {
      throw new Error("Odpowiedź logowania nie pasuje do tego logowania. Spróbuj jeszcze raz.");
    }
    const error = query.get("error");
    if (error) throw new Error(error === "access_denied" ? "Logowanie zostało przerwane." : "Nie udało się zalogować.");
    const code = query.get("code");
    if (!code) throw new Error("Nie udało się zalogować.");
    return toTokens(await exchangeCode({ ...client, code, redirectUri, codeVerifier: pkce.verifier, resource: API }));
  },

  async refresh(refreshToken) {
    try {
      return toTokens(await refreshTokens({ ...client, refreshToken, resource: API }), refreshToken);
    } catch (error) {
      if (error instanceof OAuthError && error.error === "invalid_grant") throw new SessionExpiredError();
      throw error;
    }
  },

  async revoke(refreshToken) {
    await revokeToken({ ...client, token: refreshToken, hint: "refresh_token" });
  },
};

/** Tokeny w systemowym sejfie (Keychain, Credential Manager, Secret Service), nie w pamięci okna. */
export const keychain: TokenStore = {
  async read() {
    const raw = await invoke<string | null>("tokens_get");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AppTokens;
    } catch {
      return null;
    }
  },
  async write(tokens) {
    if (tokens) await invoke("tokens_set", { value: JSON.stringify(tokens) });
    else await invoke("tokens_delete");
  },
};
