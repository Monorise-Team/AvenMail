import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MailError } from "./errors.js";

/**
 * Ochrona przed SSRF: użytkownik podaje adres serwera poczty, a łączy się nasz serwer. Bez tej kontroli
 * dałoby się z niego skanować sieć wewnętrzną (np. 10.0.0.0/8 na AWS) albo metadane chmury.
 */
export interface HostPolicy {
  /** Tylko lokalnie i w testach: serwery w sieci prywatnej (np. GreenMail na 127.0.0.1). */
  allowPrivateHosts: boolean;
  /** Tylko lokalnie i w testach: połączenia bez szyfrowania i dowolne porty. */
  allowInsecure: boolean;
}

const IMAP_PORTS = new Set([143, 993]);
const SMTP_PORTS = new Set([25, 465, 587, 2525]);

const V4_BLOCKED: [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16 (w tym metadane chmury)
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xe0000000, 4], // 224.0.0.0/4
  [0xf0000000, 4], // 240.0.0.0/4
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

/** Czy adres IP należy do sieci prywatnej, lokalnej albo zarezerwowanej. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]!);
  if (isIP(address) === 4) {
    const value = ipv4ToInt(address);
    return V4_BLOCKED.some(([base, bits]) => (value & (bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0)) >>> 0 === base);
  }
  const v6 = address.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith("ff")
  );
}

/**
 * Sprawdza serwer poczty i zwraca adres IP, z którym się połączymy (ten sam, który sprawdziliśmy, więc
 * podmiana DNS w międzyczasie nic nie da). Nazwa serwera zostaje do sprawdzenia certyfikatu TLS.
 */
export async function resolveMailHost(
  host: string,
  port: number,
  kind: "imap" | "smtp",
  policy: HostPolicy,
): Promise<string> {
  const ports = kind === "imap" ? IMAP_PORTS : SMTP_PORTS;
  if (!policy.allowInsecure && !ports.has(port)) {
    throw new MailError(
      "MAIL_HOST_NOT_ALLOWED",
      `Port ${port} nie jest portem ${kind.toUpperCase()} (dozwolone: ${[...ports].join(", ")})`,
    );
  }
  let addresses: { address: string }[];
  try {
    addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new MailError("MAIL_CONNECTION_FAILED", `Nie znaleziono serwera ${host}`, { cause: error });
  }
  if (!addresses.length) throw new MailError("MAIL_CONNECTION_FAILED", `Nie znaleziono serwera ${host}`);
  if (!policy.allowPrivateHosts && addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new MailError("MAIL_HOST_NOT_ALLOWED", `Serwer ${host} wskazuje na adres w sieci prywatnej`);
  }
  return addresses[0]!.address;
}
