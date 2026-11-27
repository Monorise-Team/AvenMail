/**
 * Katalog ścieżek API AvenMail (`/api/v1/*`): jedno źródło prawdy dla generatora OpenAPI 3.1
 * (`openapi.ts`) i testów zgodności z kontraktem produktu (ADR-0044, ADR-0046).
 *
 * Moduł celowo nie importuje `server-only` i używa wyłącznie składni usuwalnej typów TypeScript,
 * dzięki czemu Node 24 uruchamia generator OpenAPI bez dodatkowego kompilatora.
 */
import {
  API_PREFIX,
  DeleteMessageResult,
  EmptyResult,
  FlagsRequest,
  FoldersList,
  Health,
  MailAccount,
  MailAccountInput,
  MailAccountsList,
  Me,
  Message,
  MessagePage,
  MoveRequest,
  SendRequest,
  SendResult,
  TestAccountResult,
  type ErrorCode,
} from "@aven/contracts";
import { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteTag = "System" | "Session" | "Accounts" | "Mail";

/**
 * Wymagane uwierzytelnienie trasy:
 * - `false`: publiczna (bez tokenu i bez sesji),
 * - `"session"`: wyłącznie sesja BFF przeglądarki w ciasteczku `HttpOnly`,
 * - `"user"`: token użytkownika `Bearer` albo sesja BFF przeglądarki.
 */
export type RouteAuth = false | "session" | "user";

export interface TagDefinition {
  name: RouteTag;
  description: string;
}

export const TAGS: readonly TagDefinition[] = [
  { name: "System", description: "Stan usługi AvenMail." },
  { name: "Session", description: "Dane zalogowanej osoby, firmy i możliwości widoczne w przeglądarce (BFF)." },
  { name: "Accounts", description: "Podłączone skrzynki pocztowe osoby (IMAP i SMTP)." },
  { name: "Mail", description: "Foldery, wiadomości i wysyłka poczty przez serwer AvenMail." },
];

export type SuccessStatus = 200 | 201 | 204;
export type ErrorStatus = 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504;
export type RouteErrors = Partial<Record<ErrorStatus, readonly ErrorCode[]>>;

export interface ParameterDefinition {
  name: string;
  in: "path" | "query";
  required: boolean;
  description: string;
  schema: z.ZodType;
}

export interface RouteDefinition {
  method: HttpMethod;
  /** Ścieżka w formacie OpenAPI (np. `/api/v1/accounts/{id}`). */
  path: string;
  operationId: string;
  tag: RouteTag;
  summary: string;
  description?: string;
  auth: RouteAuth;
  /** Kod odpowiedzi sukcesu. */
  successStatus: SuccessStatus;
  /** Czy odpowiedź sukcesu jest owinięta w kopertę `{ data, meta, error }` (nie dotyczy 204). */
  envelope: boolean;
  /** Parametry ścieżki (`path`) i zapytania (`query`). */
  parameters?: readonly ParameterDefinition[];
  /** Nazwa i schemat treści żądania (dla POST/PUT/PATCH). */
  requestBodySchemaName?: string;
  requestBodySchema?: z.ZodType;
  requestBodyRequired?: boolean;
  requestBodyDescription?: string;
  /** Nazwa schematu danych w `components/schemas` (brak przy 204). */
  dataSchemaName?: string;
  dataSchema?: z.ZodType;
  /** Nazwa schematu odpowiedzi w `components/schemas` dla odpowiedzi z kopertą (np. `MeResponse`). */
  responseSchemaName?: string;
  responseDescription: string;
  errors: RouteErrors;
}

const UuidSchema = z.uuid();
const FolderPathSchema = z.string().min(1).max(1000);
const MessageUidSchema = z.number().int().positive();
const PageNumberSchema = z.number().int().min(1).max(100000);
const PageSizeSchema = z.number().int().min(1).max(100);

const ACCOUNT_ID_PARAM: ParameterDefinition = {
  name: "id",
  in: "path",
  required: true,
  description: "Identyfikator podłączonej skrzynki pocztowej (UUID).",
  schema: UuidSchema,
};

const MESSAGE_UID_PARAM: ParameterDefinition = {
  name: "uid",
  in: "path",
  required: true,
  description: "Numer UID wiadomości w folderze IMAP.",
  schema: MessageUidSchema,
};

const REQUIRED_FOLDER_QUERY_PARAM: ParameterDefinition = {
  name: "folder",
  in: "query",
  required: true,
  description: "Ścieżka folderu IMAP (np. `INBOX`).",
  schema: FolderPathSchema,
};

export const ROUTES = {
  getHealth: {
    method: "GET",
    path: `${API_PREFIX}/health`,
    operationId: "getHealth",
    tag: "System",
    summary: "Stan usługi AvenMail",
    description: "Publiczna kontrola zdrowia serwera API bez sprawdzania bazy danych, skrzynek i MonoriseCore.",
    auth: false,
    successStatus: 200,
    envelope: true,
    dataSchemaName: "Health",
    dataSchema: Health,
    responseSchemaName: "HealthResponse",
    responseDescription: "Usługa działa.",
    errors: {
      500: ["INTERNAL_ERROR"],
    },
  },
  getMe: {
    method: "GET",
    path: `${API_PREFIX}/me`,
    operationId: "getMe",
    tag: "Session",
    summary: "Zalogowana osoba, firma i możliwości w AvenMail",
    description:
      "Zwraca profil osoby i firmy pobrany z MonoriseCore (`GET /core/v1/me`) oraz pole `capabilities` wyliczone " +
      "z migawki uprawnień produktu `avenmail`. Dostępne wyłącznie przez sesję BFF przeglądarki (ciasteczko); " +
      "wywołania z tokenem Bearer otrzymują `403 PERMISSION_DENIED`, bo profil osoby i firmy pobierają bezpośrednio z Core API.",
    auth: "session",
    successStatus: 200,
    envelope: true,
    dataSchemaName: "Me",
    dataSchema: Me,
    responseSchemaName: "MeResponse",
    responseDescription: "Profil zalogowanej osoby, firma i możliwości w interfejsie.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PERMISSION_DENIED"],
      500: ["INTERNAL_ERROR"],
      503: ["INTERNAL_ERROR"],
    },
  },

  // ── Skrzynki ──────────────────────────────────────────────────────────────

  listAccounts: {
    method: "GET",
    path: `${API_PREFIX}/accounts`,
    operationId: "listAccounts",
    tag: "Accounts",
    summary: "Lista podłączonych skrzynek osoby",
    description:
      "Zwraca skrzynki pocztowe zalogowanej osoby w jej firmie (bez haseł). Wymaga dostępu do produktu `avenmail` " +
      "oraz co najmniej jednego uprawnienia AvenMail.",
    auth: "user",
    successStatus: 200,
    envelope: true,
    dataSchemaName: "MailAccountsList",
    dataSchema: MailAccountsList,
    responseSchemaName: "MailAccountsListResponse",
    responseDescription: "Lista skrzynek pocztowych osoby.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      500: ["INTERNAL_ERROR"],
      503: ["INTERNAL_ERROR"],
    },
  },
  createAccount: {
    method: "POST",
    path: `${API_PREFIX}/accounts`,
    operationId: "createAccount",
    tag: "Accounts",
    summary: "Podłączenie nowej skrzynki pocztowej",
    description:
      "Weryfikuje połączenie IMAP i SMTP, szyfruje hasło i zapisuje skrzynkę osoby. Wymaga uprawnienia `avenmail.mailboxes.manage`.",
    auth: "user",
    successStatus: 201,
    envelope: true,
    requestBodySchemaName: "MailAccountInput",
    requestBodySchema: MailAccountInput,
    requestBodyRequired: true,
    requestBodyDescription: "Adres, hasło oraz ustawienia serwerów IMAP i SMTP.",
    dataSchemaName: "MailAccount",
    dataSchema: MailAccount,
    responseSchemaName: "MailAccountResponse",
    responseDescription: "Zapisana skrzynka pocztowa (bez hasła).",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      422: ["VALIDATION_FAILED", "MAIL_AUTH_FAILED", "MAIL_HOST_NOT_ALLOWED"],
      429: ["RATE_LIMITED"],
      500: ["INTERNAL_ERROR"],
      502: ["MAIL_CONNECTION_FAILED"],
      503: ["INTERNAL_ERROR"],
      504: ["MAIL_TIMEOUT"],
    },
  },
  testAccount: {
    method: "POST",
    path: `${API_PREFIX}/accounts/test`,
    operationId: "testAccount",
    tag: "Accounts",
    summary: "Sprawdzenie połączenia ze skrzynką bez zapisywania",
    description:
      "Sprawdza logowanie do IMAP i SMTP bez zapisywania danych w bazie. Wymaga uprawnienia `avenmail.mailboxes.manage`.",
    auth: "user",
    successStatus: 200,
    envelope: true,
    requestBodySchemaName: "MailAccountInput",
    requestBodySchema: MailAccountInput,
    requestBodyRequired: true,
    requestBodyDescription: "Dane logowania i adresy serwerów IMAP oraz SMTP.",
    dataSchemaName: "TestAccountResult",
    dataSchema: TestAccountResult,
    responseSchemaName: "TestAccountResponse",
    responseDescription: "Połączenie ze skrzynką powiodło się.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      422: ["VALIDATION_FAILED", "MAIL_AUTH_FAILED", "MAIL_HOST_NOT_ALLOWED"],
      429: ["RATE_LIMITED"],
      500: ["INTERNAL_ERROR"],
      502: ["MAIL_CONNECTION_FAILED"],
      503: ["INTERNAL_ERROR"],
      504: ["MAIL_TIMEOUT"],
    },
  },
  deleteAccount: {
    method: "DELETE",
    path: `${API_PREFIX}/accounts/{id}`,
    operationId: "deleteAccount",
    tag: "Accounts",
    summary: "Odłączenie skrzynki pocztowej",
    description:
      "Usuwa konfigurację skrzynki z AvenMail (u dostawcy poczty zostaje bez zmian). Wymaga uprawnienia `avenmail.mailboxes.manage`.",
    auth: "user",
    successStatus: 200,
    envelope: true,
    parameters: [ACCOUNT_ID_PARAM],
    dataSchemaName: "EmptyResult",
    dataSchema: EmptyResult,
    responseSchemaName: "EmptyResponse",
    responseDescription: "Skrzynka została usunięta z AvenMail.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      404: ["NOT_FOUND"],
      500: ["INTERNAL_ERROR"],
      503: ["INTERNAL_ERROR"],
    },
  },

  // ── Poczta ────────────────────────────────────────────────────────────────

  listFolders: {
    method: "GET",
    path: `${API_PREFIX}/accounts/{id}/folders`,
    operationId: "listFolders",
    tag: "Mail",
    summary: "Lista folderów IMAP skrzynki",
    description:
      "Pobiera aktualną listę folderów i liczniki nieprzeczytanych wiadomości przez IMAP. Wymaga uprawnienia `avenmail.mail.read`.",
    auth: "user",
    successStatus: 200,
    envelope: true,
    parameters: [ACCOUNT_ID_PARAM],
    dataSchemaName: "FoldersList",
    dataSchema: FoldersList,
    responseSchemaName: "FoldersListResponse",
    responseDescription: "Lista folderów skrzynki.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      404: ["NOT_FOUND"],
      422: ["MAIL_AUTH_FAILED", "MAIL_HOST_NOT_ALLOWED"],
      500: ["INTERNAL_ERROR"],
      502: ["MAIL_CONNECTION_FAILED"],
      503: ["INTERNAL_ERROR"],
      504: ["MAIL_TIMEOUT"],
    },
  },
  listMessages: {
    method: "GET",
    path: `${API_PREFIX}/accounts/{id}/messages`,
    operationId: "listMessages",
    tag: "Mail",
    summary: "Strona wiadomości w folderze",
    description:
      "Pobiera stronę nagłówków i podglądów wiadomości z folderu IMAP od najnowszych. Wymaga uprawnienia `avenmail.mail.read`.",
    auth: "user",
    successStatus: 200,
    envelope: true,
    parameters: [
      ACCOUNT_ID_PARAM,
      {
        name: "folder",
        in: "query",
        required: false,
        description: "Ścieżka folderu IMAP (domyślnie `INBOX`).",
        schema: FolderPathSchema,
      },
      {
        name: "page",
        in: "query",
        required: false,
        description: "Numer strony (od 1, domyślnie 1).",
        schema: PageNumberSchema,
      },
      {
        name: "pageSize",
        in: "query",
        required: false,
        description: "Liczba wiadomości na stronie (1-100, domyślnie 50).",
        schema: PageSizeSchema,
      },
    ],
    dataSchemaName: "MessagePage",
    dataSchema: MessagePage,
    responseSchemaName: "MessagePageResponse",
    responseDescription: "Strona wiadomości w folderze.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      404: ["NOT_FOUND"],
      422: ["VALIDATION_FAILED", "MAIL_AUTH_FAILED", "MAIL_HOST_NOT_ALLOWED"],
      500: ["INTERNAL_ERROR"],
      502: ["MAIL_CONNECTION_FAILED"],
      503: ["INTERNAL_ERROR"],
      504: ["MAIL_TIMEOUT"],
    },
  },
  getMessage: {
    method: "GET",
    path: `${API_PREFIX}/accounts/{id}/messages/{uid}`,
    operationId: "getMessage",
    tag: "Mail",
    summary: "Pełna treść pojedynczej wiadomości",
    description:
      "Pobiera pełną wiadomość na żądanie z IMAP bez zapisywania jej treści na serwerze. Wymaga uprawnienia `avenmail.mail.read`.",
    auth: "user",
    successStatus: 200,
    envelope: true,
    parameters: [ACCOUNT_ID_PARAM, MESSAGE_UID_PARAM, REQUIRED_FOLDER_QUERY_PARAM],
    dataSchemaName: "Message",
    dataSchema: Message,
    responseSchemaName: "MessageResponse",
    responseDescription: "Szczegóły wiadomości.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      404: ["NOT_FOUND"],
      422: ["VALIDATION_FAILED", "MAIL_AUTH_FAILED", "MAIL_HOST_NOT_ALLOWED"],
      500: ["INTERNAL_ERROR"],
      502: ["MAIL_CONNECTION_FAILED"],
      503: ["INTERNAL_ERROR"],
      504: ["MAIL_TIMEOUT"],
    },
  },
  updateMessageFlags: {
    method: "PATCH",
    path: `${API_PREFIX}/accounts/{id}/messages/{uid}`,
    operationId: "updateMessageFlags",
    tag: "Mail",
    summary: "Zmiana flag wiadomości (przeczytana, gwiazdka)",
    description:
      "Aktualizuje flagi `seen` i `flagged` wiadomości w folderze IMAP. Wymaga uprawnienia `avenmail.mail.read`.",
    auth: "user",
    successStatus: 200,
    envelope: true,
    parameters: [ACCOUNT_ID_PARAM, MESSAGE_UID_PARAM, REQUIRED_FOLDER_QUERY_PARAM],
    requestBodySchemaName: "FlagsRequest",
    requestBodySchema: FlagsRequest,
    requestBodyRequired: true,
    requestBodyDescription: "Flagi do ustawienia (co najmniej jedno z pól `seen` lub `flagged`).",
    dataSchemaName: "EmptyResult",
    dataSchema: EmptyResult,
    responseSchemaName: "EmptyResponse",
    responseDescription: "Flagi wiadomości zostały zaktualizowane.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      404: ["NOT_FOUND"],
      422: ["VALIDATION_FAILED", "MAIL_AUTH_FAILED", "MAIL_HOST_NOT_ALLOWED"],
      500: ["INTERNAL_ERROR"],
      502: ["MAIL_CONNECTION_FAILED"],
      503: ["INTERNAL_ERROR"],
      504: ["MAIL_TIMEOUT"],
    },
  },
  deleteMessage: {
    method: "DELETE",
    path: `${API_PREFIX}/accounts/{id}/messages/{uid}`,
    operationId: "deleteMessage",
    tag: "Mail",
    summary: "Usunięcie wiadomości (do kosza albo na stałe)",
    description:
      "Przenosi wiadomość do kosza, a z kosza (albo bez folderu kosza) usuwa ją na stałe. Wymaga uprawnienia `avenmail.mail.read`.",
    auth: "user",
    successStatus: 200,
    envelope: true,
    parameters: [ACCOUNT_ID_PARAM, MESSAGE_UID_PARAM, REQUIRED_FOLDER_QUERY_PARAM],
    dataSchemaName: "DeleteMessageResult",
    dataSchema: DeleteMessageResult,
    responseSchemaName: "DeleteMessageResponse",
    responseDescription: "Wynik usunięcia wiadomości.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      404: ["NOT_FOUND"],
      422: ["VALIDATION_FAILED", "MAIL_AUTH_FAILED", "MAIL_HOST_NOT_ALLOWED"],
      500: ["INTERNAL_ERROR"],
      502: ["MAIL_CONNECTION_FAILED"],
      503: ["INTERNAL_ERROR"],
      504: ["MAIL_TIMEOUT"],
    },
  },
  moveMessage: {
    method: "POST",
    path: `${API_PREFIX}/accounts/{id}/messages/{uid}/move`,
    operationId: "moveMessage",
    tag: "Mail",
    summary: "Przeniesienie wiadomości do innego folderu",
    description: "Przenosi wskazaną wiadomość do docelowego folderu IMAP. Wymaga uprawnienia `avenmail.mail.read`.",
    auth: "user",
    successStatus: 200,
    envelope: true,
    parameters: [ACCOUNT_ID_PARAM, MESSAGE_UID_PARAM, REQUIRED_FOLDER_QUERY_PARAM],
    requestBodySchemaName: "MoveRequest",
    requestBodySchema: MoveRequest,
    requestBodyRequired: true,
    requestBodyDescription: "Docelowa ścieżka folderu IMAP.",
    dataSchemaName: "EmptyResult",
    dataSchema: EmptyResult,
    responseSchemaName: "EmptyResponse",
    responseDescription: "Wiadomość została przeniesiona.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      404: ["NOT_FOUND"],
      422: ["VALIDATION_FAILED", "MAIL_AUTH_FAILED", "MAIL_HOST_NOT_ALLOWED"],
      500: ["INTERNAL_ERROR"],
      502: ["MAIL_CONNECTION_FAILED"],
      503: ["INTERNAL_ERROR"],
      504: ["MAIL_TIMEOUT"],
    },
  },
  sendMessage: {
    method: "POST",
    path: `${API_PREFIX}/accounts/{id}/send`,
    operationId: "sendMessage",
    tag: "Mail",
    summary: "Wysłanie wiadomości e-mail przez SMTP",
    description:
      "Wysyła wiadomość przez SMTP i dopisuje kopię do folderu Wysłane (gdy serwer nie robi tego sam). Wymaga uprawnienia `avenmail.mail.send`.",
    auth: "user",
    successStatus: 200,
    envelope: true,
    parameters: [ACCOUNT_ID_PARAM],
    requestBodySchemaName: "SendRequest",
    requestBodySchema: SendRequest,
    requestBodyRequired: true,
    requestBodyDescription: "Odbiorcy, temat i treść wysyłanej wiadomości.",
    dataSchemaName: "SendResult",
    dataSchema: SendResult,
    responseSchemaName: "SendResponse",
    responseDescription: "Wiadomość została wysłana.",
    errors: {
      401: ["UNAUTHENTICATED"],
      403: ["PRODUCT_ACCESS_REQUIRED", "PERMISSION_DENIED"],
      404: ["NOT_FOUND"],
      422: ["VALIDATION_FAILED", "MAIL_AUTH_FAILED", "MAIL_HOST_NOT_ALLOWED", "MAIL_REJECTED"],
      429: ["RATE_LIMITED"],
      500: ["INTERNAL_ERROR"],
      502: ["MAIL_CONNECTION_FAILED"],
      503: ["INTERNAL_ERROR"],
      504: ["MAIL_TIMEOUT"],
    },
  },
} as const satisfies Record<string, RouteDefinition>;

export const ROUTE_LIST: readonly RouteDefinition[] = Object.values(ROUTES);
