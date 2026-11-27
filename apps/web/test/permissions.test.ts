/**
 * Testy uprawnień AvenMail z migawki Core, ról (Użytkownik AvenMail, Administrator AvenMail, Owner),
 * zakresów (ORGANIZATION, UNIT z poddrzewem, RESOURCE) oraz odświeżania pamięci podręcznej po `authz_rev`
 * bez bazy PostgreSQL i bez gniazd TCP (atrapa `createFakeCore` podpięta pod `globalThis.fetch`).
 */
import { AVENMAIL_PERMISSIONS } from "@aven/contracts";
import { createFakeCore, type FakeCore, type FakeOrganizationBuilder } from "@monorise-team/testing";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, route } from "@/server/api";
import type { Caller } from "@/server/auth";
import { resetMachineCoreTokenCache } from "@/server/core";
import {
  CORE_DIRECTORY_READ_SCOPE,
  CORE_EVENTS_READ_SCOPE,
  CORE_NOTIFICATIONS_SEND_SCOPE,
  CORE_PERMISSIONS_READ_SCOPE,
  CORE_PERMISSIONS_REGISTER_SCOPE,
} from "@/server/core-machine";
import {
  assertPermission,
  assertPermissionScope,
  getUserCapabilities,
  invalidatePermissionCache,
  PRODUCT_ACCESS_REQUIRED_MESSAGE,
  requireAuthorizedSnapshot,
} from "@/server/permissions";

const FAKE_CORE_URL = "http://core.local.test";
const CLIENT_ID = "avenmail-web";
const CLIENT_SECRET = "sekret-klienta-tylko-do-testow";

function makeCaller(organizationId: string, accountId: string, employeeId: string, authzRevision = 0): Caller {
  return {
    id: accountId,
    userId: accountId,
    accountId,
    organizationId,
    employeeId,
    session: null,
    token: null,
    context: {
      accountId,
      organizationId,
      employeeId,
      sessionId: "sesja-test",
      authzRevision,
      methods: [],
      clientId: CLIENT_ID,
      scopes: ["openid"],
      expiresAt: new Date(Date.now() + 60_000),
    },
  };
}

let fakeCore: FakeCore;
let acme: FakeOrganizationBuilder;
let unitKrakowId: string;
let unitMagazynId: string;
let userRoleId: string;
let adminRoleId: string;
let snapshotFault: "none" | "server-error" | "network-error" = "none";

