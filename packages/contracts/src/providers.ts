import type { ServerSettings } from "./index.js";

/**
 * Znani dostawcy poczty: ustawienia serwerów do podpowiedzi przy dodawaniu skrzynki. Logowanie hasłem
 * (ADR-0088); tam, gdzie dostawca wymaga hasła aplikacji, mówi o tym `note`.
 */
export interface ProviderPreset {
  id: string;
  name: string;
  domains: string[];
  imap: ServerSettings;
  smtp: ServerSettings;
  /** Wskazówka dla użytkownika, np. o haśle aplikacji. */
  note?: string;
  /** Dostawca wymaga OAuth: na razie nieobsługiwany. */
  unsupported?: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "gmail",
    name: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    imap: { host: "imap.gmail.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.gmail.com", port: 465, security: "ssl" },
    note: "Gmail wymaga hasła aplikacji: włącz weryfikację dwuetapową i utwórz hasło aplikacji w ustawieniach konta Google.",
  },
  {
    id: "outlook",
    name: "Outlook.com",
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
    imap: { host: "outlook.office365.com", port: 993, security: "ssl" },
    smtp: { host: "smtp-mail.outlook.com", port: 587, security: "starttls" },
    note: "Microsoft wyłączył logowanie hasłem do IMAP. Skrzynki Outlook.com i Microsoft 365 zadziałają dopiero z logowaniem przez Microsoft.",
    unsupported: true,
  },
  {
    id: "icloud",
    name: "iCloud",
    domains: ["icloud.com", "me.com", "mac.com"],
    imap: { host: "imap.mail.me.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
    note: "iCloud wymaga hasła dla aplikacji, które utworzysz na stronie Apple ID.",
  },
  {
    id: "yahoo",
    name: "Yahoo",
    domains: ["yahoo.com", "yahoo.pl"],
    imap: { host: "imap.mail.yahoo.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "ssl" },
    note: "Yahoo wymaga hasła aplikacji z ustawień bezpieczeństwa konta.",
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    domains: ["zoho.com", "zohomail.com", "zoho.eu", "zohomail.eu"],
    imap: { host: "imap.zoho.eu", port: 993, security: "ssl" },
    smtp: { host: "smtp.zoho.eu", port: 465, security: "ssl" },
  },
  {
    id: "fastmail",
    name: "Fastmail",
    domains: ["fastmail.com", "fastmail.fm"],
    imap: { host: "imap.fastmail.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.fastmail.com", port: 465, security: "ssl" },
    note: "Fastmail wymaga hasła aplikacji z ustawień Prywatność i bezpieczeństwo.",
  },
  {
    id: "wp",
    name: "WP Poczta",
    domains: ["wp.pl"],
    imap: { host: "imap.wp.pl", port: 993, security: "ssl" },
    smtp: { host: "smtp.wp.pl", port: 465, security: "ssl" },
    note: "Włącz w ustawieniach WP Poczty dostęp przez programy pocztowe (IMAP).",
  },
  {
    id: "onet",
    name: "Onet Poczta",
    domains: ["onet.pl", "op.pl", "vp.pl", "onet.eu", "poczta.onet.pl"],
    imap: { host: "imap.poczta.onet.pl", port: 993, security: "ssl" },
    smtp: { host: "smtp.poczta.onet.pl", port: 465, security: "ssl" },
    note: "Włącz w ustawieniach Onet Poczty dostęp przez programy pocztowe.",
  },
  {
    id: "interia",
    name: "Interia Poczta",
    domains: ["interia.pl", "interia.eu", "poczta.fm"],
    imap: { host: "poczta.interia.pl", port: 993, security: "ssl" },
    smtp: { host: "poczta.interia.pl", port: 465, security: "ssl" },
    note: "Włącz w ustawieniach Interii dostęp przez programy pocztowe.",
  },
  {
    id: "o2",
    name: "o2 Poczta",
    domains: ["o2.pl", "tlen.pl", "go2.pl"],
    imap: { host: "poczta.o2.pl", port: 993, security: "ssl" },
    smtp: { host: "poczta.o2.pl", port: 465, security: "ssl" },
  },
  {
    id: "ovh",
    name: "OVHcloud (poczta we własnej domenie)",
    domains: [],
    imap: { host: "ssl0.ovh.net", port: 993, security: "ssl" },
    smtp: { host: "ssl0.ovh.net", port: 465, security: "ssl" },
  },
];

/** Dostawca po domenie adresu, np. `anna@wp.pl` → WP Poczta. */
export function detectProvider(email: string): ProviderPreset | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return null;
  return PROVIDER_PRESETS.find((preset) => preset.domains.includes(domain)) ?? null;
}

/** Domyślna propozycja dla nieznanej domeny: `imap.<domena>` i `smtp.<domena>` z TLS. */
export function guessServers(email: string): { imap: ServerSettings; smtp: ServerSettings } | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return {
    imap: { host: `imap.${domain}`, port: 993, security: "ssl" },
    smtp: { host: `smtp.${domain}`, port: 465, security: "ssl" },
  };
}
