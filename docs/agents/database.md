# Baza danych AvenMail

AvenMail korzysta z bazy PostgreSQL 17 i Prisma 7 w paczce `packages/db` (`@aven/db`, ADR-0096). Lokalnie baza działa w Dockerze na porcie `5434` (kontener `aven-mail-postgres-1`), żeby nie kolidować z Core (`5433`), TimoTime (`5435`) i KivoTasks (`5436`).

## Role i bazy (`docker/postgres-init.sql`)

- **`aven_mail_owner`**: właściciel baz `aven_mail` oraz `aven_mail_test`, uruchamia migracje (`packages/db/.env`, `pnpm db:migrate`).
- **`aven_mail_app`**: rola aplikacji (`apps/web/.env.local`), nie jest właścicielem tabel, nie ma `SUPERUSER` ani `BYPASSRLS`. Ma `USAGE` na schematach `public` i `auth` oraz `SELECT, INSERT, UPDATE, DELETE` na tabelach (z wyłączeniem `public._prisma_migrations`, na której uprawnienia są cofnięte).

## Tabele i migracje (`packages/db/prisma/schema.prisma`)

### Migracje początkowe (`20261123000000_init`, `20261123000001_rls`)

Definiują typ wyliczeniowy `mail_security` (`ssl`, `starttls`, `none`), funkcje pomocnicze RLS oraz tabele sesji i skrzynek:

| Tabela          | Schemat  | RLS | Przeznaczenie                                                                                                                                                                         |
| --------------- | -------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions`      | `auth`   | Nie | Zaszyfrowane sesje przeglądarki (BFF, `@monorise-team/auth`). Serwer szuka ich po skrócie identyfikatora z ciasteczka przed poznaniem firmy.                                          |
| `mail_accounts` | `public` | Tak | Podłączone skrzynki IMAP/SMTP (`id`, `organization_id`, `user_id`, `email`, hosty, porty, szyfrowanie, zaszyfrowane hasło `password_ciphertext`). Nigdy nie przechowuje treści maili. |

### Migracja kanału zdarzeń Core (`20261127000000_core_event_feed`)

Dodaje tabele techniczne odbiorcy `@monorise-team/events` (ADR-0100) wraz z jawnymi uprawnieniami `SELECT, INSERT, UPDATE, DELETE` dla roli `aven_mail_app`:

| Tabela               | Schemat  | RLS | Przeznaczenie                                                                                           |
| -------------------- | -------- | --- | ------------------------------------------------------------------------------------------------------- |
| `event_feed_cursors` | `public` | Nie | Ostatni przetworzony numer `sequence` dla kanału zdarzeń Core (`id = "core"`). Bez danych firmowych.    |
| `processed_events`   | `public` | Nie | Deduplikacja zdarzeń `(consumer, event_id)` dla odbiorcy `@monorise-team/events`. Bez danych firmowych. |

## Funkcje pomocnicze RLS i `withUser`

Migracja `20261123000001_rls` definiuje dwie stabilne funkcje SQL odczytujące zmienne lokalne transakcji:

- `public.current_organization_id() RETURNS uuid` (czyta `app.organization_id`),
- `public.current_app_user_id() RETURNS uuid` (czyta `app.user_id`).

Tabela `public.mail_accounts` ma włączone i wymuszone RLS (`ENABLE` + `FORCE ROW LEVEL SECURITY`) oraz politykę `owner_isolation`:

- `USING ("organization_id" = "public"."current_organization_id"() AND "user_id" = "public"."current_app_user_id"())`
- `WITH CHECK ("organization_id" = "public"."current_organization_id"() AND "user_id" = "public"."current_app_user_id"())`

Skrzynkę widzi wyłącznie jej właściciel w swojej firmie (np. pracownica Anna w firmie Acme nie zobaczy skrzynek innej osoby z Acme ani z innej firmy).

Po stronie TypeScript zmienne ustawia wyłącznie `withUser(db, user, fn)` w `packages/db/src/index.ts`:

- waliduje format UUID w `user.organizationId` i `user.id` przed otwarciem transakcji,
- uruchamia `SELECT set_config('app.organization_id', ..., true), set_config('app.user_id', ..., true)` wewnątrz `db.$transaction`,
- po zakończeniu transakcji zmienne znikają i nie przeciekają na inne połączenia z puli.

Połączeń z serwerami poczty (IMAP/SMTP) nigdy nie prowadzimy wewnątrz transakcji `withUser`: najpierw odczytujemy konfigurację skrzynki i zamykamy transakcję, a dopiero potem łączymy się z serwerem poczty.

## Zasady dla kolejnych migracji

1. Edytuj `packages/db/prisma/schema.prisma`, wygeneruj klienta (`pnpm --filter @aven/db build`) i przygotuj nową migrację (`pnpm --filter @aven/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`) w nowym katalogu pod `packages/db/prisma/migrations/`.
2. Każda nowa tabela z danymi osób albo firm musi dostać w tej samej migracji `ENABLE` + `FORCE ROW LEVEL SECURITY`, polityki `USING` i `WITH CHECK` korzystające z `public.current_organization_id()` (i w razie potrzeby `public.current_app_user_id()`) oraz uprawnienia dla roli `aven_mail_app`.
3. Dodaj testy izolacji w `packages/db/test/rls.test.ts` i `apps/web/test/tenant-isolation.test.ts` (`checkTenantIsolation` z `@monorise-team/testing`).
4. Zmiany w strukturze bazy scalamy dopiero po zgodzie właściciela projektu.

## Testy bazy

- `packages/db/test/rls.test.ts`: sprawdza uprawnienia roli `aven_mail_app` (brak `SUPERUSER`/`BYPASSRLS`), wymuszone RLS (`relrowsecurity` i `relforcerowsecurity`) oraz izolację `mail_accounts` między osobami i firmami, tabele techniczne kanału zdarzeń oraz odmowę dostępu do `public._prisma_migrations`.
- `apps/web/test/tenant-isolation.test.ts`: sprawdza separację między firmami przez `checkTenantIsolation` z `@monorise-team/testing`.
- Oba pliki wymagają uruchomionego PostgreSQL (`pnpm db:up && pnpm db:migrate`).
