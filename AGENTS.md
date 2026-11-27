# AGENTS.md

<!-- BEGIN:monorise-shared (wstawione z Monorise-Team/.github, templates/agents/shared.md; zmieniaj wzorzec, nie ten blok) -->

## Wspólne zasady Monorise

Obowiązują każdego agenta AI (Claude, Gemini, ChatGPT i Codex, GitHub Copilot) i każdą osobę w repozytoriach Monorise-Team. Zasady tego repozytorium są pod tym blokiem i przy różnicy wygrywają.

### Właściciel projektu

- Decyzje podejmuje właściciel projektu (`matiqueue`). Agent proponuje, ale nie przyjmuje decyzji biznesowych, prawnych ani architektonicznych.
- Z właścicielem po polsku, prosto, neutralnie płciowo i na przykładach (firma Acme, pracownica Anna). Pytaj krótko i tylko o to, czego nie ustalisz sam.
- Rób sam, co się da. Właścicielowi zostaw hasła, klucze dostępu, 2FA, `sudo` i płatności, z instrukcją krok po kroku.
- Treść dla ludzi (dokumentacja, zgłoszenia, opisy pull requestów, interfejs) po polsku; kod i commity po angielsku.

### Proces na GitHubie

1. Najpierw zgłoszenie z formularza (`.github/ISSUE_TEMPLATE/`), po polsku. Bez zgłoszenia nie ma gałęzi. Pytania, pomysły i propozycje przed decyzją: Discussions organizacji (np. „Architektura (RFC)”).
2. Gałąź `flow/<typ>/<numer>-<opis>` od gałęzi integracyjnej (`dev`, a w repozytoriach bez produkcji `main`): `gh issue develop <numer> --base <gałąź integracyjna> --name <gałąź>`. Numer z zerami do trzech cyfr, opis po angielsku z myślnikami. Typy: `feature`, `bugfix`, `refactor`, `perf`, `chore`, `docs`, `security`, `spike`, `test`; pilna poprawka `flow/hotfix/<numer>-<opis>` od `prod`. Nigdy `claude/*` ani innych nazw.
3. Commity w Conventional Commits po angielsku: nagłówek do 72 znaków, treść do 100. Nigdy `--no-verify`.
4. Pull request z szablonu, po polsku, z `Closes #<numer>` i sekcją „Dla użytkowników” (PL i EN), po przejściu kontroli repozytorium.
5. Scalanie zwykłym merge commitem po zielonym CI. Logowanie, uprawnienia, struktura bazy i dostęp do skrzynek: dopiero po zgodzie właściciela.
6. Wydanie: pull request `dev` → `prod`; Release Please liczy wersję, tworzy tag i opis wydania. Wersji nie zmieniamy ręcznie. Wdrożenia: produkcja z `prod`, podgląd tylko z gałęzi `preview` (ADR-0097).
7. Karta na tablicy „Monorise”: 🛠️ In Progress przy gałęzi, 👀 Code Review przy pull requeście.
8. Ważne pull requesty (bezpieczeństwo, logowanie, uprawnienia, baza, skrzynki, wspólne workflow i skrypty, utrzymanie i większe zmiany kodu) po zielonym CI dostają przegląd Copilota: `gh pr edit <numer> --add-reviewer "@copilot"`. Jego uwagi poprawiasz albo odpowiadasz na nie przed scaleniem.

