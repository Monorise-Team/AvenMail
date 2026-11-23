import type { Address, FolderRole } from "@aven/contracts";

const time = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" });
const full = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "numeric", year: "numeric" });
const long = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short" });

/** Data w liście: dziś godzina, w tym roku dzień i miesiąc, wcześniej pełna data. */
export function listDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (date.toDateString() === now.toDateString()) return time.format(date);
  if (date.getFullYear() === now.getFullYear()) return dayMonth.format(date);
  return full.format(date);
}

export const readerDate = (iso: string): string => long.format(new Date(iso));

export const displayName = (address: Address | null | undefined): string =>
  address ? address.name || address.address : "(bez nadawcy)";

export const formatAddresses = (list: Address[]): string =>
  list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");

/** „Anna <anna@acme.com>, marek@nowak.pl” → lista adresów; zwraca też niepoprawne fragmenty. */
export function parseAddresses(value: string): { addresses: Address[]; invalid: string[] } {
  const addresses: Address[] = [];
  const invalid: string[] = [];
  for (const part of value
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const match = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(part);
    const name = match?.[1]?.trim() || null;
    const address = (match ? match[2]! : part).trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) addresses.push({ name, address });
    else invalid.push(part);
  }
  return { addresses, invalid };
}

export const FOLDER_NAMES: Record<FolderRole, string> = {
  inbox: "Odebrane",
  flagged: "Oznaczone",
  drafts: "Wersje robocze",
  sent: "Wysłane",
  archive: "Archiwum",
  junk: "Spam",
  trash: "Kosz",
  all: "Cała poczta",
};

export function quoteForReply(text: string | null, from: Address | null, date: string): string {
  const header = `${readerDate(date)}, ${displayName(from)} napisał(a):`;
  const quoted = (text ?? "")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\n${header}\n${quoted}`;
}

export function prefixSubject(prefix: "Re" | "Fwd", subject: string): string {
  return new RegExp(`^${prefix}:`, "i").test(subject.trim()) ? subject : `${prefix}: ${subject}`;
}
