/**
 * Testy zgodności AvenMail z kontraktem produktu Monorise (ADR-0046, ADR-0075) za pomocą
 * `defineProductContractTests` z `@monorise-team/testing` oraz kontrola spójności opisu OpenAPI 3.1.
 *
 * Testy działają bez bazy PostgreSQL, bez GreenMail i bez gniazd TCP (atrapa `createFakeCore` podpięta pod
 * `globalThis.fetch`; wszystkie odmowy uwierzytelnienia, dostępu do produktu i uprawnień
 * kończą się przed warstwą bazy danych i serwera poczty).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createFakeCore, defineProductContractTests, type FakeCore } from "@monorise-team/testing";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as accountById from "@/app/api/v1/accounts/[id]/route";
import * as accountFolders from "@/app/api/v1/accounts/[id]/folders/route";
import * as accountMessages from "@/app/api/v1/accounts/[id]/messages/route";
import * as accountMessageByUid from "@/app/api/v1/accounts/[id]/messages/[uid]/route";
import * as accountMessageMove from "@/app/api/v1/accounts/[id]/messages/[uid]/move/route";
import * as accountSend from "@/app/api/v1/accounts/[id]/send/route";
import * as accounts from "@/app/api/v1/accounts/route";
import * as accountsTest from "@/app/api/v1/accounts/test/route";
import * as health from "@/app/api/v1/health/route";
import * as me from "@/app/api/v1/me/route";
import { resetAuthForTests } from "@/server/auth";
import { resetMachineCoreTokenCache } from "@/server/core";
import {
  CORE_DIRECTORY_READ_SCOPE,
  CORE_EVENTS_READ_SCOPE,
  CORE_NOTIFICATIONS_SEND_SCOPE,
  CORE_PERMISSIONS_READ_SCOPE,
  CORE_PERMISSIONS_REGISTER_SCOPE,
} from "@/server/core-machine";
import { buildOpenApiDocument, serializeOpenApiDocument } from "@/server/openapi";
import { invalidatePermissionCache } from "@/server/permissions";
import { ROUTE_LIST } from "@/server/routes";

const API = "http://aven.localhost:3000";
const FAKE_CORE_URL = "http://core.contract.test";
const CLIENT_ID = "avenmail-web";
const CLIENT_SECRET = "sekret-klienta-tylko-do-testow";
const API_ROUTES_DIR = resolve(import.meta.dirname, "../src/app/api/v1");
const COMMITTED_OPENAPI_PATH = resolve(import.meta.dirname, "../../../openapi/avenmail-api.json");

const DUMMY_UUID_1 = "019a0000-0000-7000-8000-000000000001";

type AnyNextRouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

interface RoutePatternEntry {
  method: string;
  template: string;
  handler: AnyNextRouteHandler;
  regex: RegExp;
  paramNames: string[];
}

function compileTemplate(template: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const escaped = template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${escaped}$`), paramNames };
}

function adapt<P>(
  fn: (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>,
): AnyNextRouteHandler {
  return (request, context) => fn(request, context as unknown as { params: Promise<P> });
}

const ROUTE_HANDLERS: Readonly<Record<string, AnyNextRouteHandler>> = {
  "GET /api/v1/health": adapt(health.GET),
  "GET /api/v1/me": adapt(me.GET),
  "GET /api/v1/accounts": adapt(accounts.GET),
  "POST /api/v1/accounts": adapt(accounts.POST),
  "POST /api/v1/accounts/test": adapt(accountsTest.POST),
  "DELETE /api/v1/accounts/{id}": adapt(accountById.DELETE),
  "GET /api/v1/accounts/{id}/folders": adapt(accountFolders.GET),
  "GET /api/v1/accounts/{id}/messages": adapt(accountMessages.GET),
  "GET /api/v1/accounts/{id}/messages/{uid}": adapt(accountMessageByUid.GET),
  "PATCH /api/v1/accounts/{id}/messages/{uid}": adapt(accountMessageByUid.PATCH),
  "DELETE /api/v1/accounts/{id}/messages/{uid}": adapt(accountMessageByUid.DELETE),
  "POST /api/v1/accounts/{id}/messages/{uid}/move": adapt(accountMessageMove.POST),
  "POST /api/v1/accounts/{id}/send": adapt(accountSend.POST),
};

const COMPILED_ROUTES: RoutePatternEntry[] = Object.entries(ROUTE_HANDLERS)
  .sort(([a], [b]) => (a.includes("{") ? 1 : 0) - (b.includes("{") ? 1 : 0))
  .map(([key, handler]) => {
    const [method, template] = key.split(" ") as [string, string];
    const { regex, paramNames } = compileTemplate(template);
    return { method, template, handler, regex, paramNames };
  });

async function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  for (const entry of COMPILED_ROUTES) {
    if (entry.method !== method) continue;
    const match = entry.regex.exec(url.pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < entry.paramNames.length; i++) {
      params[entry.paramNames[i]!] = decodeURIComponent(match[i + 1]!);
    }
    const body = method === "GET" || method === "HEAD" ? undefined : await request.text();
    const nextRequest = new NextRequest(request.url, {
      method,
      headers: request.headers,
      ...(body !== undefined && body.length > 0 ? { body } : {}),
    });
    return entry.handler(nextRequest, { params: Promise.resolve(params) });
  }

  return new Response(
    JSON.stringify({
      data: null,
      meta: { requestId: "req_dispatch_404" },
      error: { code: "NOT_FOUND", message: `Nieznana trasa API: ${method} ${url.pathname}`, details: [] },
    }),
    { status: 404, headers: { "content-type": "application/json" } },
  );
}

function listRoutePathsOnDisk(dir: string, prefix = "/api/v1"): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const openApiSegment = entry.name.replace(/^\[(.+)\]$/, "{$1}");
      paths.push(...listRoutePathsOnDisk(full, `${prefix}/${openApiSegment}`));
    } else if (entry.isFile() && entry.name === "route.ts") {
      paths.push(prefix);
    }
  }
  return paths.sort();
}

function collectSchemaRefs(value: unknown, refs: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, refs);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string") {
      refs.add(entry);
    } else {
      collectSchemaRefs(entry, refs);
    }
  }
}

let fakeCore: FakeCore;

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
  process.env.CORE_AUTH_URL = FAKE_CORE_URL;
  process.env.CORE_API_URL = FAKE_CORE_URL;
  invalidatePermissionCache();
  resetMachineCoreTokenCache();
});

afterAll(() => {
  vi.restoreAllMocks();
});

const SAMPLE_ACCOUNT_INPUT = {
  email: "anna@acme.test",
  password: "haslo",
  imap: { host: "imap.acme.test", port: 993, security: "ssl" },
  smtp: { host: "smtp.acme.test", port: 465, security: "ssl" },
};

await defineProductContractTests({
  productKey: "avenmail",
  baseUrl: API,
  audience: API,
  fakeCore: () => fakeCore,
  handler: dispatch,
  routes: [
    // Trasa BFF `/me` zwraca profil i capabilities nawet przed włączeniem AvenMail i nie wymaga osobnego uprawnienia
    { method: "GET", path: "/api/v1/me", skipPermissionCheck: true, skipProductAccessCheck: true },
    { method: "GET", path: "/api/v1/accounts" },
    { method: "POST", path: "/api/v1/accounts", body: SAMPLE_ACCOUNT_INPUT },
    { method: "POST", path: "/api/v1/accounts/test", body: SAMPLE_ACCOUNT_INPUT },
    { method: "DELETE", path: `/api/v1/accounts/${DUMMY_UUID_1}` },
    { method: "GET", path: `/api/v1/accounts/${DUMMY_UUID_1}/folders` },
    { method: "GET", path: `/api/v1/accounts/${DUMMY_UUID_1}/messages?folder=INBOX` },
    { method: "GET", path: `/api/v1/accounts/${DUMMY_UUID_1}/messages/1?folder=INBOX` },
    { method: "PATCH", path: `/api/v1/accounts/${DUMMY_UUID_1}/messages/1?folder=INBOX`, body: { seen: true } },
    { method: "DELETE", path: `/api/v1/accounts/${DUMMY_UUID_1}/messages/1?folder=INBOX` },
    { method: "POST", path: `/api/v1/accounts/${DUMMY_UUID_1}/messages/1/move?folder=INBOX`, body: { to: "Archive" } },
    {
      method: "POST",
      path: `/api/v1/accounts/${DUMMY_UUID_1}/send`,
      body: { to: [{ name: null, address: "anna@acme.test" }], subject: "Test", text: "Cześć" },
    },
  ],
  openApi: () => buildOpenApiDocument(),
  openApiOptions: {
    nonPaginatedOperations: ["listAccounts", "listFolders"],
  },
});

describe("OpenAPI AvenMail API", () => {
  it("pokrywa dokładnie wszystkie pliki route.ts pod /api/v1 i wszystkie trasy w katalogu", () => {
    const document = buildOpenApiDocument();
    const diskPaths = listRoutePathsOnDisk(API_ROUTES_DIR);
    const openApiPaths = Object.keys(document.paths).sort();
    expect(openApiPaths).toEqual(diskPaths);

    const catalogOps = ROUTE_LIST.map((route) => `${route.method} ${route.path}`).sort();
    const dispatchedOps = Object.keys(ROUTE_HANDLERS).sort();
    expect(catalogOps).toEqual(dispatchedOps);
  });

  it("deklaruje schematy bezpieczeństwa bearerAuth i sessionCookie", () => {
    const document = buildOpenApiDocument();
    expect(Object.keys(document.components.securitySchemes).sort()).toEqual(["bearerAuth", "sessionCookie"]);
    expect(document.paths["/api/v1/health"]?.get?.security).toBeUndefined();
    expect(document.paths["/api/v1/me"]?.get?.security).toEqual([{ sessionCookie: [] }]);
    expect(document.paths["/api/v1/accounts"]?.get?.security).toEqual([{ bearerAuth: [] }, { sessionCookie: [] }]);
    expect(document.paths["/api/v1/accounts/{id}/send"]?.post?.security).toEqual([
      { bearerAuth: [] },
      { sessionCookie: [] },
    ]);
  });

  it("nie ma zerwanych ani nieużywanych schematów w components.schemas i zgadza się z openapi/avenmail-api.json", () => {
    const document = buildOpenApiDocument();
    const schemaNames = new Set(Object.keys(document.components.schemas));
    const usedRefs = new Set<string>();
    collectSchemaRefs(document.paths, usedRefs);
    collectSchemaRefs(document.components.schemas, usedRefs);

    for (const ref of usedRefs) {
      expect(ref.startsWith("#/components/schemas/")).toBe(true);
      expect(schemaNames.has(ref.slice("#/components/schemas/".length)), `Brakujący schemat ${ref}`).toBe(true);
    }
    for (const name of schemaNames) {
      expect(usedRefs.has(`#/components/schemas/${name}`), `Nieużywany schemat ${name}`).toBe(true);
    }

    const committed = readFileSync(COMMITTED_OPENAPI_PATH, "utf8");
    expect(JSON.parse(committed)).toEqual(document);
    expect(committed).toBe(serializeOpenApiDocument(document));
    expect(serializeOpenApiDocument(buildOpenApiDocument())).toBe(committed);
  });
});
