/**
 * Typowany klient API AvenMail dla przeglądarki, komputera (Tauri) i telefonu (Expo). Przeglądarka używa
 * ciasteczka sesji (BFF, ADR-0050), aplikacje tokenu z systemowego sejfu (`getToken`).
 */
import {
  API_PREFIX,
  type ApiErrorBody,
  type ApiResponse,
  type ErrorCode,
  type FlagsRequest,
  type Folder,
  type MailAccount,
  type MailAccountInput,
  type Message,
  type MessagePage,
  type MoveRequest,
  type SendRequest,
  type SendResult,
  type User,
} from "@aven/contracts";

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ApiErrorBody["details"];

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.status = status;
    this.details = body.details;
  }
}

export interface ClientOptions {
  /** Adres serwera, np. `https://aven.monorise.studio`; pusty w przeglądarce (ten sam adres). */
  baseUrl?: string;
  /** Token aplikacji na komputer i telefon; przeglądarka go nie ma (ciasteczko). */
  getToken?: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
}

export type AvenClient = ReturnType<typeof createClient>;

export function createClient({ baseUrl = "", getToken, fetch: fetchImpl = fetch }: ClientOptions = {}) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = getToken ? await getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${API_PREFIX}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: getToken ? "omit" : "same-origin",
      });
    } catch {
      throw new ApiError(0, { code: "INTERNAL", message: "Brak połączenia z serwerem AvenMail", details: [] });
    }
    const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
    if (!response.ok || !payload || payload.error) {
      throw new ApiError(
        response.status,
        payload?.error ?? { code: "INTERNAL", message: `Błąd serwera (${response.status})`, details: [] },
      );
    }
    return payload.data as T;
  }

  const account = (id: string) => `/accounts/${encodeURIComponent(id)}`;
  const message = (id: string, folder: string, uid: number) =>
    `${account(id)}/messages/${uid}?folder=${encodeURIComponent(folder)}`;

  return {
    session: {
      me: () => request<User>("GET", "/me"),
      /**
       * Wylogowanie w przeglądarce (BFF): serwer kończy sesję i unieważnia token w Core. Odpowiedź to
       * przekierowanie, którego nie śledzimy; potem wystarczy ponownie zapytać o `me`.
       */
      signOut: async () => {
        await fetchImpl(`${baseUrl}/api/auth/sign-out`, {
          method: "POST",
          credentials: "same-origin",
          redirect: "manual",
        });
      },
    },
    accounts: {
      list: () => request<MailAccount[]>("GET", "/accounts"),
      test: (input: MailAccountInput) => request<{ ok: true }>("POST", "/accounts/test", input),
      create: (input: MailAccountInput) => request<MailAccount>("POST", "/accounts", input),
      remove: (id: string) => request<null>("DELETE", account(id)),
    },
    mail: {
      folders: (id: string) => request<Folder[]>("GET", `${account(id)}/folders`),
      messages: (id: string, folder: string, page = 1, pageSize = 50) =>
        request<MessagePage>(
          "GET",
          `${account(id)}/messages?folder=${encodeURIComponent(folder)}&page=${page}&pageSize=${pageSize}`,
        ),
      message: (id: string, folder: string, uid: number) => request<Message>("GET", message(id, folder, uid)),
      setFlags: (id: string, folder: string, uid: number, flags: FlagsRequest) =>
        request<null>("PATCH", message(id, folder, uid), flags),
      move: (id: string, folder: string, uid: number, to: MoveRequest["to"]) =>
        request<null>("POST", `${account(id)}/messages/${uid}/move?folder=${encodeURIComponent(folder)}`, { to }),
      remove: (id: string, folder: string, uid: number) =>
        request<{ permanently: boolean }>("DELETE", message(id, folder, uid)),
      send: (id: string, input: SendRequest) => request<SendResult>("POST", `${account(id)}/send`, input),
    },
  };
}

export type {
  Folder,
  MailAccount,
  MailAccountInput,
  Message,
  MessagePage,
  MessageSummary,
  User,
} from "@aven/contracts";

export {
  createAppSession,
  SessionExpiredError,
  type AppSession,
  type AppTokens,
  type SignInProvider,
  type TokenStore,
} from "./session.js";
