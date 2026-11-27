/**
 * Testy API na prawdziwych trasach Next.js: atrapa MonoriseCore (`createFakeCore` z `@monorise-team/testing`)
 * udostępniająca JWKS, OAuth `client_credentials`, `/core/v1/me` i migawkę uprawnień
 * (podpięta pod `globalThis.fetch` bez gniazd TCP, bez PostgreSQL i bez GreenMail).
 */
import { AVENMAIL_PERMISSIONS } from "@aven/contracts";
import type { Authenticated, Session } from "@monorise-team/auth/next";
import {
  createFakeCore,
  type CreatedEmployeeWithAccount,
  type FakeCore,
  type FakeOrganizationBuilder,
} from "@monorise-team/testing";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as signInRoute from "@/app/api/auth/sign-in/route";
import * as folders from "@/app/api/v1/accounts/[id]/folders/route";
import * as accounts from "@/app/api/v1/accounts/route";
import * as health from "@/app/api/v1/health/route";
import * as me from "@/app/api/v1/me/route";
import { route } from "@/server/api";
import { getAuth, requireUser, resetAuthForTests } from "@/server/auth";
import { resetMachineCoreTokenCache } from "@/server/core";
import {
  CORE_DIRECTORY_READ_SCOPE,
  CORE_EVENTS_READ_SCOPE,
  CORE_NOTIFICATIONS_SEND_SCOPE,
  CORE_PERMISSIONS_READ_SCOPE,
  CORE_PERMISSIONS_REGISTER_SCOPE,
} from "@/server/core-machine";
import { assertPermission, invalidatePermissionCache, PRODUCT_ACCESS_REQUIRED_MESSAGE } from "@/server/permissions";

const API = "http://aven.localhost:3000";
const BASE = `${API}/api/v1`;
const FAKE_CORE_URL = "http://core.api.test";
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
let anna: CreatedEmployeeWithAccount;
let userRoleId: string;
let adminRoleId: string;
let faultPath: string | null = null;

