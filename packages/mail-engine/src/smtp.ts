import type { Address, SendRequest } from "@aven/contracts";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { MailError, toMailError } from "./errors.js";
import { resolveMailHost, type HostPolicy } from "./hosts.js";
import type { MailboxConfig } from "./types.js";

const TIMEOUT_MS = 20_000;

async function transport(config: MailboxConfig, policy: HostPolicy) {
  const { host, port, security } = config.smtp;
  if (security === "none" && !policy.allowInsecure) {
    throw new MailError("VALIDATION_FAILED", "Połączenie SMTP bez szyfrowania jest wyłączone");
  }
  const address = await resolveMailHost(host, port, "smtp", policy);
  return nodemailer.createTransport({
    host: address,
    port,
    secure: security === "ssl",
    requireTLS: security === "starttls",
    ignoreTLS: security === "none",
    auth: { user: config.username || config.email, pass: config.password },
    tls: { servername: host, rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 60_000,
    logger: false,
  });
}

/** Sprawdza, czy serwer SMTP przyjmuje login i hasło. */
export async function verifySmtp(config: MailboxConfig, policy: HostPolicy): Promise<void> {
  const smtp = await transport(config, policy);
  try {
    await smtp.verify();
  } catch (error) {
    throw toMailError(error, "SMTP");
  } finally {
    smtp.close();
  }
}

const format = (address: Address) =>
  address.name ? { name: address.name, address: address.address } : address.address;

/**
 * Składa i wysyła wiadomość. Zwraca jej identyfikator i źródło (bez ukrytych odbiorców), żeby ta sama
 * wiadomość mogła trafić do folderu Wysłane.
 */
export async function sendMessage(
  config: MailboxConfig,
  policy: HostPolicy,
  request: SendRequest & { cc: Address[]; bcc: Address[]; subject: string },
): Promise<{ messageId: string; raw: Buffer }> {
  const from = { name: config.displayName || "", address: config.email };
  const composer = new MailComposer({
    from: from.name ? from : from.address,
    to: request.to.map(format),
    cc: request.cc.map(format),
    subject: request.subject,
    text: request.text,
    inReplyTo: request.inReplyTo,
    references: request.references,
  });
  const mail = composer.compile();
  mail.keepBcc = false;
  const raw = await mail.build();
  const messageId = mail.messageId();
  const recipients = [...request.to, ...request.cc, ...request.bcc].map((address) => address.address);

  const smtp = await transport(config, policy);
  try {
    await smtp.sendMail({ envelope: { from: config.email, to: recipients }, raw });
  } catch (error) {
    throw toMailError(error, "SMTP");
  } finally {
    smtp.close();
  }
  return { messageId, raw };
}
