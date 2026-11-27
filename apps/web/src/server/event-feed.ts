import "server-only";
import { AVENMAIL_PERMISSIONS } from "@aven/contracts";
import {
  createEventConsumer,
  createEventFeedPoller,
  defineEvent,
  defineEventCatalog,
  organizationPermissionsChanged,
  type EventConsumer,
  type EventFeedPoller,
  type FeedPage,
} from "@monorise-team/events";
import type { CoreClient } from "@monorise-team/sdk";
import { z } from "zod";
import { config } from "./config";
import { getMachineCoreClient } from "./core";
import { getDb } from "./db";
import { invalidatePermissionCache } from "./permissions";

const CORE_EVENT_CONSUMER_NAME = "avenmail";
const CORE_FEED_CURSOR_ID = "core";
const DEFAULT_FEED_LIMIT = 100;

/**
 * Zdarzenie dezaktywacji konta pracownika z MonoriseCore (`05-integration/events.md`).
 * AvenMail reaguje natychmiastowym unieważnieniem pamięci podręcznej uprawnień oraz usunięciem
 * wszystkich sesji przeglądarki tego konta z tabeli `auth.sessions`.
 */
export const organizationAccountDeactivated = defineEvent({
  type: "organization.account.deactivated",
  version: 1,
  data: z.object({
    employeeId: z.string().optional(),
    authzRevision: z.number().int().nonnegative().optional(),
  }),
});

export const avenmailCoreEvents = defineEventCatalog([organizationPermissionsChanged, organizationAccountDeactivated]);

/** Minimalny podzbiór klienta transakcji potrzebny odbiorcy zdarzeń (ułatwia wstrzyknięcie atrapy w testach). */
export interface EventFeedTx {
  processedEvent: {
    findUnique(args: { where: { consumer_eventId: { consumer: string; eventId: string } } }): Promise<unknown | null>;
    create(args: { data: { consumer: string; eventId: string; processedAt: Date } }): Promise<unknown>;
  };
  session: {
    deleteMany(args: { where: { userId: string } }): Promise<unknown>;
  };
}

/** Minimalny podzbiór klienta bazy danych potrzebny kanałowi zdarzeń Core (bez danych firmowych i bez RLS). */
export interface EventFeedDb {
  $transaction<R>(fn: (tx: EventFeedTx) => Promise<R>): Promise<R>;
  eventFeedCursor: {
    findUnique(args: { where: { id: string } }): Promise<{ sequence: string } | null>;
    upsert(args: {
      where: { id: string };
      create: { id: string; sequence: string };
      update: { sequence: string };
    }): Promise<unknown>;
  };
}

export interface CreateCoreEventPollerOptions {
  db?: EventFeedDb;
  core?: Pick<CoreClient, "listProductEvents">;
  fetchPage?: (after: string | null, limit: number) => Promise<FeedPage>;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

/**
 * Tworzy idempotentnego odbiorcę zdarzeń z MonoriseCore (`@monorise-team/events`).
 * Zapisuje przetworzone identyfikatory w `processed_events`, po zdarzeniu zmiany uprawnień
 * natychmiast unieważnia pamięć podręczną migawek uprawnień, a po dezaktywacji konta
 * dodatkowo usuwa wszystkie jego sesje przeglądarki z `auth.sessions`.
 */
export function createCoreEventConsumer(db: EventFeedDb): EventConsumer {
  return createEventConsumer<EventFeedTx, typeof avenmailCoreEvents.definitions>({
    consumer: CORE_EVENT_CONSUMER_NAME,
    catalog: avenmailCoreEvents,
    transaction: (work) => db.$transaction(work),
    processed: {
      isProcessed: async (tx, consumer, eventId) =>
        Boolean(
          await tx.processedEvent.findUnique({
            where: { consumer_eventId: { consumer, eventId } },
          }),
        ),
      markProcessed: async (tx, consumer, eventId, processedAt) => {
        await tx.processedEvent.create({
          data: { consumer, eventId, processedAt },
        });
      },
    },
    handlers: {
      "organization.permissions.changed": async (event) => {
        invalidatePermissionCache({
          organizationId: event.organizationId ?? undefined,
          accountId: event.resourceId,
        });
      },
      "organization.account.deactivated": async (event, { tx }) => {
        invalidatePermissionCache({
          organizationId: event.organizationId ?? undefined,
          accountId: event.resourceId,
        });
        await tx.session.deleteMany({
          where: { userId: event.resourceId },
        });
      },
    },
  });
}

/**
 * Tworzy poller pobierający numerowany kanał zdarzeń produktu `avenmail` z MonoriseCore
 * (`GET /core/v1/products/avenmail/events`) i zapisujący kursor w tabeli `event_feed_cursors`.
 */
export function createCoreEventPoller(options: CreateCoreEventPollerOptions = {}): EventFeedPoller {
  // Po wygenerowaniu klienta Prisma (`prisma generate`) instancja PrismaClient spełnia `EventFeedDb` bezpośrednio.
  const db = options.db ?? (getDb() as unknown as EventFeedDb);
  const consumer = createCoreEventConsumer(db);
  const fetchPage =
    options.fetchPage ??
    ((after: string | null, limit: number) => {
      const core = options.core ?? getMachineCoreClient();
      return core.listProductEvents({
        path: { productKey: AVENMAIL_PERMISSIONS.product },
        query: { ...(after ? { cursor: after } : {}), limit },
      });
    });

  return createEventFeedPoller({
    consumer,
    cursor: {
      load: async () => {
        const row = await db.eventFeedCursor.findUnique({ where: { id: CORE_FEED_CURSOR_ID } });
        return row?.sequence ?? null;
      },
      save: async (sequence) => {
        await db.eventFeedCursor.upsert({
          where: { id: CORE_FEED_CURSOR_ID },
          create: { id: CORE_FEED_CURSOR_ID, sequence },
          update: { sequence },
        });
      },
    },
    fetchPage,
    limit: DEFAULT_FEED_LIMIT,
    ...(options.intervalMs !== undefined
      ? { intervalMs: options.intervalMs }
      : config.eventFeedIntervalMs > 0
        ? { intervalMs: config.eventFeedIntervalMs }
        : {}),
    onError:
      options.onError ??
      ((error) => {
        console.error("Błąd podczas pobierania zdarzeń z MonoriseCore:", error);
      }),
  });
}

// Strażnik „jeden poller na proces” we wspólnym obiekcie procesu (osobne kopie modułów w Next.js, HMR)
const processGlobal = globalThis as typeof globalThis & { __avenmailStopCoreEventPolling?: (() => void) | null };

/**
 * Uruchamia cykliczne odpytywanie kanału zdarzeń Core raz na proces, gdy `config.eventFeedIntervalMs > 0`.
 * Zwraca funkcję zatrzymującą odpytywanie.
 */
export function startCoreEventPolling(options: CreateCoreEventPollerOptions = {}): () => void {
  if (processGlobal.__avenmailStopCoreEventPolling) {
    return processGlobal.__avenmailStopCoreEventPolling;
  }

  const intervalMs = options.intervalMs ?? config.eventFeedIntervalMs;
  if (intervalMs <= 0) {
    return () => {};
  }

  const poller = createCoreEventPoller({ ...options, intervalMs });
  const stop = poller.start();
  const wrappedStop = () => {
    stop();
    if (processGlobal.__avenmailStopCoreEventPolling === wrappedStop) {
      processGlobal.__avenmailStopCoreEventPolling = null;
    }
  };
  processGlobal.__avenmailStopCoreEventPolling = wrappedStop;
  return wrappedStop;
}
