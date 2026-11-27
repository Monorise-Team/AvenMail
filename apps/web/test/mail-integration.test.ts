/**
 * Testy integracyjne API poczty z prawdziwą bazą PostgreSQL (RLS) i serwerem poczty GreenMail.
 * Tokeny i migawki uprawnień dostarcza atrapa `createFakeCore` z `@monorise-team/testing`.
 * Część z GreenMail pomija się bez zmiennej `AVEN_TEST_IMAP_HOST`.
 */
import { randomUUID } from "node:crypto";
import { AVENMAIL_PERMISSIONS } from "@aven/contracts";
import { createFakeCore, type FakeCore, type FakeOrganizationBuilder } from "@monorise-team/testing";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as folders from "@/app/api/v1/accounts/[id]/folders/route";
import * as messages from "@/app/api/v1/accounts/[id]/messages/route";
import * as one from "@/app/api/v1/accounts/[id]/messages/[uid]/route";
import * as mailbox from "@/app/api/v1/accounts/[id]/route";
import * as send from "@/app/api/v1/accounts/[id]/send/route";
import * as accounts from "@/app/api/v1/accounts/route";
import { resetAuthForTests } from "@/server/auth";
import { resetMachineCoreTokenCache } from "@/server/core";
import {
  CORE_DIRECTORY_READ_SCOPE,
  CORE_EVENTS_READ_SCOPE,
  CORE_NOTIFICATIONS_SEND_SCOPE,
  CORE_PERMISSIONS_READ_SCOPE,
  CORE_PERMISSIONS_REGISTER_SCOPE,
} from "@/server/core-machine";
import { getDb } from "@/server/db";
import { invalidatePermissionCache } from "@/server/permissions";

const API = "http://aven.localhost:3000";
const BASE = `${API}/api/v1`;
const FAKE_CORE_URL = "http://core.mail-integration.test";
const CLIENT_ID = "avenmail-web";
const CLIENT_SECRET = "sekret-klienta-tylko-do-testow";

function call<P>(
  handler: (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>,
  path: string,
  init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
  params = {} as P,
) {
  const headers: Record<string, string> = { host: "aven.localhost:3000", ...init.headers };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const request = new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return handler(request, { params: Promise.resolve(params) }).then(async (response) => ({
    status: response.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- w testach czytamy odpowiedzi API swobodnie
    body: (await response.json()) as { data: any; meta: { requestId: string }; error: any },
    response,
  }));
}

let fakeCore: FakeCore;
let acme: FakeOrganizationBuilder;
let adminRoleId: string;

async function signInAsAdmin(org = acme) {
  const roleId =
    org === acme
      ? adminRoleId
      : org.addRole({
          name: "Administrator AvenMail",
          product: "avenmail",
          permissions: [
            AVENMAIL_PERMISSIONS.keys["mail.read"],
            AVENMAIL_PERMISSIONS.keys["mail.send"],
            AVENMAIL_PERMISSIONS.keys["mailboxes.manage"],
          ],
        }).id;
  const person = org.addEmployee({
    firstName: "Osoba",
    lastName: randomUUID().slice(0, 6),
    products: ["avenmail"],
  });
  org.assignRole({ accountId: person.accountId, roleId, scope: { type: "ORGANIZATION" } });
  const token = await org.signUserToken(person.accountId, { audience: API });
  return { ...person, token };
}

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
  process.env.CORE_AUTH_URL = FAKE_CORE_URL;
  process.env.CORE_API_URL = FAKE_CORE_URL;
  delete process.env.AVEN_CORE_JWKS;
  resetAuthForTests();
  vi.spyOn(globalThis, "fetch").mockImplementation(fakeCore.fetch as typeof fetch);
});

beforeEach(() => {
  fakeCore.reset();
  acme = fakeCore.organization({ name: "Acme", domain: "acme.test" });
  acme.grantEntitlement("avenmail");
  adminRoleId = acme.addRole({
    name: "Administrator AvenMail",
    product: "avenmail",
    permissions: [
      AVENMAIL_PERMISSIONS.keys["mail.read"],
      AVENMAIL_PERMISSIONS.keys["mail.send"],
      AVENMAIL_PERMISSIONS.keys["mailboxes.manage"],
    ],
  }).id;
  invalidatePermissionCache();
  resetMachineCoreTokenCache();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await getDb().$disconnect();
});

