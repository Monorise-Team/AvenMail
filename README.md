# AvenMail

Klient poczty Monorise (ADR-0095): IMAP i SMTP w przeglądarce, na komputerach i telefonach, z jednym silnikiem poczty na serwerze (ADR-0088). Treści maili nie zapisujemy na serwerze, a hasła do skrzynek szyfrujemy. Logowanie, firmy, dostęp do produktu, uprawnienia, kanał zdarzeń i powiadomienia e-mail pochodzą z MonoriseCore (`@monorise-team/auth`, `@monorise-team/sdk`), a baza danych działa na PostgreSQL z Prismą i RLS (ADR-0096).

## Adresy i części

| Część                                          | Co                                                                                                    | Adres                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web)                         | Next.js: strona produktu i API `/api/v1`, a pod drugim adresem poczta w przeglądarce                  | `aven.monorise.studio` (`aven.localhost:3000`), `aven-mail.monorise.studio` (`aven-mail.localhost:3000`) |
| [`apps/desktop`](apps/desktop)                 | Vite, React i Tauri 2                                                                                 | Windows, macOS, Linux                                                                                    |
| [`apps/mobile`](apps/mobile)                   | Expo                                                                                                  | iOS, Android                                                                                             |
| [`packages/mail-engine`](packages/mail-engine) | silnik poczty na serwerze: IMAP, SMTP, parsowanie, ochrona przed SSRF                                 |                                                                                                          |
| [`packages/contracts`](packages/contracts)     | typy i schematy API, dostawcy poczty, manifest uprawnień (`definePermissions`) i gotowe role produktu |                                                                                                          |
| [`packages/client`](packages/client)           | typowany klient API dla wszystkich aplikacji                                                          |                                                                                                          |
| [`packages/mail-ui`](packages/mail-ui)         | ekrany poczty wspólne dla przeglądarki i komputera (`@monorise-team/ui`)                              |                                                                                                          |
| [`packages/db`](packages/db)                   | baza `aven_mail` (PostgreSQL, port 5434): schemat Prisma, migracje z RLS, `withUser`                  |                                                                                                          |

## Uruchomienie lokalne

