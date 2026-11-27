/**
 * Testy separacji firm na bazie PostgreSQL (ADR-0037) za pomocą `checkTenantIsolation`
 * z `@monorise-team/testing` dla tabeli `mail_accounts`.
 *
 * Wymaga uruchomionej bazy testowej (`pnpm db:up && pnpm db:migrate`, rola `aven_mail_app` z RLS).
 */
import { uuidv7, withUser, type Actor } from "@aven/db";
import { checkTenantIsolation, formatViolations } from "@monorise-team/testing";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";

afterAll(async () => {
  await getDb().$disconnect();
});

describe("Separacja firm w bazie danych (checkTenantIsolation, ADR-0037)", () => {
  it("withUser: firma B nigdy nie odczytuje skrzynek pocztowych firmy A", async () => {
    const db = getDb();
    const actorsByTenant = new Map<string, Actor>();

    const actorFor = (tenantId: string): Actor => {
      let actor = actorsByTenant.get(tenantId);
      if (!actor) {
        actor = { organizationId: tenantId, userId: uuidv7() };
        actorsByTenant.set(tenantId, actor);
      }
      return actor;
    };

    const result = await checkTenantIsolation({
      seedAsTenant: async (tenantId) => {
        const actor = actorFor(tenantId);
        await withUser(db, actor, (tx) =>
          tx.mailAccount.create({
            data: {
              id: uuidv7(),
              organizationId: actor.organizationId,
              userId: actor.userId,
              email: `anna-${actor.userId.slice(0, 8)}@acme.test`,
              displayName: "Anna Nowak",
              imapHost: "imap.acme.test",
              imapPort: 993,
              imapSecurity: "ssl",
              smtpHost: "smtp.acme.test",
              smtpPort: 465,
              smtpSecurity: "ssl",
              passwordCiphertext: "v1.zaszyfrowane",
            },
          }),
        );
      },
      readAsTenant: async (tenantId) => {
        const actor = actorFor(tenantId);
        return withUser(db, actor, (tx) =>
          tx.mailAccount.findMany({ select: { id: true, organizationId: true, userId: true } }),
        );
      },
      cleanup: async ({ tenantAId, tenantBId }) => {
        for (const tenantId of [tenantAId, tenantBId]) {
          const actor = actorsByTenant.get(tenantId);
          if (actor) {
            await withUser(db, actor, (tx) => tx.mailAccount.deleteMany({}));
          }
        }
      },
    });

    expect(result.passed, formatViolations(result.violations)).toBe(true);
  });
});
