/**
 * Testy odbioru zdarzeń z kanału MonoriseCore (`event-feed.ts`) i konfiguracji interwału odpytywania.
 * Działają w pamięci (atrapa bazy Prisma oraz `createFakeCore` z `@monorise-team/testing`), bez PostgreSQL.
 */
import { AVENMAIL_PERMISSIONS } from "@aven/contracts";
import { organizationPermissionsChanged, uuidv7 } from "@monorise-team/events";
import { createFakeCore } from "@monorise-team/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Caller } from "@/server/auth";
import { config } from "@/server/config";
import { resetMachineCoreTokenCache } from "@/server/core";
import {
  CORE_DIRECTORY_READ_SCOPE,
  CORE_EVENTS_READ_SCOPE,
  CORE_NOTIFICATIONS_SEND_SCOPE,
  CORE_PERMISSIONS_READ_SCOPE,
  CORE_PERMISSIONS_REGISTER_SCOPE,
} from "@/server/core-machine";
import {
  createCoreEventConsumer,
  createCoreEventPoller,
  organizationAccountDeactivated,
  startCoreEventPolling,
  type EventFeedDb,
  type EventFeedTx,
} from "@/server/event-feed";
import * as permissionsModule from "@/server/permissions";

const FAKE_CORE_URL = "http://core.local.test";
const CLIENT_ID = "avenmail-web";
const CLIENT_SECRET = "sekret-klienta-tylko-do-testow";

interface FakeEventDb extends EventFeedDb {
  processedKeys: Set<string>;
  cursors: Map<string, string>;
  sessions: Map<string, { id: string; userId: string }>;
  failSessionDelete?: boolean;
}

function createFakeEventDb(initialCursor?: string): FakeEventDb {
  const processedKeys = new Set<string>();
  const cursors = new Map<string, string>();
  const sessions = new Map<string, { id: string; userId: string }>();
  if (initialCursor !== undefined) {
    cursors.set("core", initialCursor);
  }

  const db: FakeEventDb = {
    processedKeys,
    cursors,
    sessions,
    failSessionDelete: false,
    async $transaction<R>(fn: (tx: EventFeedTx) => Promise<R>): Promise<R> {
      const processedSnapshot = new Set(processedKeys);
      const sessionsSnapshot = new Map(sessions);
      const tx: EventFeedTx = {
        processedEvent: {
          async findUnique({ where }) {
            const key = `${where.consumer_eventId.consumer}:${where.consumer_eventId.eventId}`;
            return processedKeys.has(key) ? { eventId: where.consumer_eventId.eventId } : null;
          },
          async create({ data }) {
            const key = `${data.consumer}:${data.eventId}`;
            if (processedKeys.has(key)) {
              throw new Error(`Duplicate processed event: ${key}`);
            }
            processedKeys.add(key);
            return data;
          },
        },
        session: {
          async deleteMany({ where }) {
            if (db.failSessionDelete) {
              throw new Error("Błąd usuwania sesji");
            }
            let count = 0;
            for (const [id, session] of sessions) {
              if (session.userId === where.userId) {
                sessions.delete(id);
                count += 1;
              }
            }
            return { count };
          },
        },
      };
      try {
        return await fn(tx);
      } catch (error) {
        processedKeys.clear();
        for (const key of processedSnapshot) {
          processedKeys.add(key);
        }
        sessions.clear();
        for (const [id, session] of sessionsSnapshot) {
          sessions.set(id, session);
        }
        throw error;
      }
    },
    eventFeedCursor: {
      async findUnique({ where }) {
        const sequence = cursors.get(where.id);
        return sequence !== undefined ? { sequence } : null;
      },
      async upsert({ where, create, update }) {
        const next = cursors.has(where.id) ? update.sequence : create.sequence;
        cursors.set(where.id, next);
        return { id: where.id, sequence: next };
      },
    },
  };
  return db;
}

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

function makePermissionsChangedEvent(options: {
  organizationId: string;
  accountId: string;
  authzRevision: number;
  sequence: string;
  id?: string;
}) {
  const envelope = organizationPermissionsChanged.create({
    id: options.id ?? uuidv7(),
    source: "core",
    organizationId: options.organizationId,
    resourceType: "account",
    resourceId: options.accountId,
    resourceVersion: options.authzRevision,
    data: { authzRevision: options.authzRevision },
  });
  return {
    ...envelope,
    organizationId: options.organizationId,
    source: "core" as const,
    sequence: options.sequence,
  };
}

