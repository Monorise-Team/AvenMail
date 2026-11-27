import { afterAll, describe, expect, it } from "vitest";
import { createDb, uuidv7, withUser, type Actor } from "../src/index.js";

// Rola aplikacji (aven_mail_app): RLS obowiązuje ją zawsze. Lokalnie: pnpm db:up && pnpm db:migrate.
const url =
  process.env.AVEN_TEST_APP_DATABASE_URL ?? "postgresql://aven_mail_app:aven_mail_app@localhost:5434/aven_mail_test";
const db = createDb(url);

const acme = uuidv7();
const globex = uuidv7();
const anna: Actor = { organizationId: acme, userId: uuidv7() };
const bartek: Actor = { organizationId: acme, userId: uuidv7() };
const celina: Actor = { organizationId: globex, userId: uuidv7() };

const mailbox = (actor: Actor, email: string) => ({
  id: uuidv7(),
  organizationId: actor.organizationId,
  userId: actor.userId,
  email,
  imapHost: "imap.acme.test",
  imapPort: 993,
  imapSecurity: "ssl" as const,
  smtpHost: "smtp.acme.test",
  smtpPort: 465,
  smtpSecurity: "ssl" as const,
  passwordCiphertext: "v1.zaszyfrowane",
});

afterAll(async () => {
  for (const actor of [anna, bartek, celina]) {
    await withUser(db, actor, (tx) => tx.mailAccount.deleteMany({}));
  }
  await db.session.deleteMany({ where: { organizationId: { in: [acme, globex] } } });
  await db.$executeRaw`DELETE FROM "public"."processed_events" WHERE "consumer" = 'avenmail-rls-test'`;
  await db.$executeRaw`DELETE FROM "public"."event_feed_cursors" WHERE "id" = 'core-rls-test'`;
  await db.$disconnect();
});

describe("RLS: skrzynki widzi tylko ich właściciel w swojej firmie", () => {
  it("rola aven_mail_app nie jest superużytkownikiem i nie ma BYPASSRLS", async () => {
    const rows = await db.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });

  it("tabela mail_accounts ma włączone i wymuszone RLS (ENABLE + FORCE ROW LEVEL SECURITY)", async () => {
    const rows = await db.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'mail_accounts'
    `;
    expect(rows).toEqual([{ relname: "mail_accounts", relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it("Anna widzi swoją skrzynkę, Bartek z tej samej firmy i Celina z innej nie", async () => {
    const own = await withUser(db, anna, (tx) => tx.mailAccount.create({ data: mailbox(anna, "anna@acme.test") }));
    expect(await withUser(db, anna, (tx) => tx.mailAccount.count())).toBe(1);
    expect(await withUser(db, bartek, (tx) => tx.mailAccount.findUnique({ where: { id: own.id } }))).toBeNull();
    expect(await withUser(db, celina, (tx) => tx.mailAccount.count())).toBe(0);
    // Bez ustawionej osoby i firmy baza nie zwraca nic
    expect(await db.mailAccount.count()).toBe(0);
  });

  it("nie da się zapisać skrzynki w cudzym imieniu ani zmienić cudzej", async () => {
    await expect(
      withUser(db, anna, (tx) => tx.mailAccount.create({ data: mailbox(bartek, "bartek@acme.test") })),
    ).rejects.toThrow();
    await expect(
      withUser(db, anna, (tx) => tx.mailAccount.create({ data: mailbox(celina, "celina@globex.test") })),
    ).rejects.toThrow();

    const bartekMailbox = await withUser(db, bartek, (tx) =>
      tx.mailAccount.create({ data: mailbox(bartek, "bartek@acme.test") }),
    );
    const changed = await withUser(db, anna, (tx) =>
      tx.mailAccount.updateMany({ where: { id: bartekMailbox.id }, data: { displayName: "przejęta" } }),
    );
    expect(changed.count).toBe(0);
    const removed = await withUser(db, celina, (tx) => tx.mailAccount.deleteMany({ where: { id: bartekMailbox.id } }));
    expect(removed.count).toBe(0);
  });

  it("sesje przeglądarki i tabele kanału zdarzeń są dostępne bez ustawionej firmy", async () => {
    const id = `skrot-${uuidv7()}`;
    await db.session.create({
      data: { id, userId: anna.userId, organizationId: acme, expiresAt: new Date(Date.now() + 60_000), data: "x" },
    });
    expect((await db.session.findUnique({ where: { id } }))?.userId).toBe(anna.userId);
    await db.session.delete({ where: { id } });

    await db.$executeRaw`
      INSERT INTO "public"."event_feed_cursors" ("id", "sequence", "updated_at")
      VALUES ('core-rls-test', '42', CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE SET "sequence" = EXCLUDED."sequence", "updated_at" = CURRENT_TIMESTAMP
    `;
    const cursors = await db.$queryRaw<{ sequence: string }[]>`
      SELECT "sequence" FROM "public"."event_feed_cursors" WHERE "id" = 'core-rls-test'
    `;
    expect(cursors).toEqual([{ sequence: "42" }]);

    const eventId = uuidv7();
    await db.$executeRaw`
      INSERT INTO "public"."processed_events" ("consumer", "event_id", "processed_at")
      VALUES ('avenmail-rls-test', ${eventId}::uuid, CURRENT_TIMESTAMP)
    `;
    const processed = await db.$queryRaw<{ eventId: string }[]>`
      SELECT "event_id"::text AS "eventId"
      FROM "public"."processed_events"
      WHERE "consumer" = 'avenmail-rls-test' AND "event_id" = ${eventId}::uuid
    `;
    expect(processed).toEqual([{ eventId }]);
  });

  it("rola aplikacji nie widzi historii migracji", async () => {
    await expect(db.$queryRaw`SELECT count(*) FROM public._prisma_migrations`).rejects.toThrow(/permission denied/);
  });
});