Potrzebne: Node.js 24 (`.nvmrc`), pnpm 11, Docker (baza i serwer poczty do testów), działający lokalnie [MonoriseCore](https://github.com/Monorise-Team/MonoriseCore) (logowanie na `localhost:3100` i Core API na `localhost:3200`), a dla aplikacji na komputer [Rust i wymagania Tauri 2](https://v2.tauri.app/start/prerequisites/).

```bash
# raz: dostęp do paczek @monorise-team/* w GitHub Packages
gh auth refresh -h github.com -s read:packages
export GITHUB_PACKAGES_TOKEN=$(gh auth token)

# raz, w MonoriseCore: klient OAuth avenmail-web i jego sekret (apps/auth/.data/oauth-clients.json)
pnpm oauth:seed

pnpm install
pnpm setup:env            # apps/web/.env.local i packages/db/.env; sekret klienta bierze z MonoriseCore
pnpm db:up                # PostgreSQL w Dockerze (kontener aven-mail-postgres-1, port 5434)
pnpm db:migrate           # migracje bazy aven_mail i bazy testów aven_mail_test
pnpm permissions:register # rejestracja uprawnień avenmail.* i gotowych ról w MonoriseCore
pnpm mail:test-server     # GreenMail: IMAP 3143, SMTP 3025 (każdy login i hasło działają)
pnpm dev                  # http://aven.localhost:3000 (strona i API) i http://aven-mail.localhost:3000 (poczta)
```

Jeśli repozytorium albo git worktree nie leży obok katalogu `MonoriseCore`, wskaż plik z sekretami OAuth Core zmienną `CORE_OAUTH_SECRETS_FILE` (pełna lista zmiennych w [`.env.example`](.env.example)):

```bash
CORE_OAUTH_SECRETS_FILE=/sciezka/do/MonoriseCore/apps/auth/.data/oauth-clients.json pnpm setup:env
```

Logowanie: AvenMail korzysta z kont Monorise (BFF w ciasteczku `HttpOnly` w przeglądarce, ADR-0098), więc obok musi działać MonoriseCore. Przycisk „Zaloguj się kontem Monorise” prowadzi na ekran logowania Core i z powrotem do poczty.

Skrzynka testowa w GreenMail: dowolny adres, dowolne hasło, IMAP `127.0.0.1:3143`, SMTP `127.0.0.1:3025`, „Bez szyfrowania” (lokalnie dozwolone przez `AVEN_ALLOW_PRIVATE_MAIL_HOSTS=1`).

```bash
pnpm dev:desktop        # aplikacja na komputer (łączy się z http://aven.localhost:3000)
pnpm dev:mobile         # Expo; adres serwera: EXPO_PUBLIC_AVEN_API (symulator iOS: http://127.0.0.1:3000)
```

Logowanie w aplikacjach: przycisk „Zaloguj się kontem Monorise” otwiera ekran logowania Core w przeglądarce systemowej. Aplikacja na komputer odbiera powrót na `http://127.0.0.1:<port>/oauth/callback` (RFC 8252), aplikacja na telefon przez `avenmail://` (w Expo Go przez `exp://127.0.0.1:8081`, dlatego Metro startuje z `--localhost`). Tokeny trzymają w systemowym sejfie: Pęk kluczy macOS, Credential Manager, Secret Service, Keychain i Keystore na telefonie. Adresy powrotu rejestruje w lokalnym Core `pnpm oauth:seed`.

## Uprawnienia, role i dostęp

AvenMail deklaruje uprawnienia w `packages/contracts/src/permissions.ts` (`definePermissions("avenmail", ...)`):

- `avenmail.mail.read`: odczyt folderów i wiadomości oraz zarządzanie flagami, przenoszeniem i usuwaniem wiadomości w podłączonych skrzynkach,
- `avenmail.mail.send`: wysyłanie wiadomości e-mail przez SMTP z podłączonych skrzynek,
- `avenmail.mailboxes.manage`: dodawanie, testowanie połączenia i odłączanie skrzynek pocztowych.

Gotowe role (`AVENMAIL_ROLE_TEMPLATES`):

- **Użytkownik AvenMail** (`avenmail.user`): `avenmail.mail.read`, `avenmail.mail.send`,
- **Administrator AvenMail** (`avenmail.admin`): wszystkie trzy uprawnienia.

Aby korzystać z AvenMail, firma potrzebuje aktywnego dostępu do produktu (`Entitlement`), konto pracownika włączonej aplikacji (`AppAccess`), a osoba odpowiedniej roli (Owner firmy ma pełny dostęp po włączeniu `Entitlement`). Brak produktu w migawce Core daje `403 PRODUCT_ACCESS_REQUIRED`, a brak konkretnego uprawnienia `403 PERMISSION_DENIED`.

### Konfiguracja lokalna w MonoriseCore

Po `pnpm oauth:seed` i uruchomieniu MonoriseCore oraz `pnpm permissions:register` w AvenMail:

```bash
# W MonoriseCore: przyznaj firmie dostęp do produktu avenmail
pnpm entitlement:grant -- --organization acme.test --product avenmail
```

Następnie w Core API (`http://localhost:3200/core/v1`, z tokenem Ownera firmy) włącz aplikację osobie (`POST /core/v1/app-access` z `{ "accountId": "<uuid>", "product": "avenmail" }`), sprawdź role (`GET /core/v1/roles?product=avenmail`) i przypisz rolę (`POST /core/v1/role-assignments`).

### Kanał zdarzeń Core, powiadomienia i baza danych

- **Kanał zdarzeń Core (ADR-0100):** `apps/web/src/instrumentation.ts` uruchamia odpytywanie `GET /core/v1/products/avenmail/events` (`AVEN_EVENT_FEED_INTERVAL_MS`, domyślnie `5000` ms w `development`, `0` poza nim). Zdarzenie `organization.permissions.changed` natychmiast unieważnia pamięć podręczną uprawnień dla wskazanej firmy i konta, a `organization.account.deactivated` dodatkowo usuwa sesje BFF tego konta z bazy.
- **Alerty skrzynek (ADR-0048):** gdy serwer wykryje odrzucone logowanie do podłączonej skrzynki (`MAIL_AUTH_FAILED`), zleca best-effort powiadomienie e-mail w Core (`avenmail.alerts`) z linkiem do tej skrzynki i deterministycznym `Idempotency-Key`.
- **Baza danych:** PostgreSQL na porcie `5434` (kontener `aven-mail-postgres-1`). Serwer łączy się rolą `aven_mail_app`, którą obowiązuje wymuszone RLS na `mail_accounts` (skrzynkę widzi tylko jej właściciel w swojej firmie, ADR-0037). Baza zawiera także tabele techniczne (`auth.sessions`, `public.event_feed_cursors`, `public.processed_events`).

## Polecenia i kontrole

```bash
pnpm install && pnpm setup:env && pnpm db:up && pnpm db:migrate
pnpm permissions:register                  # rejestracja manifestu uprawnień i gotowych ról w MonoriseCore
pnpm openapi                               # generuje openapi/avenmail-api.json z kodu
pnpm openapi:check                         # sprawdza aktualność openapi/avenmail-api.json
AVEN_TEST_IMAP_HOST=127.0.0.1 pnpm check   # formatowanie, wersje, OpenAPI, lint, typy, testy i build (wymaga bazy i GreenMail)
AVEN_TEST_IMAP_HOST=127.0.0.1 pnpm test    # testy silnika i API na GreenMail
```

## Wersje

Jedna wersja wszystkich części (ADR-0087): Release Please liczy ją z commitów i wpisuje do `package.json` każdej części i do `Cargo.toml`; Tauri i Expo czytają ją z `package.json`, a numer kompilacji na telefony jest z niej wyliczany. `pnpm check:versions` odrzuca każdą rozbieżność.

Wspólne biblioteki `@monorise-team/*` mają w AvenMail zawsze jedną, dokładną wersję. Aktualizacja: Renovate (pull request co tydzień) albo ręcznie `pnpm shared:update` (`latest`, `dev` albo numer wersji).

Szczegóły techniczne dla agentów i programistów: [`docs/agents/architecture.md`](docs/agents/architecture.md), [`docs/agents/database.md`](docs/agents/database.md), [`docs/agents/api.md`](docs/agents/api.md). Zasady pracy: [CONTRIBUTING.md organizacji](https://github.com/Monorise-Team/.github/blob/main/CONTRIBUTING.md).
