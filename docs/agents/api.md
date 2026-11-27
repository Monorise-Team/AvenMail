# API, kontrakty i testy AvenMail

API AvenMail działa pod ścieżką `/api/v1/*` na hoście `aven.monorise.studio` (lokalnie `http://aven.localhost:3000/api/v1`).

## Standard odpowiedzi i obsługa tras (`apps/web/src/server/api.ts`)

- Każda trasa w `apps/web/src/app/api/v1/**/route.ts` jest opakowana w `route()` z `src/server/api.ts`.
- Każda odpowiedź ustawia `Cache-Control: no-store` i używa koperty `{ data, meta: { requestId }, error }` (ADR-0044); odpowiedzi `204` zwracają puste ciało.
- Błędy domenowe rzucane są przez `ApiFailure(status, code, message, details)` ze stałymi kodami `ERROR_CODES` z `@aven/contracts` (`UNAUTHENTICATED`, `PRODUCT_ACCESS_REQUIRED`, `PERMISSION_DENIED`, `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `MAIL_AUTH_FAILED`, `MAIL_CONNECTION_FAILED`, `MAIL_HOST_NOT_ALLOWED`, `MAIL_TIMEOUT`, `MAIL_REJECTED`, `INTERNAL_ERROR`).
- Błędy `MailError`, `ZodError`, `AuthError`, `PermissionError`, `CoreApiError` i `CoreMachineTokenError` są automatycznie mapowane na spójne kody HTTP i polskie komunikaty bez ujawniania treści maili, haseł ani tokenów.
- Żądania mutujące z ciasteczkiem sesji (bez nagłówka `Authorization`) przechodzą kontrolę `assertSameOrigin` (CSRF). Dla pochodzeń z `AVEN_ALLOWED_ORIGINS` dokładane są nagłówki CORS.

## Autoryzacja w aplikacji (`apps/web/src/server/permissions.ts`)

Każda chroniona trasa poza `GET /api/v1/me` wymaga obecności produktu `"avenmail"` w migawce uprawnień z MonoriseCore (inaczej zwraca `403 PRODUCT_ACCESS_REQUIRED`) oraz właściwego uprawnienia (inaczej `403 PERMISSION_DENIED`):

- Lista skrzynek (`GET /api/v1/accounts`): dostęp do produktu i co najmniej jedno uprawnienie z zestawu `avenmail.*`.
- Dodawanie, testowanie i usuwanie skrzynek (`POST /api/v1/accounts`, `POST /api/v1/accounts/test`, `DELETE /api/v1/accounts/{id}`): `avenmail.mailboxes.manage`.
- Foldery i operacje na wiadomościach (`GET /folders`, `GET /messages`, `GET/PATCH/DELETE /messages/{uid}`, `POST /messages/{uid}/move`): `avenmail.mail.read`.
- Wysyłka wiadomości (`POST /api/v1/accounts/{id}/send`): `avenmail.mail.send`.
- Każda operacja na zapisanej skrzynce dodatkowo działa w transakcji `withUser` (RLS ogranicza odczyt wyłącznie do właściciela skrzynki w jego firmie). Gdy operacja na podłączonej skrzynce zwróci `MAIL_AUTH_FAILED`, pomocnik `withConnectedMailbox` zleca best-effort powiadomienie `avenmail.alerts` w Core.

## Katalog tras (`/api/v1`)

### System i sesja

| Metoda i ścieżka     | Uwierzytelnienie            | Opis                                                                                                                                                                                                       |
| -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health` | Publiczna                   | Zwraca `{ status: "ok", version }` bez odpytywania bazy, skrzynek i MonoriseCore.                                                                                                                          |
| `GET /api/v1/me`     | Sesja BFF (`sessionCookie`) | Pobiera profil osoby i firmy z Core (`GET /core/v1/me`) oraz `capabilities` (`hasProductAccess`, `readMail`, `sendMail`, `manageMailboxes`). Wywołania z tokenem `Bearer` dostają `403 PERMISSION_DENIED`. |

Trasy logowania BFF (poza `/api/v1`, bez koperty JSON): `GET /api/auth/sign-in`, `GET /api/auth/callback`, `POST /api/auth/sign-out`.

### Skrzynki pocztowe

| Metoda i ścieżka               | Uwierzytelnienie | Uprawnienie                 | Opis                                                                            |
| ------------------------------ | ---------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/v1/accounts`         | `user`           | dowolne `avenmail.*`        | Lista podłączonych skrzynek zalogowanej osoby w jej firmie (bez haseł).         |
| `POST /api/v1/accounts`        | `user`           | `avenmail.mailboxes.manage` | Weryfikuje połączenie IMAP/SMTP, szyfruje hasło i zapisuje skrzynkę (`201`).    |
| `POST /api/v1/accounts/test`   | `user`           | `avenmail.mailboxes.manage` | Sprawdza logowanie do IMAP i SMTP bez zapisywania danych w bazie.               |
| `DELETE /api/v1/accounts/{id}` | `user`           | `avenmail.mailboxes.manage` | Usuwa konfigurację skrzynki z AvenMail (u dostawcy poczty pozostaje bez zmian). |

### Foldery, wiadomości i wysyłka

| Metoda i ścieżka                                 | Uwierzytelnienie | Uprawnienie          | Opis                                                                                            |
| ------------------------------------------------ | ---------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /api/v1/accounts/{id}/folders`              | `user`           | `avenmail.mail.read` | Lista folderów IMAP i liczniki nieprzeczytanych wiadomości.                                     |
| `GET /api/v1/accounts/{id}/messages`             | `user`           | `avenmail.mail.read` | Strona nagłówków i podglądów wiadomości z folderu (`folder`, `page`, `pageSize`).               |
| `GET /api/v1/accounts/{id}/messages/{uid}`       | `user`           | `avenmail.mail.read` | Pełna treść pojedynczej wiadomości pobrana na żądanie z IMAP (`?folder=...`).                   |
| `PATCH /api/v1/accounts/{id}/messages/{uid}`     | `user`           | `avenmail.mail.read` | Aktualizacja flag `seen` i `flagged` wiadomości w folderze (`?folder=...`).                     |
| `DELETE /api/v1/accounts/{id}/messages/{uid}`    | `user`           | `avenmail.mail.read` | Przeniesienie wiadomości do kosza albo trwałe usunięcie z kosza (`?folder=...`).                |
| `POST /api/v1/accounts/{id}/messages/{uid}/move` | `user`           | `avenmail.mail.read` | Przeniesienie wiadomości do docelowego folderu IMAP (`?folder=...`, `{ to }`).                  |
| `POST /api/v1/accounts/{id}/send`                | `user`           | `avenmail.mail.send` | Wysłanie wiadomości przez SMTP i zapis kopii w folderze Wysłane (gdy serwer nie robi tego sam). |

## Katalog tras i OpenAPI 3.1

- Jednym źródłem prawdy dla OpenAPI jest `apps/web/src/server/routes.ts` połączony ze schematami Zod z `packages/contracts/src/index.ts`.
- `apps/web/src/server/openapi.ts` generuje deterministyczny dokument OpenAPI 3.1.0 zapisywany w `openapi/avenmail-api.json`.
- Po każdej zmianie tras albo schematów uruchom `pnpm openapi`; CI sprawdza aktualność pliku przez `pnpm openapi:check`.
- Testy w `apps/web/test/contract.test.ts` pilnują, aby `openapi/avenmail-api.json` pokrywał dokładnie wszystkie pliki `route.ts` pod `apps/web/src/app/api/v1/`, nie miał zerwanych ani nieużywanych schematów i spełniał `checkOpenApiDocument` z `@monorise-team/testing`.

## Kontrakty i klient

- `packages/contracts`: wspólne schematy Zod, `ERROR_CODES`, `ApiErrorResponse`, `apiSuccessSchema`, `apiErrorSchema`, `Health`, `Capabilities`, `Me`, schematy skrzynek i wiadomości, dostawcy poczty (`MAIL_PROVIDERS`) oraz `permissions.ts` (`AVENMAIL_PERMISSIONS`, `AVENMAIL_PERMISSION_MANIFEST`, `AVENMAIL_ROLE_TEMPLATES`).
- `packages/client`: `createClient({ baseUrl, getToken, fetch })` z modułami `session`, `accounts` i `mail`, helper `createAppSession` do pojedynczego odświeżania tokenu w aplikacjach oraz `ApiError`.

## Zestawy testów

Testy bez bazy danych i bez serwera poczty (działają z atrapą `createFakeCore` z `@monorise-team/testing`, bez gniazd TCP):

- `packages/contracts/test/contracts.test.ts`: manifest uprawnień, gotowe role, schematy kopert, skrzynek i wiadomości.
- `packages/client/test/client.test.ts`: klient HTTP, nagłówki, ciasteczka, `createAppSession` i mapowanie `ApiError`.
- `packages/mail-engine/test/hosts.test.ts`: ochrona przed SSRF (`resolveMailHost`).
- `packages/mail-ui/test/access.test.ts`, `errors.test.ts`, `html.test.ts`: reguły dostępu w interfejsie, komunikaty błędów i bezpieczny dokument HTML.
- `apps/web/test/contract.test.ts`: kontrakt produktu Monorise (`defineProductContractTests` dla wszystkich tras `/api/v1/*`, spójność OpenAPI 3.1).
- `apps/web/test/api.test.ts`: `/health`, `/me`, `capabilities`, błędy Core, PKCE `/api/auth/sign-in`, ochrona CSRF, blokada `PRODUCT_ACCESS_REQUIRED` i `PERMISSION_DENIED` oraz odświeżanie po `authz_rev`.
- `apps/web/test/permissions.test.ts`: role (`Użytkownik AvenMail`, `Administrator AvenMail`, `Owner`), brak produktu (`403 PRODUCT_ACCESS_REQUIRED`), pamięć podręczna, `authz_rev` i fail-closed `503`.
- `apps/web/test/core-machine.test.ts`, `core-registration.test.ts`, `core-resilience.test.ts`: token maszynowy (w tym `core:notifications.send`), rejestracja manifestu i ról, ponawianie żądań i stronicowanie katalogu.
- `apps/web/test/event-feed.test.ts`: odbiór zdarzeń z Core (`organization.permissions.changed` i `organization.account.deactivated` z usuwaniem sesji BFF), deduplikacja, kursor i konfiguracja `AVEN_EVENT_FEED_INTERVAL_MS`.
- `apps/web/test/notifications.test.ts`: czysta logika `notifyMailboxAlert` (neutralna treść PL, `actionUrl`, `Idempotency-Key`), wywołanie przez `createFakeCore` (ponawianie, błędy 500/sieci, limit czasu, brak danych osobowych w logach) oraz integracja z `runWithConnectedMailbox`.
- `apps/web/test/crypto.test.ts`, `hosts.test.ts`: szyfrowanie haseł skrzynek i routing po hoście.

Testy wymagające PostgreSQL (i GreenMail dla poczty):

- `packages/db/test/rls.test.ts`: rola `aven_mail_app`, wymuszone RLS na `mail_accounts`, tabele techniczne kanału zdarzeń i brak dostępu do `_prisma_migrations`.
- `apps/web/test/tenant-isolation.test.ts`: separacja skrzynek między firmami (`checkTenantIsolation` z `@monorise-team/testing`).
- `apps/web/test/mail-integration.test.ts` i `packages/mail-engine/test/mail.test.ts`: testy IMAP/SMTP i pełnego cyklu skrzynek z GreenMail (`AVEN_TEST_IMAP_HOST=127.0.0.1`).
