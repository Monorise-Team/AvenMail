/**
 * Silnik na prawdziwym serwerze poczty (GreenMail: `pnpm mail:test-server` albo usługa w CI).
 * Bez zmiennej AVEN_TEST_IMAP_HOST testy się pomijają.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appendToSent,
  deleteMessage,
  getMessage,
  listFolders,
  listMessages,
  moveMessage,
  sendMessage,
  setFlags,
  verifyMailbox,
  withImap,
  type MailboxConfig,
} from "../src/index.js";

const host = process.env.AVEN_TEST_IMAP_HOST;
const policy = { allowPrivateHosts: true, allowInsecure: true };
const user = `anna-${randomUUID().slice(0, 8)}@acme.test`;
const config: MailboxConfig = {
  email: user,
  displayName: "Anna Kowalska",
  password: "dowolne",
  imap: { host: host ?? "127.0.0.1", port: 3143, security: "none" },
  smtp: { host: host ?? "127.0.0.1", port: 3025, security: "none" },
};

async function waitFor<T>(check: () => Promise<T | undefined>, tries = 20): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Nie doczekano się wyniku");
}

describe.skipIf(!host)("silnik na serwerze GreenMail", () => {
  it("loguje się, wysyła, czyta, oznacza, przenosi i usuwa", { timeout: 60_000 }, async () => {
    await verifyMailbox(config, policy);

    const subject = `Faktura za listopad ${randomUUID().slice(0, 6)}`;
    const sent = await sendMessage(config, policy, {
      to: [{ name: "Anna", address: user }],
      cc: [],
      bcc: [],
      subject,
      text: "Cześć, w załączniku faktura. Termin płatności 14 dni.",
    });
    expect(sent.messageId).toMatch(/@/);

    const summary = await waitFor(async () => {
      const page = await listMessages(config, policy, { folder: "INBOX", page: 1, pageSize: 20 });
      return page.messages.find((message) => message.subject === subject);
    });
    expect(summary.seen).toBe(false);
    expect(summary.from?.address).toBe(user);
    expect(summary.preview).toContain("faktura");

    const message = await getMessage(config, policy, { folder: "INBOX", uid: summary.uid });
    expect(message.text).toContain("Termin płatności 14 dni");
    expect(message.to[0]?.address).toBe(user);

    await setFlags(config, policy, { folder: "INBOX", uid: summary.uid, seen: true, flagged: true });
    const after = await listMessages(config, policy, { folder: "INBOX", page: 1, pageSize: 20 });
    expect(after.messages.find((m) => m.uid === summary.uid)).toMatchObject({ seen: true, flagged: true });

    await withImap(config, policy, (client) => client.mailboxCreate("Klienci").then(() => undefined));
    await moveMessage(config, policy, { folder: "INBOX", uid: summary.uid, to: "Klienci" });
    const folders = await listFolders(config, policy);
    expect(folders.find((folder) => folder.path === "Klienci")?.total).toBe(1);
    expect(folders[0]?.role).toBe("inbox");

    const moved = await listMessages(config, policy, { folder: "Klienci", page: 1, pageSize: 20 });
    const result = await deleteMessage(config, policy, { folder: "Klienci", uid: moved.messages[0]!.uid });
    expect(result.permanently).toBe(true);

    expect(await appendToSent(config, policy, sent.raw)).toBe(false);
  });

  it("zwraca MAIL_CONNECTION_FAILED, gdy serwer nie odpowiada", async () => {
    await expect(verifyMailbox({ ...config, imap: { ...config.imap, port: 3999 } }, policy)).rejects.toMatchObject({
      code: "MAIL_CONNECTION_FAILED",
    });
  });
});
