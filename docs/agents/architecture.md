# Architektura AvenMail

AvenMail jest klientem poczty Monorise (ADR-0095) działającym w przeglądarce, na komputerze i na telefonie z jednym silnikiem poczty na serwerze (ADR-0088). Logowanie, firmy, dostęp do produktu, uprawnienia, kanał zdarzeń i powiadomienia e-mail pochodzą z MonoriseCore (`@monorise-team/auth`, `@monorise-team/sdk`, `@monorise-team/permissions`, `@monorise-team/events`), a baza danych działa na PostgreSQL z Prismą i RLS (ADR-0096).

## Układ przestrzeni roboczej

| Katalog                     | Rola                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`                  | Jedna aplikacja Next.js (lokalnie port `3000`): strona produktu i API `/api/v1` na `aven.*`, poczta w przeglądarce na `aven-mail.*`.                                                       |
| `apps/desktop`              | Aplikacja na komputer: Vite, React i Tauri 2 z ekranami z `@aven/mail-ui`, logowaniem PKCE przez przeglądarkę systemową i tokenami w systemowym sejfie.                                    |
| `apps/mobile`               | Aplikacja na telefon: Expo, tokeny wyglądu `@monorise-team/tokens`, logowanie PKCE i tokeny w `expo-secure-store`.                                                                         |
| `packages/mail-engine`      | Silnik poczty na serwerze: IMAP (`imapflow`), SMTP (`nodemailer`), parsowanie (`mailparser`), sanityzacja i ochrona przed SSRF (`resolveMailHost`).                                        |
| `packages/contracts`        | Schematy Zod, typy odpowiedzi API (`{ data, meta, error }`, `Capabilities`, `Me`), konfiguracje dostawców, manifest uprawnień (`AVENMAIL_PERMISSIONS`) i role (`AVENMAIL_ROLE_TEMPLATES`). |
| `packages/client`           | Typowany klient HTTP API AvenMail (ciasteczko BFF w przeglądarce, token i `createAppSession` z pojedynczym odświeżaniem w aplikacjach).                                                    |
| `packages/mail-ui`          | Wspólne ekrany poczty dla przeglądarki i komputera na bazie `@monorise-team/ui` i `@monorise-team/tokens`.                                                                                 |
| `packages/db`               | Baza `aven_mail` (PostgreSQL, port `5434`): schemat Prisma 7, migracje, funkcje RLS i `withUser`.                                                                                          |
| `openapi/avenmail-api.json` | Opis OpenAPI 3.1 generowany deterministycznie z katalogu ścieżek i schematów Zod.                                                                                                          |

## Routing według hosta (`apps/web/src/proxy.ts` i `src/lib/hosts.ts`)

- `aven.monorise.studio` (lokalnie `aven.localhost:3000`): wyświetla stronę produktu (`src/app/(site)/`) oraz udostępnia API `/api/v1/*`. Ścieżki `/mail` i `/mail/*` na tym hoście zwracają `404`.
- `aven-mail.monorise.studio` (lokalnie `aven-mail.localhost:3000`): przepisuje wszystkie ścieżki poza `/api/*` pod `/mail/*` (`src/app/mail/`). Lista hostów poczty może być nadpisana zmienną `AVEN_MAIL_HOSTS`.
- Żądania wstępne CORS (`OPTIONS /api/*`) przepuszczają wyłącznie pochodzenia z `AVEN_ALLOWED_ORIGINS` (domyślnie Tauri).

## Logowanie i integracja z MonoriseCore

- **Sesja przeglądarki (BFF, ADR-0098):** `apps/web/src/server/auth.ts` tworzy instancję `createWebAuth` z `@monorise-team/auth/next` dla klienta `avenmail-web` i zasobów `AVEN_API_URL` oraz `CORE_API_URL`. Sesje trafiają do `auth.sessions` (`src/server/sessions.ts`), a tokeny są szyfrowane kluczem `AVEN_SESSION_SECRET`.
- **Trasy logowania:** `/api/auth/sign-in`, `/api/auth/callback`, `/api/auth/sign-out`.
- **Tożsamość żądania:** wyłącznie `requireUser(request)` w `src/server/auth.ts`. Zwraca `Caller` (`organizationId`, `accountId`, `employeeId`, `userId`, `id`, `context`, `session`, `token`). AvenMail nie prowadzi własnych kont.
- **Klient Core SDK (`src/server/core.ts` i `src/server/core-machine.ts`):**
  - `createUserCoreClient(session)`: wywołania w imieniu zalogowanej osoby (`GET /core/v1/me` dla `GET /api/v1/me`).
  - `getMachineCoreClient()`: token maszynowy OAuth 2.1 (`client_credentials`, zakresy `core:permissions.read core:directory.read core:events.read core:notifications.send`), buforowany do 30 s przed wygaśnięciem z pojedynczym odświeżaniem w locie (`single-flight`).
  - Oba klienty ponawiają żądania przy krótkich błędach sieci i statusach `429`, `502`, `503`, `504` (`DEFAULT_CORE_RETRY`: 3 próby, 200 do 2000 ms). Przy trwałej awarii serwer odmawia bezpiecznie kodem `503` (fail-closed), z wyjątkiem wywołań best-effort takich jak powiadomienia e-mail.
- **Powiadomienia e-mail (`src/server/notifications.ts`, ADR-0048):**
  - Gdy operacja na podłączonej skrzynce w `src/server/mailboxes.ts` (`runWithConnectedMailbox` / `withConnectedMailbox`) otrzyma błąd uwierzytelnienia `MAIL_AUTH_FAILED`, serwer zleca w Core powiadomienie `POST /core/v1/organizations/{organizationId}/notifications` (`sendNotification` w `@monorise-team/sdk`) w kategorii `avenmail.alerts`.
  - Link `actionUrl` wskazuje tę skrzynkę na originie `config.appUrl` (`AVEN_MAIL_URL`), np. `${origin}/?account=<uuid>`.
  - Wywołanie działa best-effort z krótkim limitem czasu (`DEFAULT_NOTIFICATION_TIMEOUT_MS = 3000` ms), deterministycznym nagłówkiem `Idempotency-Key` (`avenmail:mailbox-auth-failed:<mailboxId>:<recipientAccountId>:<YYYY-MM-DD>`) i polityką ponawiania SDK. Błędy są logowane jako ostrzeżenie bez adresu e-mail, danych osobowych, haseł ani tokenów i nigdy nie zastępują pierwotnego błędu poczty.

## Uprawnienia, role i kanał zdarzeń

- **Deklaracja:** `packages/contracts/src/permissions.ts` (`definePermissions("avenmail", ...)`):
  - `avenmail.mail.read`: odczyt folderów, wiadomości oraz zarządzanie flagami, przenoszeniem i usuwaniem wiadomości w podłączonych skrzynkach,
  - `avenmail.mail.send`: wysyłanie wiadomości e-mail przez SMTP z podłączonych skrzynek,
  - `avenmail.mailboxes.manage`: dodawanie, testowanie połączenia i odłączanie skrzynek pocztowych.
  - Gotowe role (`AVENMAIL_ROLE_TEMPLATES`): `avenmail.user` (Użytkownik AvenMail: `mail.read`, `mail.send`) oraz `avenmail.admin` (Administrator AvenMail: wszystkie trzy uprawnienia).
- **Rejestracja w Core:** `pnpm permissions:register` (`apps/web/scripts/register-permissions.mjs` i `src/server/core-registration.ts`, zakres `core:permissions.register`). Wysyła idempotentnie najpierw manifest uprawnień, potem szablony ról.
- **Sprawdzanie po stronie serwera (`src/server/permissions.ts`):**
  - Pamięć podręczna `createPermissionCache` (maks. 5 minut, jedna instancja na proces w `globalThis.__avenmailPermissionCache`, odświeżana natychmiast po wzroście `authz_rev`).
  - `assertProductAccess` zwraca `403 PRODUCT_ACCESS_REQUIRED`, gdy `"avenmail"` nie ma w `snapshot.products`.
  - `assertPermission`, `assertPermissionScope` i `requireAuthorizedSnapshot` sprawdzają dostęp do produktu oraz wymagane uprawnienia przed warstwą bazy i serwerem poczty.
  - `capabilitiesFromSnapshot` wylicza `Capabilities` (`hasProductAccess`, `readMail`, `sendMail`, `manageMailboxes`) dla `GET /api/v1/me`.
- **Kanał zdarzeń Core (`src/server/event-feed.ts` i `src/instrumentation.ts`, ADR-0100):**
  - W środowisku Node.js `register()` uruchamia `startCoreEventPolling()`, gdy `AVEN_EVENT_FEED_INTERVAL_MS > 0` (domyślnie `5000` w `development`, `0` poza nim).
  - Po odebraniu `organization.permissions.changed` natychmiast wywołuje `invalidatePermissionCache({ organizationId, accountId })`.
  - Po odebraniu `organization.account.deactivated` unieważnia pamięć podręczną uprawnień oraz atomowo usuwa wszystkie sesje BFF tego konta z tabeli `auth.sessions`.
  - Ograniczenie: pamięć podręczna uprawnień działa w pamięci pojedynczego procesu; przed skalowaniem na wiele instancji potrzebna będzie wspólna pamięć podręczna albo osobny kursor na instancję.

## Bezpieczeństwo poczty i interfejs

- **Brak przechowywania treści maili:** wiadomości są pobierane z IMAP na żądanie i nigdy nie trafiają do bazy, logów ani komunikatów błędów.
- **Szyfrowanie haseł (`src/server/crypto.ts`):** hasła skrzynek są szyfrowane kluczem `AVEN_CREDENTIALS_KEY` (AES-256-GCM z kontekstem id skrzynki i konta Monorise) i nigdy nie wracają z API.
- **Ochrona przed SSRF (`packages/mail-engine`):** każde połączenie IMAP/SMTP przechodzi przez `resolveMailHost` (blokada adresów prywatnych i portów spoza listy). Lokalnie i w testach z GreenMail odblokowuje to `AVEN_ALLOW_PRIVATE_MAIL_HOSTS=1`.
- **Renderowanie HTML:** treść HTML wiadomości wyświetlana jest wyłącznie przez `messageDocument` w ramce bez skryptów (DOMPurify + CSP), a zdalne obrazy ładują się dopiero po zgodzie osoby.
- **Powłoka UI (`apps/web/src/app/mail/` i `packages/mail-ui`):** korzysta z `appearanceInitScript`, `ThemeProvider`, `ToastProvider` i `TooltipProvider` z `@monorise-team/ui`, obsługuje stany `LoadingView`, `SignIn`, `LoadErrorView` i `NoAccessView` (brak dostępu do produktu lub brak roli), ogranicza akcje według `capabilities`, odczytuje parametr `?account=` z linku alertu i pozwala zmieniać wygląd w oknie „Wygląd” (`AppearanceControls`).

## Polecenia robocze

```bash
pnpm install && pnpm setup:env && pnpm db:up && pnpm db:migrate
pnpm permissions:register                  # rejestracja uprawnień i gotowych ról w MonoriseCore
pnpm openapi                               # generowanie openapi/avenmail-api.json
pnpm openapi:check                         # weryfikacja aktualności openapi/avenmail-api.json
pnpm mail:test-server                      # GreenMail: IMAP 3143, SMTP 3025
pnpm dev                                   # aven.localhost:3000 i aven-mail.localhost:3000
AVEN_TEST_IMAP_HOST=127.0.0.1 pnpm check   # pełne kontrole (wymaga pnpm db:up i GreenMail)
AVEN_TEST_IMAP_HOST=127.0.0.1 pnpm test    # testy we wszystkich paczkach
pnpm shared:update                         # aktualizacja paczek @monorise-team/* do jednej wersji
```
