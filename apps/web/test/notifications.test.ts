/**
 * Testy jednostkowe i integracyjne (z atrapą Core, bez PostgreSQL) powiadomień e-mail
 * o problemach z połączeniem ze skrzynką (`apps/web/src/server/notifications.ts`)
 * oraz wywołania z `runWithConnectedMailbox`.
 */
import { MailError, type MailboxConfig } from "@aven/mail-engine";
import { createFakeCore, type FakeCore, type FakeOrganizationBuilder } from "@monorise-team/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMachineCoreTokenCache, setCoreRetryForTests } from "@/server/core";
import {
  CORE_DIRECTORY_READ_SCOPE,
  CORE_EVENTS_READ_SCOPE,
  CORE_NOTIFICATIONS_SEND_SCOPE,
  CORE_PERMISSIONS_READ_SCOPE,
  CORE_PERMISSIONS_REGISTER_SCOPE,
} from "@/server/core-machine";
import { runWithConnectedMailbox } from "@/server/mailboxes";
import {
  AVENMAIL_ALERTS_NOTIFICATION_CATEGORY,
  buildMailboxActionUrl,
  buildMailboxAlertIdempotencyKey,
  buildMailboxAlertMessage,
  notifyMailboxAlert,
} from "@/server/notifications";
import {
  createFakeCoreWithNotificationsFetch,
  type CapturedNotificationRequest,
  type NotificationFault,
} from "./helpers/fake-core-notifications";

const FAKE_CORE_URL = "http://core.notifications.test";
const CLIENT_ID = "avenmail-web";
const CLIENT_SECRET = "sekret-klienta-tylko-do-testow";
const FAST_RETRY = { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 } as const;

const MAILBOX_ID = "019a0000-0000-7000-8000-000000000101";
const ANNA_ID = "019a0000-0000-7000-8000-000000000201";
const JAN_ID = "019a0000-0000-7000-8000-000000000202";

const SAMPLE_MAILBOX: MailboxConfig = {
  email: "anna@acme.test",
  displayName: "Anna Nowak",
  username: null,
  password: "super-tajne-haslo-skrzynki",
  imap: { host: "imap.acme.test", port: 993, security: "ssl" },
  smtp: { host: "smtp.acme.test", port: 465, security: "ssl" },
};

describe("pomocniki alertów skrzynki pocztowej (notifications)", () => {
  it("buduje prostą, neutralną płciowo treść po polsku", () => {
    expect(buildMailboxAlertMessage({ email: "  anna@acme.test  " })).toEqual({
      title: "Nie możemy połączyć się ze skrzynką anna@acme.test",
      body: "Serwer poczty odrzucił logowanie do skrzynki anna@acme.test. Sprawdź hasło lub zaktualizuj ustawienia połączenia w AvenMail.",
    });
  });

  it("buduje actionUrl do strony tej skrzynki na originie AvenMail i odrzuca niepoprawne adresy", () => {
    expect(buildMailboxActionUrl("http://aven-mail.localhost:3000", MAILBOX_ID)).toBe(
      `http://aven-mail.localhost:3000/?account=${MAILBOX_ID}`,
    );
    expect(buildMailboxActionUrl("https://aven-mail.monorise.studio/mail/", MAILBOX_ID)).toBe(
      `https://aven-mail.monorise.studio/?account=${MAILBOX_ID}`,
    );
    expect(buildMailboxActionUrl("not-a-url", MAILBOX_ID)).toBeNull();
    expect(buildMailboxActionUrl("javascript:alert(1)", MAILBOX_ID)).toBeNull();
    expect(buildMailboxActionUrl("http://aven-mail.localhost:3000", "   ")).toBeNull();
  });

  it("generuje deterministyczny, drukowalny klucz Idempotency-Key do 255 znaków ASCII bez adresu e-mail", () => {
    const fixedDate = () => new Date("2026-11-27T12:34:56.000Z");
    const key1 = buildMailboxAlertIdempotencyKey({
      mailboxId: MAILBOX_ID,
      recipientAccountId: ANNA_ID,
      now: fixedDate,
    });
    const key2 = buildMailboxAlertIdempotencyKey({
      mailboxId: MAILBOX_ID,
      recipientAccountId: ANNA_ID,
      now: () => new Date("2026-11-27T23:59:59.000Z"),
    });
    const keyNextDay = buildMailboxAlertIdempotencyKey({
      mailboxId: MAILBOX_ID,
      recipientAccountId: ANNA_ID,
      now: () => new Date("2026-11-28T00:00:01.000Z"),
    });
    const keyOtherUser = buildMailboxAlertIdempotencyKey({
      mailboxId: MAILBOX_ID,
      recipientAccountId: JAN_ID,
      now: fixedDate,
    });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(keyNextDay);
    expect(key1).not.toBe(keyOtherUser);
    expect(key1.length).toBeGreaterThanOrEqual(1);
    expect(key1.length).toBeLessThanOrEqual(255);
    expect(/^[\x21-\x7E]+$/.test(key1)).toBe(true);
    expect(key1).not.toContain("@");
  });
});