async function coreFetchAdapter(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(rawUrl);

  if (url.pathname === "/core/v1/products/avenmail/permission-snapshot") {
    if (snapshotFault === "network-error") {
      throw new TypeError("connect ECONNREFUSED");
    }
    if (snapshotFault === "server-error") {
      return new Response(
        JSON.stringify({
          data: null,
          meta: { requestId: "req_500" },
          error: { code: "INTERNAL_ERROR", message: "Core failure", details: [] },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
  }

  return fakeCore.fetch(input, init);
}

beforeEach(async () => {
  process.env.CORE_AUTH_URL = FAKE_CORE_URL;
  process.env.CORE_API_URL = FAKE_CORE_URL;
  snapshotFault = "none";

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

  acme = fakeCore.organization({ name: "Acme", domain: "acme.test" });
  acme.grantEntitlement("avenmail");

  const krakow = acme.addUnit({ name: "Oddział Kraków", type: "BRANCH" });
  const magazyn = acme.addUnit({ name: "Magazyn", type: "TEAM", parentId: krakow.id });
  unitKrakowId = krakow.id;
  unitMagazynId = magazyn.id;

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

  invalidatePermissionCache();
  resetMachineCoreTokenCache();
  vi.spyOn(globalThis, "fetch").mockImplementation(coreFetchAdapter as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uprawnienia AvenMail z migawki MonoriseCore i pamięć podręczna", () => {
  it("odmawia dostępu (403 PRODUCT_ACCESS_REQUIRED), gdy migawka nie zawiera produktu avenmail, nawet dla Ownera", async () => {
    const noPlanOrg = fakeCore.organization({ name: "BezPlanu", domain: "bezplanu.test" });
    const owner = noPlanOrg.addEmployee({ firstName: "Anna", lastName: "Nowak", isOwner: true });

    const caller = makeCaller(noPlanOrg.id, owner.accountId, owner.employeeId);
    const error = await assertPermission(caller, AVENMAIL_PERMISSIONS.keys["mail.read"]).catch((e) => e);
    expect(error).toBeInstanceOf(ApiFailure);
    expect((error as ApiFailure).status).toBe(403);
    expect((error as ApiFailure).code).toBe("PRODUCT_ACCESS_REQUIRED");
    expect((error as ApiFailure).message).toBe(PRODUCT_ACCESS_REQUIRED_MESSAGE);

    expect(await getUserCapabilities(caller)).toEqual({
      hasProductAccess: false,
      readMail: false,
      sendMail: false,
      manageMailboxes: false,
    });
  });

  it("Użytkownik AvenMail ma mail.read i mail.send, a nie ma mailboxes.manage", async () => {
    const anna = acme.addEmployee({ firstName: "Anna", lastName: "Nowak", products: ["avenmail"] });
    acme.assignRole({
      accountId: anna.accountId,
      roleId: userRoleId,
      scope: { type: "UNIT", unitId: unitMagazynId },
    });

    const caller = makeCaller(acme.id, anna.accountId, anna.employeeId);
    await expect(assertPermission(caller, AVENMAIL_PERMISSIONS.keys["mail.read"])).resolves.toBeDefined();
    await expect(assertPermission(caller, AVENMAIL_PERMISSIONS.keys["mail.send"])).resolves.toBeDefined();
    await expect(requireAuthorizedSnapshot(caller)).resolves.toBeDefined();
    expect(await getUserCapabilities(caller)).toEqual({
      hasProductAccess: true,
      readMail: true,
      sendMail: true,
      manageMailboxes: false,
    });

    const manageError = await assertPermissionScope(caller, AVENMAIL_PERMISSIONS.keys["mailboxes.manage"]).catch(
      (e) => e,
    );
    expect(manageError).toBeInstanceOf(ApiFailure);
    expect((manageError as ApiFailure).status).toBe(403);
    expect((manageError as ApiFailure).code).toBe("PERMISSION_DENIED");

    // Wszystkie wywołania korzystały z jednej migawki w cache i jednego tokenu maszynowego
    expect(fakeCore.calls.permissionSnapshot).toBe(1);
    expect(fakeCore.calls.token).toBe(1);
  });

  it("Administrator AvenMail w UNIT obejmuje poddrzewo, a Owner dostaje zakres ORGANIZATION", async () => {
    const admin = acme.addEmployee({ firstName: "Ewa", lastName: "Kowalczyk", products: ["avenmail"] });
    acme.assignRole({
      accountId: admin.accountId,
      roleId: adminRoleId,
      scope: { type: "UNIT", unitId: unitKrakowId },
    });

    const adminCaller = makeCaller(acme.id, admin.accountId, admin.employeeId);
    const scope = await assertPermissionScope(adminCaller, AVENMAIL_PERMISSIONS.keys["mailboxes.manage"]);
    expect(scope.type).toBe("LIMITED");
    if (scope.type === "LIMITED") {
      expect(scope.unitIds).toEqual(expect.arrayContaining([unitKrakowId, unitMagazynId]));
    }
    expect(await getUserCapabilities(adminCaller)).toEqual({
      hasProductAccess: true,
      readMail: true,
      sendMail: true,
      manageMailboxes: true,
    });

    const owner = acme.addEmployee({ firstName: "Ola", lastName: "Właścicielka", isOwner: true });
    const ownerCaller = makeCaller(acme.id, owner.accountId, owner.employeeId);
    expect(await assertPermissionScope(ownerCaller, AVENMAIL_PERMISSIONS.keys["mailboxes.manage"])).toEqual({
      type: "ORGANIZATION",
    });
    expect(await getUserCapabilities(ownerCaller)).toEqual({
      hasProductAccess: true,
      readMail: true,
      sendMail: true,
      manageMailboxes: true,
    });

    const noRole = acme.addEmployee({ firstName: "Marek", lastName: "BezRoli", products: ["avenmail"] });
    const noRoleCaller = makeCaller(acme.id, noRole.accountId, noRole.employeeId);
    await expect(requireAuthorizedSnapshot(noRoleCaller)).rejects.toMatchObject({
      status: 403,
      code: "PERMISSION_DENIED",
    });
  });

  it("natychmiast odświeża migawkę w pamięci podręcznej, gdy rośnie authz_rev w tokenie", async () => {
    const anna = acme.addEmployee({ firstName: "Anna", lastName: "Nowak", products: [] });

    await expect(
      assertPermission(makeCaller(acme.id, anna.accountId, anna.employeeId, 0), AVENMAIL_PERMISSIONS.keys["mail.read"]),
    ).rejects.toMatchObject({ status: 403, code: "PRODUCT_ACCESS_REQUIRED" });
    expect(fakeCore.calls.permissionSnapshot).toBe(1);

    // Owner włącza AvenMail i nadaje rolę Użytkownik AvenMail (authz_rev rośnie do 1)
    acme.grantAppAccess(anna.accountId, "avenmail");
    acme.assignRole({ accountId: anna.accountId, roleId: userRoleId, scope: { type: "ORGANIZATION" } });
    const nextRev = acme.bumpAuthzRevision(anna.accountId);
    expect(nextRev).toBe(1);

    // Stary token (authz_rev = 0) nadal dostaje wynik z cache
    await expect(
      assertPermission(makeCaller(acme.id, anna.accountId, anna.employeeId, 0), AVENMAIL_PERMISSIONS.keys["mail.read"]),
    ).rejects.toMatchObject({ status: 403, code: "PRODUCT_ACCESS_REQUIRED" });
    expect(fakeCore.calls.permissionSnapshot).toBe(1);

    // Nowy token (authz_rev = 1) od razu odświeża migawkę bez czekania 5 minut
    await expect(
      assertPermission(
        makeCaller(acme.id, anna.accountId, anna.employeeId, nextRev),
        AVENMAIL_PERMISSIONS.keys["mail.read"],
      ),
    ).resolves.toBeDefined();
    expect(fakeCore.calls.permissionSnapshot).toBe(2);
  });

  it("zwraca 503 przez route(), gdy Core API jest niedostępne lub zwraca 500", async () => {
    const anna = acme.addEmployee({ firstName: "Anna", lastName: "Nowak", products: ["avenmail"] });
    const handler = route(async () => {
      await assertPermission(
        makeCaller(acme.id, anna.accountId, anna.employeeId),
        AVENMAIL_PERMISSIONS.keys["mail.read"],
      );
      return { ok: true };
    });

    snapshotFault = "server-error";
    const req1 = new NextRequest("http://aven.localhost:3000/api/v1/me");
    const res1 = await handler(req1, { params: Promise.resolve({}) });
    expect(res1.status).toBe(503);

    snapshotFault = "network-error";
    const req2 = new NextRequest("http://aven.localhost:3000/api/v1/me");
    const res2 = await handler(req2, { params: Promise.resolve({}) });
    expect(res2.status).toBe(503);
  });
});
