/**
 * Kontrakt API AvenMail (`https://aven.monorise.studio/api/v1`): schematy i typy wspólne dla serwera,
 * przeglądarki, komputera i telefonu. Format odpowiedzi jak w standardzie API Monorise: `{ data, meta, error }`.
 */
import { z } from "zod";

export const API_PREFIX = "/api/v1";

// ── Odpowiedzi i błędy ──────────────────────────────────────────────────────

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "PRODUCT_ACCESS_REQUIRED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "RATE_LIMITED",
  "MAIL_AUTH_FAILED",
  "MAIL_CONNECTION_FAILED",
  "MAIL_HOST_NOT_ALLOWED",
  "MAIL_TIMEOUT",
  "MAIL_REJECTED",
  "INTERNAL_ERROR",
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ApiErrorDetail = z.object({
  field: z.string().optional(),
  message: z.string(),
});
export type ApiErrorDetail = z.infer<typeof ApiErrorDetail>;

export const ApiErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.array(ApiErrorDetail),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const ApiMeta = z.object({
  requestId: z.string(),
});
export type ApiMeta = z.infer<typeof ApiMeta>;

/** Koperta udanej odpowiedzi API AvenMail: `{ data, meta, error: null }` (ADR-0044). */
export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({
    data,
    meta: ApiMeta,
    error: z.null(),
  });
}

/** Koperta odpowiedzi błędu API AvenMail: `{ data: null, meta, error }` (ADR-0044). */
export function apiErrorSchema<T extends z.ZodType = typeof ApiErrorBody>(error?: T) {
  return z.object({
    data: z.null(),
    meta: ApiMeta,
    error: (error ?? ApiErrorBody) as T,
  });
}

export const ApiErrorResponse = apiErrorSchema();
export type ApiErrorResponse = z.infer<typeof ApiErrorResponse>;

export interface ApiResponse<T> {
  data: T | null;
  meta: { requestId?: string; [key: string]: unknown };
  error: ApiErrorBody | null;
}

export const Health = z.object({
  status: z.literal("ok"),
  version: z.string().nullable(),
});
export type Health = z.infer<typeof Health>;

// ── Zalogowana osoba i firma (z MonoriseCore) ───────────────────────────────

export const Capabilities = z.object({
  hasProductAccess: z.boolean(),
  readMail: z.boolean(),
  sendMail: z.boolean(),
  manageMailboxes: z.boolean(),
});
export type Capabilities = z.infer<typeof Capabilities>;

export const Me = z.object({
  account: z.object({
    id: z.string(),
    email: z.string(),
  }),
  employee: z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    fullName: z.string(),
    jobTitle: z.string().nullable(),
  }),
  organization: z.object({
    id: z.string(),
    name: z.string(),
  }),
  capabilities: Capabilities,
});
export type Me = z.infer<typeof Me>;

// ── Skrzynki ────────────────────────────────────────────────────────────────

export const Security = z.enum(["ssl", "starttls", "none"]);
export type Security = z.infer<typeof Security>;

export const ServerSettings = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.-]+$/i, "Nazwa serwera może mieć tylko litery, cyfry, kropki i myślniki"),
  port: z.number().int().min(1).max(65535),
  security: Security,
});
export type ServerSettings = z.infer<typeof ServerSettings>;

export const MailAccountInput = z.object({
  email: z.email().max(254),
  displayName: z.string().trim().max(120).optional(),
  /** Login, gdy różni się od adresu e-mail. */
  username: z.string().trim().max(254).optional(),
  password: z.string().min(1).max(1024),
  imap: ServerSettings,
  smtp: ServerSettings,
});
export type MailAccountInput = z.infer<typeof MailAccountInput>;

/** Skrzynka bez hasła: hasło nigdy nie wraca z serwera. */
export const MailAccount = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  imap: ServerSettings,
  smtp: ServerSettings,
  createdAt: z.string(),
});
export type MailAccount = z.infer<typeof MailAccount>;

export const MailAccountsList = z.array(MailAccount);
export type MailAccountsList = z.infer<typeof MailAccountsList>;

export const TestAccountResult = z.object({
  ok: z.literal(true),
});
export type TestAccountResult = z.infer<typeof TestAccountResult>;

// ── Foldery i wiadomości ────────────────────────────────────────────────────

export const FolderRole = z.enum(["inbox", "sent", "drafts", "trash", "junk", "archive", "flagged", "all"]);
export type FolderRole = z.infer<typeof FolderRole>;

export const Folder = z.object({
  path: z.string(),
  name: z.string(),
  role: FolderRole.nullable(),
  delimiter: z.string().nullable(),
  total: z.number().int(),
  unread: z.number().int(),
});
export type Folder = z.infer<typeof Folder>;

export const FoldersList = z.array(Folder);
export type FoldersList = z.infer<typeof FoldersList>;

export const Address = z.object({
  name: z.string().nullable(),
  address: z.string(),
});
export type Address = z.infer<typeof Address>;

export const MessageSummary = z.object({
  uid: z.number().int(),
  messageId: z.string().nullable(),
  subject: z.string(),
  from: Address.nullable(),
  to: z.array(Address),
  date: z.string(),
  seen: z.boolean(),
  flagged: z.boolean(),
  answered: z.boolean(),
  hasAttachments: z.boolean(),
  preview: z.string().nullable(),
  size: z.number().int(),
});
export type MessageSummary = z.infer<typeof MessageSummary>;

export const MessagePage = z.object({
  folder: z.string(),
  messages: z.array(MessageSummary),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type MessagePage = z.infer<typeof MessagePage>;

export const Attachment = z.object({
  filename: z.string().nullable(),
  contentType: z.string(),
  size: z.number().int(),
  inline: z.boolean(),
});
export type Attachment = z.infer<typeof Attachment>;

export const Message = MessageSummary.extend({
  cc: z.array(Address),
  replyTo: z.array(Address),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
  /** HTML do wyświetlenia w ramce bez skryptów; obrazy z załączników są już wstawione. */
  html: z.string().nullable(),
  text: z.string().nullable(),
  attachments: z.array(Attachment),
});
export type Message = z.infer<typeof Message>;

export const PageQuery = z.object({
  folder: z.string().min(1).max(1000).default("INBOX"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const FlagsRequest = z
  .object({ seen: z.boolean().optional(), flagged: z.boolean().optional() })
  .refine((value) => value.seen !== undefined || value.flagged !== undefined, "Podaj seen albo flagged");
export type FlagsRequest = z.infer<typeof FlagsRequest>;

export const MoveRequest = z.object({ to: z.string().min(1).max(1000) });
export type MoveRequest = z.infer<typeof MoveRequest>;

export const DeleteMessageResult = z.object({
  permanently: z.boolean(),
});
export type DeleteMessageResult = z.infer<typeof DeleteMessageResult>;

export const EmptyResult = z.null();
export type EmptyResult = z.infer<typeof EmptyResult>;

export const SendRequest = z.object({
  to: z.array(Address).min(1).max(100),
  cc: z.array(Address).max(100).default([]),
  bcc: z.array(Address).max(100).default([]),
  subject: z.string().max(998).default(""),
  text: z.string().max(1_000_000),
  inReplyTo: z.string().max(998).optional(),
  references: z.array(z.string().max(998)).max(100).optional(),
});
export type SendRequest = z.input<typeof SendRequest>;

export const SendResult = z.object({
  messageId: z.string(),
  /** Czy kopia trafiła do folderu Wysłane (część serwerów robi to sama). */
  savedToSent: z.boolean(),
});
export type SendResult = z.infer<typeof SendResult>;

export * from "./providers.js";
export * from "./permissions.js";