describe("wysyłka alertu skrzynki przez MonoriseCore (notifyMailboxAlert)", () => {
  let fakeCore: FakeCore;
  let acme: FakeOrganizationBuilder;
  let captured: CapturedNotificationRequest[];
  let faultQueue: NotificationFault[];

  beforeAll(async () => {
    fakeCore = await createFakeCore({
      issuer: FAKE_CORE_URL,
      coreApiUrl: FAKE_CORE_URL,
      products: [
        {
          key: "avenmail",
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          scopes: [
            CORE_PERMISSIONS_REGISTER_SCOPE,
            CORE_PERMISSIONS_READ_SCOPE,
            CORE_DIRECTORY_READ_SCOPE,
            CORE_EVENTS_READ_SCOPE,
            CORE_NOTIFICATIONS_SEND_SCOPE,
          ],
        },
      ],
    });
  });

  beforeEach(() => {
    fakeCore.reset();
    acme = fakeCore.organization({ name: "Acme", domain: "acme.test" });
    acme.grantEntitlement("avenmail");
    captured = [];
    faultQueue = [];

    process.env.CORE_AUTH_URL = FAKE_CORE_URL;
    process.env.CORE_API_URL = FAKE_CORE_URL;
    process.env.AVEN_MAIL_URL = "http://aven-mail.localhost:3000";
    resetMachineCoreTokenCache();
    setCoreRetryForTests(FAST_RETRY);

    vi.spyOn(globalThis, "fetch").mockImplementation(
      createFakeCoreWithNotificationsFetch(fakeCore, {
        onNotification: (req) => captured.push(req),
        getNotificationFault: () => faultQueue.shift() ?? null,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setCoreRetryForTests();
    resetMachineCoreTokenCache();
  });

  it("wysyła żądanie z tokenem maszynowym, kategorią avenmail.alerts, Idempotency-Key i ponawia chwilowe 503", async () => {
    const warnings: string[] = [];
    faultQueue.push({ status: 503 });

    await notifyMailboxAlert(
      {
        organizationId: acme.id,
        recipientAccountId: ANNA_ID,
        mailboxId: MAILBOX_ID,
        email: "anna@acme.test",
        windowKey: "2026-11-27",
      },
      { warn: (message) => warnings.push(message) },
    );

    expect(warnings).toEqual([]);
    expect(captured).toHaveLength(2);
    const expectedKey = buildMailboxAlertIdempotencyKey({
      mailboxId: MAILBOX_ID,
      recipientAccountId: ANNA_ID,
      windowKey: "2026-11-27",
    });
    expect(captured[0]?.idempotencyKey).toBe(expectedKey);
    expect(captured[1]?.idempotencyKey).toBe(expectedKey);
    expect(captured[1]?.organizationId).toBe(acme.id);
    expect(captured[1]?.body).toEqual({
      recipientAccountId: ANNA_ID,
      category: AVENMAIL_ALERTS_NOTIFICATION_CATEGORY,
      title: "Nie możemy połączyć się ze skrzynką anna@acme.test",
      body: "Serwer poczty odrzucił logowanie do skrzynki anna@acme.test. Sprawdź hasło lub zaktualizuj ustawienia połączenia w AvenMail.",
      actionUrl: `http://aven-mail.localhost:3000/?account=${MAILBOX_ID}`,
    });
  });

  it("przy błędzie 500 albo błędzie sieci nie rzuca wyjątku i loguje ostrzeżenie bez e-maila, haseł i tokenów", async () => {
    const warnings: string[] = [];
    faultQueue.push({ status: 500 });

    await notifyMailboxAlert(
      {
        organizationId: acme.id,
        recipientAccountId: ANNA_ID,
        mailboxId: MAILBOX_ID,
        email: "poufna-anna@acme.test",
      },
      { warn: (message) => warnings.push(message) },
    );

    expect(captured).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(MAILBOX_ID);
    expect(warnings[0]).toContain("HTTP 500");
    expect(warnings[0]).not.toContain("poufna-anna@acme.test");
    expect(warnings[0]).not.toContain(ANNA_ID);
    expect(warnings[0]).not.toContain(CLIENT_SECRET);
    expect(warnings[0]).not.toContain("Bearer");

    faultQueue.push({ networkError: true }, { networkError: true }, { networkError: true });
    await notifyMailboxAlert(
      {
        organizationId: acme.id,
        recipientAccountId: ANNA_ID,
        mailboxId: MAILBOX_ID,
        email: "poufna-anna@acme.test",
      },
      { warn: (message) => warnings.push(message) },
    );

    expect(captured).toHaveLength(4);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain(MAILBOX_ID);
    expect(warnings[1]).not.toContain("poufna-anna@acme.test");
    expect(warnings[1]).not.toContain(CLIENT_SECRET);
  });

  it("przerywa wolne wywołanie po krótkim limicie czasu (timeoutMs) i nie rzuca wyjątku", async () => {
    const warnings: string[] = [];
    const hangingCore = {
      sendNotification: ({ signal }: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    };

    await notifyMailboxAlert(
      {
        organizationId: acme.id,
        recipientAccountId: ANNA_ID,
        mailboxId: MAILBOX_ID,
        email: "anna@acme.test",
      },
      { core: hangingCore, timeoutMs: 25, warn: (message) => warnings.push(message) },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(MAILBOX_ID);
    expect(warnings[0]).not.toContain("anna@acme.test");
  });

  it("runWithConnectedMailbox wysyła alert przy MAIL_AUTH_FAILED i nie wysyła go przy innych błędach", async () => {
    const actor = { organizationId: acme.id, userId: ANNA_ID };

    await expect(
      runWithConnectedMailbox(actor, MAILBOX_ID, SAMPLE_MAILBOX, async () => {
        throw new MailError("MAIL_AUTH_FAILED", "IMAP: serwer odrzucił login albo hasło");
      }),
    ).rejects.toMatchObject({ code: "MAIL_AUTH_FAILED" });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body.category).toBe("avenmail.alerts");
    expect(captured[0]?.body.title).toContain("anna@acme.test");

    await expect(
      runWithConnectedMailbox(actor, MAILBOX_ID, SAMPLE_MAILBOX, async () => {
        throw new MailError("MAIL_CONNECTION_FAILED", "IMAP: brak połączenia");
      }),
    ).rejects.toMatchObject({ code: "MAIL_CONNECTION_FAILED" });
    expect(captured).toHaveLength(1);

    const ok = await runWithConnectedMailbox(actor, MAILBOX_ID, SAMPLE_MAILBOX, async () => "ok");
    expect(ok).toBe("ok");
    expect(captured).toHaveLength(1);
  });
});