describe("API z PostgreSQL (skrzynki i RLS)", () => {
  it("nowa osoba nie ma podłączonych skrzynek", async () => {
    const { token } = await signInAsAdmin();
    const list = await call(accounts.GET, "/accounts", { token });
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });
});

const host = process.env.AVEN_TEST_IMAP_HOST;

describe.skipIf(!host)("API z prawdziwym serwerem poczty (GreenMail)", () => {
  it("dodaje skrzynkę, wysyła, listuje, czyta, oznacza i usuwa", { timeout: 60_000 }, async () => {
    const { token } = await signInAsAdmin();
    const email = `marek-${randomUUID().slice(0, 6)}@acme.test`;
    const created = await call(accounts.POST, "/accounts", {
      method: "POST",
      token,
      body: {
        email,
        displayName: "Marek Nowak",
        password: "dowolne",
        imap: { host, port: 3143, security: "none" },
        smtp: { host, port: 3025, security: "none" },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).not.toHaveProperty("password");
    const id = created.body.data.id as string;

    const subject = `Plan wdrożenia ${randomUUID().slice(0, 6)}`;
    const sent = await call(
      send.POST,
      `/accounts/${id}/send`,
      {
        method: "POST",
        token,
        body: { to: [{ name: null, address: email }], subject, text: "Szkolenie w poniedziałek, start w środę." },
      },
      { id },
    );
    expect(sent.status).toBe(200);

    let uid = 0;
    for (let i = 0; i < 20 && !uid; i++) {
      const page = await call(messages.GET, `/accounts/${id}/messages?folder=INBOX`, { token }, { id });
      uid = page.body.data.messages.find((m: { subject: string }) => m.subject === subject)?.uid ?? 0;
      if (!uid) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(uid).toBeGreaterThan(0);

    const list = await call(folders.GET, `/accounts/${id}/folders`, { token }, { id });
    expect(list.body.data[0].role).toBe("inbox");

    const opened = await call(
      one.GET,
      `/accounts/${id}/messages/${uid}?folder=INBOX`,
      { token },
      { id, uid: String(uid) },
    );
    expect(opened.body.data.text).toContain("start w środę");

    const flagged = await call(
      one.PATCH,
      `/accounts/${id}/messages/${uid}?folder=INBOX`,
      {
        method: "PATCH",
        token,
        body: { seen: true, flagged: true },
      },
      { id, uid: String(uid) },
    );
    expect(flagged.status).toBe(200);

    const removed = await call(
      one.DELETE,
      `/accounts/${id}/messages/${uid}?folder=INBOX`,
      {
        method: "DELETE",
        token,
      },
      { id, uid: String(uid) },
    );
    expect(removed.body.data.permanently).toBe(true);
  });

  it("skrzynki Anny nie widzi ani nie usunie Bartek z jej firmy ani nikt z innej firmy", async () => {
    const anna = await signInAsAdmin();
    const created = await call(accounts.POST, "/accounts", {
      method: "POST",
      token: anna.token,
      body: {
        email: `anna-${randomUUID().slice(0, 6)}@acme.test`,
        password: "dowolne",
        imap: { host, port: 3143, security: "none" },
        smtp: { host, port: 3025, security: "none" },
      },
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const globex = fakeCore.organization({ name: "Globex", domain: "globex.test" });
    globex.grantEntitlement("avenmail");

    for (const other of [await signInAsAdmin(acme), await signInAsAdmin(globex)]) {
      expect((await call(accounts.GET, "/accounts", { token: other.token })).body.data).toEqual([]);
      expect((await call(folders.GET, `/accounts/${id}/folders`, { token: other.token }, { id })).status).toBe(404);
      const removed = await call(mailbox.DELETE, `/accounts/${id}`, { method: "DELETE", token: other.token }, { id });
      expect(removed.status).toBe(404);
    }
    expect((await call(accounts.GET, "/accounts", { token: anna.token })).body.data).toHaveLength(1);
  });

  it("zły port daje MAIL_CONNECTION_FAILED i nie zapisuje skrzynki", async () => {
    const { token } = await signInAsAdmin();
    const result = await call(accounts.POST, "/accounts", {
      method: "POST",
      token,
      body: {
        email: "ola@acme.test",
        password: "x",
        imap: { host, port: 3999, security: "none" },
        smtp: { host, port: 3025, security: "none" },
      },
    });
    expect(result.status).toBe(502);
    expect(result.body.error.code).toBe("MAIL_CONNECTION_FAILED");
  });
});