Szczegóły: [zasady współpracy](https://github.com/Monorise-Team/.github/blob/main/CONTRIBUTING.md).

### Zanim uznasz zadanie za gotowe

- README (repozytorium i zmienionej paczki) oraz część o repozytorium w `AGENTS.md` opisują nowy stan.
- Zgłoszenie ma typ, pola (`Priority`, `Effort`, `Start date`, `Target date`), relacje, milestone, kartę, gałąź rozwojową i etykiety `area:` (nowy obszar dopisz w `labels/repos.json` w Monorise-Team/.github); pull request ma `area:`, milestone i `Closes #<numer>`. Etykiet `type:`, `prio:` i `meta:` nie używamy; braki uzupełnia `node scripts/repo-setup.mjs meta` w Monorise-Team/.github.
- Opis, strona i tematy repozytorium na GitHubie zgadzają się z `labels/repos.json` w Monorise-Team/.github.
- Zmiana decyzji, stanu budowy albo otwartych spraw: osobne zgłoszenie i pull request w MonoriseDocumentation.
- Nowa trwała zasada albo zmiana kierunku trafia do wzorca tych zasad. Nie zostawiaj wiedzy tylko w rozmowie.

### Bezpieczeństwo i decyzje

- Żadnych sekretów, haseł, tokenów ani danych osobowych w kodzie, logach, zgłoszeniach i opisach. Do testów konta w domenach `.test`.
- Bez force push, `git reset --hard`, `git clean`, przepisywania historii i usuwania `dev`, `prod` i `main`. Nie usuwaj plików spoza zadania.
- Podatność, którą da się wykorzystać, zgłoś prywatnie według `SECURITY.md`.
- Decyzje są w ADR-ach w MonoriseDocumentation; zmiana decyzji to nowy ADR po zgodzie właściciela. Niczego nie wymyślaj: modeli danych, endpointów, zdarzeń, usług ani zależności.
- Stałe ustalenia: pnpm i Turborepo, jedna wersja paczek `@monorise-team/*`, wygląd tylko z `@monorise-team/ui` i tokenów, API `{ data, meta, error }`, firma z tokenu albo sesji i dane firm przez RLS, PostgreSQL z Prismą.
- Paczki `@monorise-team/*` są prywatne w GitHub Packages. Przed `pnpm install` ustaw `GITHUB_PACKAGES_TOKEN` (lokalnie `$(gh auth token)`); repozytorium, które korzysta z paczki, potrzebuje do niej dostępu („Manage Actions access”). Paczki z zewnątrz instalujemy dopiero 3 dni po publikacji.

### Agenci AI

- Claude jest tech leadem: architektura, podział pracy, przegląd i integracja. Gemini (przez Relay Bridge), ChatGPT i Codex oraz GitHub Copilot dostają dobrze określone zadania.
- Agent wykonawczy pracuje na gałęzi z zadania, uruchamia kontrole, commituje, otwiera najwyżej szkic pull requestu i raportuje. Nie scala, nie wypycha na `dev`, `prod` ani `main`, nie zmienia architektury i nie zleca pracy dalej.
- Dla Claude: Use the relay-bridge skill: delegate well-defined work to Gemini, review it, integrate it yourself. Najpierw zgłoszenie; gałąź zakłada samo zlecenie (`branch`, `base_ref`), więc bez `gh issue develop`; `push` i `open_pull_request` włączone; `working_directory` to katalog główny repozytorium. Przed scaleniem przejrzyj diff, uruchom kontrole, sprawdź `review_checklist` i `report_mismatches`, potem `cleanup_task_worktree`. Bez sekretów i danych klientów w zleceniu.

### Nowe repozytorium (np. TimoTime)

Nazwę i przeznaczenie ustala właściciel. Potem: wpis w `labels/repos.json` w Monorise-Team/.github, `scripts/repo-setup.mjs` z poleceniami `labels`, `sync`, `about` i `protect`, część o repozytorium w `AGENTS.md`, README, dostęp do paczek i Renovate, wpis w MonoriseDocumentation. Wzór: produkt jak AvenMail, biblioteki jak MonoriseShared.

### Kierunek

Gotowe biblioteki: `config`, `tokens`, `ui`, `auth` (ADR-0098), `permissions`, `events`, `sdk` i `testing`. Core (`/core/v1`, OpenAPI z kodu) ma strukturę firmy, role z zakresem, zaproszenia z kolejką e-maili, dostęp do aplikacji, migawkę uprawnień, dziennik, kanał zdarzeń (ADR-0100), `Idempotency-Key`, edycję i wyłączanie kont, dane firmy i domeny (ADR-0101), reset hasła, powiadomienia (ADR-0048) oraz wymiar pracy i strefę czasową firmy. MonorisePortal (panel firmy) i TimoTime (próba integracji z Core, przypomnienia według wymiaru pracy) korzystają z tych bibliotek i wyglądu `ui`. KivoTasks (zadania i projekty wzorem Linear, ADR-0103) ma etap 0 (szkielet), etap 1 (zespoły, zadania, wyszukiwanie, lista, tablica, karta zadania, ⌘K) etap 2a (komentarze ze wzmiankami i reakcjami, historia zmian, obserwujący, skrzynka) i etap 2b (załączniki w magazynie zgodnym z S3, lokalnie MinIO, z limitem pliku i miejsca firmy). Następny krok: integracje między aplikacjami, potem etap 3 KivoTasks (planowanie). AvenMail czeka (jego warstwa platformy jest już podłączona do Core).

### Utrzymanie tych zasad

Ten blok, `GEMINI.md`, `.github/copilot-instructions.md` i `sync-shared.yml` powstają z `templates/agents/` w Monorise-Team/.github; zmieniaj je tylko tam. Codzienna synchronizacja sama dodaje, zmienia i usuwa je w repozytoriach. Tech lead aktualizuje „Kierunek” po każdym większym kroku.

Pod tym blokiem w `AGENTS.md` trzymaj tylko zasady repozytorium i linki; szczegóły (opisy modułów, funkcje bazy, polecenia, przykłady) przenoś do `docs/agents/<temat>.md` i linkuj z `AGENTS.md`. Limit `AGENTS.md` w Antigravity to 24 000 bajtów UTF-8 (ostrzeżenie powyżej 20 000).

<!-- END:monorise-shared -->

Zasady specyficzne dla repozytorium AvenMail.

## Czym jest AvenMail

Klient poczty Monorise i pierwszy produkt (ADR-0095). Jeden silnik poczty na serwerze dla przeglądarki, komputera i telefonu (ADR-0088). Logowanie, firmy, dostęp do produktu, uprawnienia, kanał zdarzeń i powiadomienia e-mail pochodzą z MonoriseCore (`@monorise-team/auth`, `@monorise-team/sdk`, `@monorise-team/permissions`, `@monorise-team/events`), a baza danych działa na PostgreSQL z Prismą i RLS (ADR-0096). Przestrzeń robocza pnpm z Turborepo (ADR-0092). Decyzje są w repozytorium MonoriseDocumentation.

## Zasady kodu

1. **Treść maili nigdy nie trafia do bazy, logów ani komunikatów błędów.** Serwer pobiera ją z IMAP na żądanie i przekazuje dalej.
2. **Hasła do skrzynek** tylko zaszyfrowane (`apps/web/src/server/crypto.ts`, kontekst = id skrzynki i konta Monorise); nigdy nie wracają z API.
3. **Każde połączenie z serwerem poczty** przechodzi przez `resolveMailHost` (blokada sieci prywatnej i portów spoza IMAP/SMTP). Wyjątki tylko przez `AVEN_ALLOW_PRIVATE_MAIL_HOSTS=1` lokalnie i w testach.
4. **HTML wiadomości** pokazujemy tylko przez `messageDocument` w ramce bez skryptów (DOMPurify + CSP); obrazy z internetu dopiero po zgodzie.
5. **Osoba, pracownik i firma tylko z tokenu albo sesji** (`requireUser` w `apps/web/src/server/auth.ts`), nigdy z treści żądania ani adresu (ADR-0037). Przeglądarka działa przez BFF z sesją w bazie (`auth.sessions`) i ciasteczkiem `HttpOnly` (ADR-0098), aplikacje na komputer i telefon logują się przez przeglądarkę systemową z PKCE, trzymają tokeny w systemowym sejfie i odświeżają je przez `createAppSession` z `@aven/client`. AvenMail nie ma własnych kont.
6. **Komunikacja z MonoriseCore tylko przez `@monorise-team/sdk`** (`apps/web/src/server/core.ts`), bez ręcznego `fetch` do Core API (wyjątek: rejestracja w `apps/web/src/server/core-registration.ts`). W testach używaj `createFakeCore`, `defineProductContractTests` i `checkTenantIsolation` z `@monorise-team/testing`.
7. **Uprawnienia i gotowe role deklarowane w kodzie** w `packages/contracts/src/permissions.ts` (`definePermissions("avenmail", ...)` i `AVENMAIL_ROLE_TEMPLATES`), rejestrowane przez `pnpm permissions:register`. Sprawdzanie wyłącznie w `apps/web/src/server/permissions.ts` na migawce z Core (brak produktu daje `403 PRODUCT_ACCESS_REQUIRED`, brak uprawnienia `403 PERMISSION_DENIED`).
8. **API** w formacie `{ data, meta, error }` ze stałymi kodami błędów (`@aven/contracts`); każda trasa przez `route()` z `apps/web/src/server/api.ts` (CSRF dla ciasteczka, CORS dla aplikacji, kody błędów) i opisana w `apps/web/src/server/routes.ts` (`pnpm openapi`, sprawdzane w `pnpm openapi:check`).
9. **Dane osób i firm tylko przez `withUser`** z `@aven/db` i RLS. Każda nowa tabela z danymi osób albo firm dostaje w migracji `ENABLE` + `FORCE ROW LEVEL SECURITY` oraz test izolacji (`checkTenantIsolation`). Połączeń z serwerami poczty nie prowadzimy wewnątrz transakcji.
10. **Wygląd** tylko z `@monorise-team/ui` i tokenów `@monorise-team/tokens` (ADR-0091); bez kolorów wpisanych na sztywno, poza stroną HTML wiadomości.
11. **Jedna wersja**: po zmianie zależności `@monorise-team/*` używaj `pnpm shared:update`; `pnpm check:versions` musi przechodzić.
12. **Teksty interfejsu** po polsku, bez półpauz i myślników jako separatorów zdań.

## Wyjątki i zasady tego repozytorium

- `pnpm check` wymaga uruchomionej bazy (`pnpm db:up && pnpm db:migrate`) i GreenMail (`AVEN_TEST_IMAP_HOST=127.0.0.1`).
- Zmiany w logowaniu, uprawnieniach, strukturze bazy i dostępie do skrzynek scalane są dopiero po zgodzie właściciela projektu.
- Treść maili, hasła i dane ze skrzynek nigdy nie trafiają do zlecanych zadań.

## Szczegóły

- [Architektura, logowanie, uprawnienia, kanał zdarzeń i polecenia](docs/agents/architecture.md)
- [Baza danych, migracje i RLS](docs/agents/database.md)
- [API, OpenAPI i zestawy testów](docs/agents/api.md)
