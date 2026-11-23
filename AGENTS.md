# AGENTS.md

Instrukcje dla agentów AI (i ludzi) pracujących w repozytorium AvenMail.

## Czym jest AvenMail

Klient poczty Monorise i pierwszy produkt (ADR-0090). Jeden silnik poczty na serwerze dla przeglądarki, komputera i telefonu (ADR-0088). Przestrzeń robocza pnpm z Turborepo (ADR-0092). Decyzje są w repozytorium MonoriseDocumentation.

| Gdzie                  | Co                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`             | Next.js: `aven.` (strona, API `/api/v1`) i `aven-mail.` (poczta); rozpoznanie adresu w `src/proxy.ts`, serwer w `src/server/` |
| `apps/desktop`         | Vite + React + Tauri 2; ekrany z `@aven/mail-ui`                                                                              |
| `apps/mobile`          | Expo; własne ekrany, tokeny z `@monorise-team/tokens`, token w `expo-secure-store`                                            |
| `packages/mail-engine` | IMAP (imapflow), SMTP (nodemailer), parsowanie (mailparser), ochrona przed SSRF                                               |
| `packages/contracts`   | schematy zod i typy API, dostawcy poczty                                                                                      |
| `packages/client`      | klient API (ciasteczko w przeglądarce, token w aplikacjach)                                                                   |
| `packages/mail-ui`     | ekrany poczty dla przeglądarki i komputera                                                                                    |

## Proces pracy (zawsze)

1. **Najpierw zgłoszenie** z formularza (`.github/ISSUE_TEMPLATE/`), po polsku, z sekcjami `### Obszar`, `### Priorytet`, `### Nakład pracy`.
2. **Gałąź** `flow/<typ>/<numer>-<opis>` od aktualnego `dev`, zakładana poleceniem `gh issue develop <numer> --base dev --name <gałąź>`. Pilna poprawka produkcji: `flow/hotfix/<numer>-<opis>` od `prod`. Nigdy `claude/*` ani innych nazw spoza konwencji.
3. **Commity** po angielsku w formacie Conventional Commits; hooki sprawdzają lint, formatowanie, typy i wersje. Nigdy `--no-verify`.
4. **Pull request** do `dev` z szablonu (sekcja „Dla użytkowników” PL i EN), z `Closes #<numer>`. Scalamy zwykłym scaleniem, nigdy przez squash.
5. **Wydanie**: pull request `dev` → `prod`; Release Please liczy wersję. Wersji nie zmieniamy ręcznie.

## Zasady kodu

1. **Treść maili nigdy nie trafia do bazy, logów ani komunikatów błędów.** Serwer pobiera ją z IMAP na żądanie i przekazuje dalej.
2. **Hasła do skrzynek** tylko zaszyfrowane (`apps/web/src/server/crypto.ts`, kontekst = id skrzynki i użytkownika); nigdy nie wracają z API.
3. **Każde połączenie z serwerem poczty** przechodzi przez `resolveMailHost` (blokada sieci prywatnej i portów spoza IMAP/SMTP). Wyjątki tylko przez `AVEN_ALLOW_PRIVATE_MAIL_HOSTS=1` lokalnie i w testach.
4. **HTML wiadomości** pokazujemy tylko przez `messageDocument` w ramce bez skryptów (DOMPurify + CSP); obrazy z internetu dopiero po zgodzie.
5. **API** w formacie `{ data, meta, error }` ze stałymi kodami błędów (`packages/contracts`); każda trasa przez `route()` z `apps/web/src/server/api.ts` (CSRF dla ciasteczka, CORS dla aplikacji, kody błędów).
6. **Wygląd** tylko z `@monorise-team/ui` i tokenów (ADR-0091); bez kolorów wpisanych na sztywno, poza stroną HTML wiadomości.
7. **Logowanie deweloperskie** (`AVEN_DEV_AUTH=1`) istnieje tylko do czasu logowania przez Core; bez niego nie wdrażamy AvenMail nigdzie (ADR-0090).
8. **Jedna wersja**: po zmianie zależności `@monorise-team/*` używaj `pnpm shared:update`; `pnpm check:versions` musi przechodzić.
9. Teksty interfejsu po polsku, bez półpauz i myślników jako separatorów zdań.

## Polecenia

```bash
pnpm install && pnpm setup:env && pnpm mail:test-server
pnpm dev                 # aven.localhost:3000 i aven-mail.localhost:3000
pnpm check               # obowiązkowo przed pull requestem
AVEN_TEST_IMAP_HOST=127.0.0.1 pnpm test
```
