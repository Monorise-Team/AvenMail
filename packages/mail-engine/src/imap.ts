import type { Address, Attachment, Folder, FolderRole, Message, MessagePage, MessageSummary } from "@aven/contracts";
import { ImapFlow, type FetchMessageObject, type ListResponse, type MessageStructureObject } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { MailError, toMailError } from "./errors.js";
import { resolveMailHost, type HostPolicy } from "./hosts.js";
import type { MailboxConfig } from "./types.js";

const TIMEOUT_MS = 20_000;
/** Ile bajtów źródła pobrać na podgląd wiadomości w liście. */
const PREVIEW_BYTES = 6_144;
/** Obrazy z załączników wstawiamy w HTML tylko do tej łącznej wielkości. */
const INLINE_IMAGES_LIMIT = 3 * 1024 * 1024;

/**
 * Jedno połączenie IMAP na jedno zadanie: łączy się, wykonuje `task` i zawsze się wylogowuje. Hasło
 * trafia tylko do biblioteki IMAP, nigdy do logów (logger wyłączony).
 */
export async function withImap<T>(
  config: MailboxConfig,
  policy: HostPolicy,
  task: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const { host, port, security } = config.imap;
  if (security === "none" && !policy.allowInsecure) {
    throw new MailError("VALIDATION_FAILED", "Połączenie IMAP bez szyfrowania jest wyłączone");
  }
  const address = await resolveMailHost(host, port, "imap", policy);
  const client = new ImapFlow({
    host: address,
    port,
    secure: security === "ssl",
    doSTARTTLS: security === "starttls" ? true : security === "none" ? false : undefined,
    servername: host,
    auth: { user: config.username || config.email, pass: config.password },
    logger: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 60_000,
    tls: { servername: host, rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  // Błąd po zalogowaniu (np. zerwane połączenie) nie może zatrzymać procesu serwera
  client.on("error", () => {});
  try {
    await client.connect();
  } catch (error) {
    throw toMailError(error, "IMAP");
  }
  try {
    return await task(client);
  } catch (error) {
    throw toMailError(error, "IMAP");
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// ── Foldery ─────────────────────────────────────────────────────────────────

const SPECIAL_USE: Record<string, FolderRole> = {
  "\\Inbox": "inbox",
  "\\Sent": "sent",
  "\\Drafts": "drafts",
  "\\Trash": "trash",
  "\\Junk": "junk",
  "\\Archive": "archive",
  "\\Flagged": "flagged",
  "\\All": "all",
};

const NAME_ROLES: [RegExp, FolderRole][] = [
  [/^(sent|sent items|sent mail|sent messages|wys[lł]ane|elementy wys[lł]ane)$/i, "sent"],
  [/^(drafts?|szkice|kopie robocze|wersje robocze)$/i, "drafts"],
  [/^(trash|deleted|deleted items|deleted messages|bin|kosz|elementy usuni[eę]te)$/i, "trash"],
  [/^(junk|junk e-?mail|spam|wiadomo[sś]ci-?[sś]mieci)$/i, "junk"],
  [/^(archive|archives|archiwum)$/i, "archive"],
];

/** Rola folderu: ze znacznika serwera (SPECIAL-USE), a gdy go nie ma, z typowej nazwy. */
export function folderRole(folder: Pick<ListResponse, "path" | "name" | "specialUse">): FolderRole | null {
  if (folder.path.toUpperCase() === "INBOX") return "inbox";
  if (folder.specialUse && SPECIAL_USE[folder.specialUse]) return SPECIAL_USE[folder.specialUse]!;
  return NAME_ROLES.find(([pattern]) => pattern.test(folder.name))?.[1] ?? null;
}

const ROLE_ORDER: FolderRole[] = ["inbox", "flagged", "drafts", "sent", "archive", "junk", "trash", "all"];

export async function listFolders(config: MailboxConfig, policy: HostPolicy): Promise<Folder[]> {
  return withImap(config, policy, async (client) => {
    const list = await client.list({ statusQuery: { messages: true, unseen: true } });
    const folders = list
      .filter((folder) => !folder.flags.has("\\Noselect") && !folder.flags.has("\\NonExistent"))
      .map((folder): Folder => ({
        path: folder.path,
        name: folder.name,
        role: folderRole(folder),
        delimiter: folder.delimiter ?? null,
        total: folder.status?.messages ?? 0,
        unread: folder.status?.unseen ?? 0,
      }));
    const rank = (folder: Folder) => (folder.role ? ROLE_ORDER.indexOf(folder.role) : ROLE_ORDER.length);
    return folders.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path, "pl"));
  });
}

async function findFolder(client: ImapFlow, role: FolderRole): Promise<string | null> {
  const list = await client.list();
  return list.find((folder) => folderRole(folder) === role)?.path ?? null;
}

// ── Wiadomości ──────────────────────────────────────────────────────────────

function addresses(list: { name?: string; address?: string }[] | undefined): Address[] {
  return (list ?? [])
    .filter((entry) => entry.address)
    .map((entry) => ({ name: entry.name?.trim() || null, address: entry.address! }));
}

function hasAttachments(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.disposition === "attachment") return true;
  if (node.childNodes?.length) return node.childNodes.some(hasAttachments);
  const type = node.type?.toLowerCase() ?? "";
  return Boolean(node.dispositionParameters?.filename || node.parameters?.name) && !type.startsWith("text/");
}

/** Pierwsze ~200 znaków tekstu wiadomości z częściowego źródła; błąd parsowania daje brak podglądu. */
async function preview(source: Buffer | undefined): Promise<string | null> {
  if (!source?.length) return null;
  try {
    const parsed = await simpleParser(source, { skipHtmlToText: false, skipImageLinks: true, skipTextLinks: true });
    const text = (parsed.text || (typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : ""))
      .replace(/\s+/g, " ")
      .trim();
    return text ? text.slice(0, 200) : null;
  } catch {
    return null;
  }
}

async function toSummary(message: FetchMessageObject): Promise<MessageSummary> {
  const envelope = message.envelope;
  const flags = message.flags ?? new Set<string>();
  return {
    uid: message.uid,
    messageId: envelope?.messageId ?? null,
    subject: envelope?.subject ?? "",
    from: addresses(envelope?.from)[0] ?? null,
    to: addresses(envelope?.to),
    date: new Date(envelope?.date ?? message.internalDate ?? 0).toISOString(),
    seen: flags.has("\\Seen"),
    flagged: flags.has("\\Flagged"),
    answered: flags.has("\\Answered"),
    hasAttachments: hasAttachments(message.bodyStructure),
    preview: await preview(message.source),
    size: message.size ?? 0,
  };
}

/** Strona wiadomości w folderze, od najnowszych (według kolejności na serwerze). */
export async function listMessages(
  config: MailboxConfig,
  policy: HostPolicy,
  { folder, page, pageSize }: { folder: string; page: number; pageSize: number },
): Promise<MessagePage> {
  return withImap(config, policy, async (client) => {
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    try {
      const total = client.mailbox ? client.mailbox.exists : 0;
      const end = total - (page - 1) * pageSize;
      if (end < 1) return { folder, messages: [], total, page, pageSize };
      const start = Math.max(1, end - pageSize + 1);
      const fetched: FetchMessageObject[] = [];
      for await (const message of client.fetch(`${start}:${end}`, {
        uid: true,
        flags: true,
        envelope: true,
        bodyStructure: true,
        internalDate: true,
        size: true,
        source: { start: 0, maxLength: PREVIEW_BYTES },
      })) {
        fetched.push(message);
      }
      fetched.sort((a, b) => b.seq - a.seq);
      return { folder, messages: await Promise.all(fetched.map(toSummary)), total, page, pageSize };
    } finally {
      lock.release();
    }
  });
}

function parsedAddresses(value: AddressObject | AddressObject[] | undefined): Address[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((entry) =>
    entry.value
      .filter((item) => item.address)
      .map((item) => ({ name: item.name?.trim() || null, address: item.address! })),
  );
}

/** Obrazy z załączników (cid:) zamienione na data: URI, żeby HTML pokazał je bez dostępu do serwera. */
function inlineImages(html: string, parsed: ParsedMail): string {
  let budget = INLINE_IMAGES_LIMIT;
  let result = html;
  for (const attachment of parsed.attachments) {
    if (!attachment.cid || !attachment.contentType.startsWith("image/")) continue;
    if (attachment.size > budget) continue;
    budget -= attachment.size;
    const uri = `data:${attachment.contentType};base64,${attachment.content.toString("base64")}`;
    result = result.split(`cid:${attachment.cid}`).join(uri);
  }
  return result;
}

/** Cała wiadomość: treść HTML i tekst, adresy, lista załączników (bez ich zawartości). */
export async function getMessage(
  config: MailboxConfig,
  policy: HostPolicy,
  { folder, uid }: { folder: string; uid: number },
): Promise<Message> {
  return withImap(config, policy, async (client) => {
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    try {
      const message = await client.fetchOne(
        String(uid),
        { uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true, size: true, source: true },
        { uid: true },
      );
      if (!message || !message.source) throw new MailError("NOT_FOUND", `Nie ma wiadomości ${uid} w ${folder}`);
      const parsed = await simpleParser(message.source);
      const summary = await toSummary({ ...message, source: undefined });
      const references = Array.isArray(parsed.references)
        ? parsed.references
        : parsed.references
          ? [parsed.references]
          : [];
      const attachments: Attachment[] = parsed.attachments.map((attachment) => ({
        filename: attachment.filename ?? null,
        contentType: attachment.contentType,
        size: attachment.size,
        inline: attachment.contentDisposition === "inline" || Boolean(attachment.cid && attachment.related),
      }));
      const text = parsed.text?.trim() ? parsed.text : null;
      return {
        ...summary,
        subject: parsed.subject ?? summary.subject,
        preview: text ? text.replace(/\s+/g, " ").trim().slice(0, 200) : summary.preview,
        hasAttachments: attachments.some((attachment) => !attachment.inline),
        cc: parsedAddresses(parsed.cc),
        replyTo: parsedAddresses(parsed.replyTo),
        inReplyTo: parsed.inReplyTo ?? null,
        references,
        html: typeof parsed.html === "string" ? inlineImages(parsed.html, parsed) : null,
        text,
        attachments,
      };
    } finally {
      lock.release();
    }
  });
}

export async function setFlags(
  config: MailboxConfig,
  policy: HostPolicy,
  { folder, uid, seen, flagged }: { folder: string; uid: number; seen?: boolean; flagged?: boolean },
): Promise<void> {
  await withImap(config, policy, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const range = String(uid);
      if (seen === true) await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
      if (seen === false) await client.messageFlagsRemove(range, ["\\Seen"], { uid: true });
      if (flagged === true) await client.messageFlagsAdd(range, ["\\Flagged"], { uid: true });
      if (flagged === false) await client.messageFlagsRemove(range, ["\\Flagged"], { uid: true });
    } finally {
      lock.release();
    }
  });
}