function makeAccountDeactivatedEvent(options: {
  organizationId: string;
  accountId: string;
  employeeId?: string;
  authzRevision?: number;
  sequence: string;
  id?: string;
}) {
  const envelope = organizationAccountDeactivated.create({
    id: options.id ?? uuidv7(),
    source: "core",
    organizationId: options.organizationId,
    resourceType: "account",
    resourceId: options.accountId,
    resourceVersion: options.authzRevision ?? 1,
    data: {
      ...(options.employeeId ? { employeeId: options.employeeId } : {}),
      ...(options.authzRevision !== undefined ? { authzRevision: options.authzRevision } : {}),
    },
  });
  return {
    ...envelope,
    organizationId: options.organizationId,
    source: "core" as const,
    sequence: options.sequence,
  };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  permissionsModule.invalidatePermissionCache();
  resetMachineCoreTokenCache();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("odbiór zdarzeń z kanału Core (event-feed)", () => {
  it("po zdarzeniu organization.permissions.changed unieważnia cache i kolejne zapytanie odświeża migawkę z Core", async () => {
    process.env.CORE_AUTH_URL = FAKE_CORE_URL;
    process.env.CORE_API_URL = FAKE_CORE_URL;

    const fakeCore = await createFakeCore({
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
    vi.spyOn(globalThis, "fetch").mockImplementation(fakeCore.fetch as typeof fetch);

    const acme = fakeCore.organization({ name: "Acme", domain: "acme.test" });
    acme.grantEntitlement("avenmail");
    const userRole = acme.addRole({
      name: "Użytkownik AvenMail",
      product: "avenmail",
      permissions: [AVENMAIL_PERMISSIONS.keys["mail.read"], AVENMAIL_PERMISSIONS.keys["mail.send"]],
    });

    const anna = acme.addEmployee({ firstName: "Anna", lastName: "Nowak", products: [] });
    const piotr = acme.addEmployee({ firstName: "Piotr", lastName: "Zieliński", products: ["avenmail"] });
    acme.assignRole({ accountId: piotr.accountId, roleId: userRole.id, scope: { type: "ORGANIZATION" } });

    const annaCaller = makeCaller(acme.id, anna.accountId, anna.employeeId, 0);
    const piotrCaller = makeCaller(acme.id, piotr.accountId, piotr.employeeId, 0);

    await expect(
      permissionsModule.assertPermission(annaCaller, AVENMAIL_PERMISSIONS.keys["mail.read"]),
    ).rejects.toMatchObject({ status: 403, code: "PRODUCT_ACCESS_REQUIRED" });
    await expect(
      permissionsModule.assertPermission(piotrCaller, AVENMAIL_PERMISSIONS.keys["mail.read"]),
    ).resolves.toBeDefined();
    expect(fakeCore.calls.permissionSnapshot).toBe(2);

    acme.grantAppAccess(anna.accountId, "avenmail");
    acme.assignRole({ accountId: anna.accountId, roleId: userRole.id, scope: { type: "ORGANIZATION" } });
    const nextRev = acme.bumpAuthzRevision(anna.accountId);

    const db = createFakeEventDb();
    const invalidateSpy = vi.spyOn(permissionsModule, "invalidatePermissionCache");
    const poller = createCoreEventPoller({
      db,
      fetchPage: async () => ({
        items: [
          makePermissionsChangedEvent({
            organizationId: acme.id,
            accountId: anna.accountId,
            authzRevision: nextRev,
            sequence: "1",
          }),
        ],
        nextCursor: null,
      }),
    });

    const summary = await poller.runOnce();
    expect(summary).toMatchObject({ processed: 1, duplicate: 0, ignored: 0, cursor: "1", caughtUp: true });
    expect(invalidateSpy).toHaveBeenCalledWith({ organizationId: acme.id, accountId: anna.accountId });

    // Migawka Anny odświeża się mimo starego authz_rev = 0, a migawka Piotra zostaje w cache
    await expect(
      permissionsModule.assertPermission(annaCaller, AVENMAIL_PERMISSIONS.keys["mail.read"]),
    ).resolves.toBeDefined();
    expect(fakeCore.calls.permissionSnapshot).toBe(3);

    await expect(
      permissionsModule.assertPermission(piotrCaller, AVENMAIL_PERMISSIONS.keys["mail.read"]),
    ).resolves.toBeDefined();
    expect(fakeCore.calls.permissionSnapshot).toBe(3);
  });

  it("po zdarzeniu organization.account.deactivated unieważnia cache i usuwa wszystkie sesje wyłączonego konta", async () => {
    const db = createFakeEventDb();
    const organizationId = uuidv7();
    const annaId = uuidv7();
    const piotrId = uuidv7();
    const employeeId = uuidv7();

    db.sessions.set("sess-anna-1", { id: "sess-anna-1", userId: annaId });
    db.sessions.set("sess-anna-2", { id: "sess-anna-2", userId: annaId });
    db.sessions.set("sess-piotr-1", { id: "sess-piotr-1", userId: piotrId });

    const invalidateSpy = vi.spyOn(permissionsModule, "invalidatePermissionCache");
    const poller = createCoreEventPoller({
      db,
      fetchPage: async () => ({
        items: [
          makeAccountDeactivatedEvent({
            organizationId,
            accountId: annaId,
            employeeId,
            authzRevision: 4,
            sequence: "7",
          }),
        ],
        nextCursor: null,
      }),
    });

    const summary = await poller.runOnce();
    expect(summary).toMatchObject({ processed: 1, duplicate: 0, ignored: 0, cursor: "7", caughtUp: true });
    expect(invalidateSpy).toHaveBeenCalledWith({ organizationId, accountId: annaId });
    expect([...db.sessions.keys()]).toEqual(["sess-piotr-1"]);
  });

  it("wycofuje transakcję przy błędzie usuwania sesji po dezaktywacji i ponawia przy kolejnym cyklu", async () => {
    const db = createFakeEventDb("6");
    const organizationId = uuidv7();
    const annaId = uuidv7();
    const eventId = uuidv7();
    db.sessions.set("sess-anna-1", { id: "sess-anna-1", userId: annaId });
    db.failSessionDelete = true;

    const poller = createCoreEventPoller({
      db,
      fetchPage: async () => ({
        items: [
          makeAccountDeactivatedEvent({
            id: eventId,
            organizationId,
            accountId: annaId,
            authzRevision: 5,
            sequence: "7",
          }),
        ],
        nextCursor: null,
      }),
    });

    await expect(poller.runOnce()).rejects.toThrow("Błąd usuwania sesji");
    expect(db.cursors.get("core")).toBe("6");
    expect(db.processedKeys.size).toBe(0);
    expect(db.sessions.has("sess-anna-1")).toBe(true);

    db.failSessionDelete = false;
    const retry = await poller.runOnce();
    expect(retry).toMatchObject({ processed: 1, cursor: "7" });
    expect(db.cursors.get("core")).toBe("7");
    expect(db.processedKeys).toEqual(new Set([`avenmail:${eventId}`]));
    expect(db.sessions.size).toBe(0);
  });

  it("obsługuje duplikat zdarzenia o tym samym id dokładnie raz", async () => {
    const db = createFakeEventDb();
    const invalidateSpy = vi.spyOn(permissionsModule, "invalidatePermissionCache");
    const duplicateId = uuidv7();
    const organizationId = uuidv7();
    const accountId = uuidv7();

    const poller = createCoreEventPoller({
      db,
      fetchPage: async () => ({
        items: [
          makePermissionsChangedEvent({
            id: duplicateId,
            organizationId,
            accountId,
            authzRevision: 1,
            sequence: "10",
          }),
          makePermissionsChangedEvent({
            id: duplicateId,
            organizationId,
            accountId,
            authzRevision: 1,
            sequence: "11",
          }),
        ],
        nextCursor: null,
      }),
    });

    const summary = await poller.runOnce();
    expect(summary).toMatchObject({ processed: 1, duplicate: 1, cursor: "11" });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(db.processedKeys).toEqual(new Set([`avenmail:${duplicateId}`]));
  });

  it("zapisuje kursor i przy kolejnym pobraniu przekazuje go jako cursor dla produktu avenmail", async () => {
    const db = createFakeEventDb();
    const seenCursors: Array<string | null> = [];
    const seenQueries: Array<{ path: { productKey: string }; query?: { cursor?: string; limit?: number } }> = [];

    const poller = createCoreEventPoller({
      db,
      core: {
        async listProductEvents(input) {
          seenQueries.push(input);
          seenCursors.push(input.query?.cursor ?? null);
          if (!input.query?.cursor) {
            return {
              items: [
                makePermissionsChangedEvent({
                  organizationId: uuidv7(),
                  accountId: uuidv7(),
                  authzRevision: 1,
                  sequence: "5",
                }),
              ],
              nextCursor: null,
            };
          }
          return {
            items: [
              makePermissionsChangedEvent({
                organizationId: uuidv7(),
                accountId: uuidv7(),
                authzRevision: 2,
                sequence: "6",
              }),
            ],
            nextCursor: null,
          };
        },
      },
    });

    const first = await poller.runOnce();
    expect(first).toMatchObject({ processed: 1, cursor: "5" });
    expect(db.cursors.get("core")).toBe("5");

    const second = await poller.runOnce();
    expect(second).toMatchObject({ processed: 1, cursor: "6" });
    expect(db.cursors.get("core")).toBe("6");
    expect(seenCursors).toEqual([null, "5"]);
    expect(seenQueries).toEqual([
      { path: { productKey: "avenmail" }, query: { limit: 100 } },
      { path: { productKey: "avenmail" }, query: { cursor: "5", limit: 100 } },
    ]);
  });

  it("ignoruje nieznany typ zdarzenia i mimo to przesuwa kursor", async () => {
    const db = createFakeEventDb("2");
    const invalidateSpy = vi.spyOn(permissionsModule, "invalidatePermissionCache");

    const poller = createCoreEventPoller({
      db,
      fetchPage: async () => ({
        items: [
          {
            id: uuidv7(),
            type: "organization.unknown.event",
            version: 1,
            source: "core",
            organizationId: uuidv7(),
            resourceType: "account",
            resourceId: uuidv7(),
            resourceVersion: 1,
            occurredAt: new Date().toISOString(),
            data: { extra: true },
            sequence: "3",
          },
        ],
        nextCursor: null,
      }),
    });

    const summary = await poller.runOnce();
    expect(summary).toMatchObject({ processed: 0, ignored: 1, cursor: "3" });
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(db.cursors.get("core")).toBe("3");
    expect(db.processedKeys.size).toBe(0);
  });

  it("createCoreEventConsumer obsługuje pojedyncze zdarzenie bezpośrednio z pominięciem duplikatu", async () => {
    const db = createFakeEventDb();
    const invalidateSpy = vi.spyOn(permissionsModule, "invalidatePermissionCache");
    const consumer = createCoreEventConsumer(db);
    const envelope = organizationPermissionsChanged.create({
      source: "core",
      organizationId: uuidv7(),
      resourceType: "account",
      resourceId: uuidv7(),
      resourceVersion: 1,
      data: { authzRevision: 1 },
    });

    expect(await consumer.handle(envelope)).toBe("processed");
    expect(await consumer.handle(envelope)).toBe("duplicate");
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("startCoreEventPolling uruchamia odpytywanie najwyżej raz na proces i nic nie robi przy interwale 0", async () => {
    const fetchPage = vi.fn(async () => ({ items: [], nextCursor: null }));
    const db = createFakeEventDb();

    vi.stubEnv("NODE_ENV", "production");
    delete process.env.AVEN_EVENT_FEED_INTERVAL_MS;
    const noopStop = startCoreEventPolling({ db, fetchPage });
    expect(fetchPage).not.toHaveBeenCalled();
    noopStop();

    vi.stubEnv("AVEN_EVENT_FEED_INTERVAL_MS", "250");
    const stop1 = startCoreEventPolling({ db, fetchPage });
    const stop2 = startCoreEventPolling({ db, fetchPage });
    expect(stop2).toBe(stop1);
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));
    stop1();
  });
});

describe("konfiguracja AVEN_EVENT_FEED_INTERVAL_MS", () => {
  it("domyślnie wynosi 5000 w trybie development i 0 w pozostałych środowiskach", () => {
    delete process.env.AVEN_EVENT_FEED_INTERVAL_MS;

    vi.stubEnv("NODE_ENV", "development");
    expect(config.eventFeedIntervalMs).toBe(5000);

    vi.stubEnv("NODE_ENV", "production");
    expect(config.eventFeedIntervalMs).toBe(0);

    vi.stubEnv("NODE_ENV", "test");
    expect(config.eventFeedIntervalMs).toBe(0);
  });

  it("respektuje jawnie ustawioną liczbę całkowitą >= 0 oraz zamienia niepoprawne wartości na 0", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.AVEN_EVENT_FEED_INTERVAL_MS = "0";
    expect(config.eventFeedIntervalMs).toBe(0);

    vi.stubEnv("NODE_ENV", "production");
    process.env.AVEN_EVENT_FEED_INTERVAL_MS = "2500";
    expect(config.eventFeedIntervalMs).toBe(2500);

    for (const invalid of ["abc", "-100", "12.5", "100ms", "Infinity"]) {
      process.env.AVEN_EVENT_FEED_INTERVAL_MS = invalid;
      expect(config.eventFeedIntervalMs).toBe(0);
    }
  });
});
