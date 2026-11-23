-- Separacja firm i osób (ADR-0037): uprawnienia roli aplikacji i RLS.
-- ── Uprawnienia roli aplikacji ─────────────────────────────────────────────────────────────────────
-- aven_mail_app pracuje na danych, ale nie jest właścicielem tabel i nie omija RLS.
GRANT USAGE ON SCHEMA "public", "auth" TO aven_mail_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public", "auth" TO aven_mail_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public", "auth" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aven_mail_app;
-- Historia migracji Prismy nie jest dla aplikacji (tabela powstaje przed tą migracją przy prisma migrate).
DO $$ BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON "public"."_prisma_migrations" FROM aven_mail_app;
  END IF;
END $$;

-- ── Osoba i firma ze zmiennych transakcji ustawianych przez serwer (withUser w @aven/db) ─────────────
--   SELECT set_config('app.organization_id', '<uuid>', true), set_config('app.user_id', '<uuid>', true)
-- Bez nich polityki nie zwracają żadnego wiersza i nie pozwalają nic zapisać.
CREATE FUNCTION "public"."current_organization_id"() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;

CREATE FUNCTION "public"."current_app_user_id"() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- ── Skrzynki: prywatne dla właściciela w jego firmie ────────────────────────────────────────────────
-- Anna z Acme widzi tylko swoje skrzynki; inna osoba z Acme ani nikt z innej firmy ich nie zobaczy.
ALTER TABLE "public"."mail_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."mail_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "public"."mail_accounts"
  USING (
    "organization_id" = "public"."current_organization_id"()
    AND "user_id" = "public"."current_app_user_id"()
  )
  WITH CHECK (
    "organization_id" = "public"."current_organization_id"()
    AND "user_id" = "public"."current_app_user_id"()
  );

-- Sesje przeglądarki (auth.sessions) są bez RLS: serwer szuka ich po skrócie identyfikatora z ciasteczka,
-- zanim wie, czyja to sesja. Tokeny w sesji są zaszyfrowane kluczem aplikacji (@monorise-team/auth).