export async function moveMessage(
  config: MailboxConfig,
  policy: HostPolicy,
  { folder, uid, to }: { folder: string; uid: number; to: string },
): Promise<void> {
  await withImap(config, policy, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const moved = await client.messageMove(String(uid), to, { uid: true });
      if (!moved) throw new MailError("NOT_FOUND", `Nie udało się przenieść wiadomości ${uid} do ${to}`);
    } finally {
      lock.release();
    }
  });
}

/** Usuwa wiadomość: najpierw do kosza, a z kosza (albo bez kosza) na stałe. */
export async function deleteMessage(
  config: MailboxConfig,
  policy: HostPolicy,
  { folder, uid }: { folder: string; uid: number },
): Promise<{ permanently: boolean }> {
  return withImap(config, policy, async (client) => {
    const trash = await findFolder(client, "trash");
    const lock = await client.getMailboxLock(folder);
    try {
      if (trash && trash !== folder) {
        await client.messageMove(String(uid), trash, { uid: true });
        return { permanently: false };
      }
      await client.messageDelete(String(uid), { uid: true });
      return { permanently: true };
    } finally {
      lock.release();
    }
  });
}

/** Dopisuje wysłaną wiadomość do folderu Wysłane; zwraca false, gdy folderu nie ma. */
export async function appendToSent(config: MailboxConfig, policy: HostPolicy, raw: Buffer): Promise<boolean> {
  return withImap(config, policy, async (client) => {
    const sent = await findFolder(client, "sent");
    if (!sent) return false;
    await client.append(sent, raw, ["\\Seen"]);
    return true;
  });
}