async function coreFetchAdapter(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(rawUrl);

  if (url.origin !== FAKE_CORE_URL) {
    throw new TypeError(`connect ECONNREFUSED ${url.host}`);
  }

  if (faultPath !== null && url.pathname === faultPath) {
    return new Response(
      JSON.stringify({
        data: null,
        meta: { requestId: "req_core_500" },
        error: { code: "INTERNAL_ERROR", message: "Core failure", details: [] },
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  return fakeCore.fetch(input, init);
}

function setupDefaultAcme(): void {
  acme = fakeCore.organization({ name: "Acme", domain: "acme.test" });
  acme.grantEntitlement("avenmail");

  userRoleId = acme.addRole({
    name: "Użytkownik AvenMail",
    product: "avenmail",
    permissions: [AVENMAIL_PERMISSIONS.keys["mail.read"], AVENMAIL_PERMISSIONS.keys["mail.send"]],
  }).id;
  adminRoleId = acme.addRole({
    name: "Administrator AvenMail",
    product: "avenmail",
    permissions: [
      AVENMAIL_PERMISSIONS.keys["mail.read"],
      AVENMAIL_PERMISSIONS.keys["mail.send"],
      AVENMAIL_PERMISSIONS.keys["mailboxes.manage"],
    ],
  }).id;

  anna = acme.addEmployee({
    firstName: "Anna",
    lastName: "Nowak",
    email: "anna@acme.test",
    jobTitle: "Specjalistka logistyki",
    products: ["avenmail"],
  });
  acme.assignRole({ accountId: anna.accountId, roleId: userRoleId, scope: { type: "ORGANIZATION" } });
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
});

beforeEach(() => {
  fakeCore.reset();
  setupDefaultAcme();
  faultPath = null;
  process.env.CORE_AUTH_URL = FAKE_CORE_URL;
  process.env.CORE_API_URL = FAKE_CORE_URL;
  invalidatePermissionCache();
  resetMachineCoreTokenCache();
  vi.spyOn(globalThis, "fetch").mockImplementation(coreFetchAdapter as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
});

function mockBrowserSession(
  employee: CreatedEmployeeWithAccount,
  organizationId: string,
  coreAccessToken: string,
  authzRevision = employee.account.authzRevision,
) {
  const context = {
    accountId: employee.accountId,
    organizationId,
    employeeId: employee.employeeId,
    sessionId: "sesja-core",
    authzRevision,
    methods: [],
    clientId: CLIENT_ID,
    scopes: ["openid", "profile", "email", "offline_access"],
    expiresAt: new Date(Date.now() + 5 * 60_000),
  };
  const requestedResources: (string | undefined)[] = [];
  const session: Session = {
    context,
    profile: { email: employee.account.email, name: `${employee.firstName} ${employee.lastName}` },
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    accessToken: async (resource?: string) => {
      requestedResources.push(resource);
      return coreAccessToken;
    },
    setCookies: [],
  };
  const authenticated: Authenticated = { context, via: "session", session, setCookies: [] };
  vi.spyOn(getAuth(), "authenticate").mockResolvedValue(authenticated);
  return { requestedResources };
}

describe("API: sesja, Core SDK, uprawnienia i ochrona CSRF", () => {
  it("health odpowiada ok w formacie { data, meta, error }", async () => {
    const { status, body } = await call(health.GET, "/health");
    expect(status).toBe(200);
    expect(body.data.status).toBe("ok");
    expect(body.error).toBeNull();
    expect(body.meta.requestId).toMatch(/^req_/);
  });

  it("bez sesji odpowiada UNAUTHENTICATED w formacie { data, meta, error }", async () => {
    const { status, body } = await call(me.GET, "/me");
    expect(status).toBe(401);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.meta.requestId).toMatch(/^req_/);
  });

  it("GET /api/v1/me z sesją przeglądarki (BFF) pobiera osobę, firmę i capabilities z Core", async () => {
    const coreApiToken = await acme.signUserToken(anna.accountId, { audience: fakeCore.coreApiUrl });
    const { requestedResources } = mockBrowserSession(anna, acme.id, coreApiToken);

    const { status, body } = await call(me.GET, "/me");
    expect(status).toBe(200);
    expect(requestedResources).toEqual([fakeCore.coreApiUrl]);
    expect(body.data).toMatchObject({
      account: { id: anna.accountId, email: "anna@acme.test" },
      employee: {
        id: anna.employeeId,
        firstName: "Anna",
        lastName: "Nowak",
        fullName: "Anna Nowak",
        jobTitle: "Specjalistka logistyki",
      },
      organization: { id: acme.id, name: "Acme" },
      capabilities: {
        hasProductAccess: true,
        readMail: true,
        sendMail: true,
        manageMailboxes: false,
      },
    });

    // Po nadaniu roli Administrator AvenMail i podbiciu authz_rev pamięć podręczna odświeża capabilities
    acme.assignRole({
      accountId: anna.accountId,
      roleId: adminRoleId,
      scope: { type: "ORGANIZATION" },
    });
    const nextRev = acme.bumpAuthzRevision(anna.accountId);
    mockBrowserSession(anna, acme.id, coreApiToken, nextRev);
    const refreshed = await call(me.GET, "/me");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.capabilities).toEqual({
      hasProductAccess: true,
      readMail: true,
      sendMail: true,
      manageMailboxes: true,
    });
    expect(fakeCore.calls.permissionSnapshot).toBe(2);
    expect(fakeCore.calls.token).toBe(1);
  });

  it("GET /api/v1/me odzwierciedla brak dostępu do produktu", async () => {
    const blocked = acme.addEmployee({ firstName: "Zablokowana", lastName: "Osoba", products: [] });
    const blockedToken = await acme.signUserToken(blocked.accountId, { audience: fakeCore.coreApiUrl });
    mockBrowserSession(blocked, acme.id, blockedToken);

    const blockedRes = await call(me.GET, "/me");
    expect(blockedRes.status).toBe(200);
    expect(blockedRes.body.data.capabilities).toEqual({
      hasProductAccess: false,
      readMail: false,
      sendMail: false,
      manageMailboxes: false,
    });
  });

  it("GET /api/v1/me odrzuca token Bearer (403 PERMISSION_DENIED) zamiast przekazywać go do Core", async () => {
    const token = await acme.signUserToken(anna.accountId, { audience: API });
    const { status, body } = await call(me.GET, "/me", { token });
    expect(status).toBe(403);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("PERMISSION_DENIED");
    expect(body.error.message).toMatch(/Core API/);
  });

  it("mapuje błędy Core API na 401 i 503 dla sesji BFF i niedostępności migawki", async () => {
    const expiredCoreToken = await fakeCore.issuer.invalid.expired({
      accountId: anna.accountId,
      organizationId: acme.id,
      employeeId: anna.employeeId,
      audience: fakeCore.coreApiUrl,
    });
    mockBrowserSession(anna, acme.id, expiredCoreToken);

    const unauth = await call(me.GET, "/me");
    expect(unauth.status).toBe(401);
    expect(unauth.body.error.code).toBe("UNAUTHENTICATED");

    const validCoreToken = await acme.signUserToken(anna.accountId, { audience: fakeCore.coreApiUrl });
    mockBrowserSession(anna, acme.id, validCoreToken);

    faultPath = "/core/v1/me";
    const failed = await call(me.GET, "/me");
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe("INTERNAL_ERROR");

    faultPath = "/core/v1/products/avenmail/permission-snapshot";
    const snapFailed = await call(me.GET, "/me");
    expect(snapFailed.status).toBe(503);
    expect(snapFailed.body.error.code).toBe("INTERNAL_ERROR");

    faultPath = null;
    process.env.CORE_API_URL = "http://127.0.0.1:1";
    const unavailable = await call(me.GET, "/me");
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("chroniona trasa zwraca 403 PRODUCT_ACCESS_REQUIRED bez dostępu i odświeża cache po wzroście authz_rev", async () => {
    const protectedHandler = route(async ({ request }) => {
      const caller = await requireUser(request);
      await assertPermission(caller, AVENMAIL_PERMISSIONS.keys["mail.read"]);
      return { ok: true };
    });

    const newPerson = acme.addEmployee({ firstName: "Nowa", lastName: "Osoba", products: [] });
    const tokenRev0 = await acme.signUserToken(newPerson.accountId, { audience: API });
    const denied = await call(protectedHandler, "/probe", { token: tokenRev0 });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("PRODUCT_ACCESS_REQUIRED");
    expect(denied.body.error.message).toBe(PRODUCT_ACCESS_REQUIRED_MESSAGE);

    acme.grantAppAccess(newPerson.accountId, "avenmail");
    acme.assignRole({ accountId: newPerson.accountId, roleId: userRoleId, scope: { type: "ORGANIZATION" } });
    const nextRev = acme.bumpAuthzRevision(newPerson.accountId);
    const tokenRev1 = await acme.signUserToken(newPerson.accountId, { audience: API, authzRevision: nextRev });

    const allowed = await call(protectedHandler, "/probe", { token: tokenRev1 });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toEqual({ ok: true });
  });

  it("odrzuca token dla innego API i token po terminie", async () => {
    const base = {
      accountId: anna.accountId,
      organizationId: acme.id,
      employeeId: anna.employeeId,
      audience: API,
    };
    const otherApi = await fakeCore.issuer.invalid.wrongAudience(base, "http://localhost:3200");
    expect((await call(me.GET, "/me", { token: otherApi })).status).toBe(401);
    const expired = await fakeCore.issuer.invalid.expired(base);
    expect((await call(me.GET, "/me", { token: expired })).body.error.code).toBe("UNAUTHENTICATED");
  });

  it("logowanie w przeglądarce przekierowuje do Core z PKCE i oboma API", async () => {
    const response = await signInRoute.GET(new Request("http://aven-mail.localhost:3000/api/auth/sign-in?returnTo=/"));
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location") ?? "");
    expect(`${target.origin}${target.pathname}`).toBe(`${fakeCore.issuerUrl}/api/auth/oauth2/authorize`);
    expect(target.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(target.searchParams.get("redirect_uri")).toBe("http://aven-mail.localhost:3000/api/auth/callback");
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.getAll("resource")).toEqual([API, fakeCore.coreApiUrl]);
    expect(response.headers.get("set-cookie")).toMatch(/^monorise-oauth=.*HttpOnly; SameSite=Lax/);
  });

  it("odrzuca zmianę z ciasteczkiem spoza strony (CSRF)", async () => {
    const { status, body } = await call(accounts.POST, "/accounts", {
      method: "POST",
      body: {},
      headers: { cookie: "monorise-session=x", origin: "https://zla-strona.example" },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("PERMISSION_DENIED");
  });

  it("Użytkownik AvenMail bez mailboxes.manage dostaje 403 przy POST /accounts, a Administrator dostaje VALIDATION_FAILED dla złych danych", async () => {
    const userToken = await acme.signUserToken(anna.accountId, { audience: API });
    const forbidden = await call(accounts.POST, "/accounts", {
      method: "POST",
      token: userToken,
      body: { email: "to-nie-adres", password: "" },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("PERMISSION_DENIED");

    const admin = acme.addEmployee({ firstName: "Ewa", lastName: "Admin", products: ["avenmail"] });
    acme.assignRole({ accountId: admin.accountId, roleId: adminRoleId, scope: { type: "ORGANIZATION" } });
    const adminToken = await acme.signUserToken(admin.accountId, { audience: API });

    const validation = await call(accounts.POST, "/accounts", {
      method: "POST",
      token: adminToken,
      body: { email: "to-nie-adres", password: "" },
    });
    expect(validation.status).toBe(422);
    expect(validation.body.error.code).toBe("VALIDATION_FAILED");
    expect(validation.body.error.details.map((d: { field: string }) => d.field)).toContain("email");
  });

  it("zwraca INTERNAL_ERROR (500) przy nieoczekiwanym błędzie trasy oraz NOT_FOUND dla złego UUID skrzynki", async () => {
    const failing = route(async () => {
      throw new Error("nieoczekiwany błąd");
    });
    const { status, body } = await call(failing, "/boom");
    expect(status).toBe(500);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("INTERNAL_ERROR");

    const token = await acme.signUserToken(anna.accountId, { audience: API });
    const missing = await call(folders.GET, "/accounts/nie-uuid/folders", { token }, { id: "nie-uuid" });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });
});
