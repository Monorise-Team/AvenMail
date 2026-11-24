# AvenMail

Klient poczty Monorise: IMAP i SMTP w przeglądarce, na komputerach i telefonach, z jednym silnikiem poczty na serwerze (ADR-0088). Treści maili nie zapisujemy na serwerze, a hasła do skrzynek szyfrujemy.

| Część                                          | Co                                                                                   | Adres                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| [`apps/web`](apps/web)                         | Next.js: strona produktu i API `/api/v1`, a pod drugim adresem poczta w przeglądarce | `aven.monorise.studio`, `aven-mail.monorise.studio` |
| [`apps/desktop`](apps/desktop)                 | Vite, React i Tauri 2                                                                | Windows, macOS, Linux                               |
| [`apps/mobile`](apps/mobile)                   | Expo                                                                                 | iOS, Android                                        |
| [`packages/mail-engine`](packages/mail-engine) | silnik poczty na serwerze: IMAP, SMTP, parsowanie, ochrona przed SSRF                |                                                     |
| [`packages/contracts`](packages/contracts)     | typy i schematy API, dostawcy poczty                                                 |                                                     |
| [`packages/client`](packages/client)           | typowany klient API dla wszystkich aplikacji                                         |                                                     |
| [`packages/mail-ui`](packages/mail-ui)         | ekrany poczty wspólne dla przeglądarki i komputera (`@monorise-team/ui`)             |                                                     |
| [`packages/db`](packages/db)                   | baza `aven_mail`: schemat Prisma, migracje z RLS, `withUser`                         |                                                     |

## Uruchomienie lokalne

Potrzebne: Node.js 24 (`.nvmrc`), pnpm 11, Docker (baza i serwer poczty do testów), działający lokalnie [MonoriseCore](https://github.com/Monorise-Team/MonoriseCore) (logowanie), dla aplikacji na komputer [Rust i wymagania Tauri 2](https://v2.tauri.app/start/prerequisites/).

```bash
# raz: dostęp do paczek @monorise-team/* w GitHub Packages
gh auth refresh -h github.com -s read:packages
export GITHUB_PACKAGES_TOKEN=$(gh auth token)

# raz, w MonoriseCore: klient OAuth avenmail-web i jego sekret (apps/auth/.data/oauth-clients.json)
pnpm oauth:seed

pnpm install
pnpm setup:env          # apps/web/.env.local i packages/db/.env; sekret klienta bierze z MonoriseCore
pnpm db:up              # PostgreSQL w Dockerze (kontener aven-mail-postgres-1, port 5434)
pnpm db:migrate         # migracje bazy aven_mail i bazy testów aven_mail_test
pnpm mail:test-server   # GreenMail: IMAP 3143, SMTP 3025 (każdy login i hasło działają)
pnpm dev                # http://aven.localhost:3000 (strona) i http://aven-mail.localhost:3000 (poczta)
```

Logowanie: AvenMail korzysta z kont Monorise, więc obok musi działać MonoriseCore (`pnpm dev` w MonoriseCore: logowanie na `localhost:3100`). Przycisk „Zaloguj się kontem Monorise” prowadzi na ekran logowania Core i z powrotem do poczty.

Skrzynka testowa w GreenMail: dowolny adres, dowolne hasło, IMAP `127.0.0.1:3143`, SMTP `127.0.0.1:3025`, „Bez szyfrowania” (lokalnie dozwolone przez `AVEN_ALLOW_PRIVATE_MAIL_HOSTS=1`).

```bash
pnpm dev:desktop        # aplikacja na komputer (łączy się z http://aven.localhost:3000)
pnpm dev:mobile         # Expo; adres serwera: EXPO_PUBLIC_AVEN_API (symulator iOS: http://127.0.0.1:3000)
```

Logowanie w aplikacjach: przycisk „Zaloguj się kontem Monorise” otwiera ekran logowania Core w przeglądarce systemowej. Aplikacja na komputer odbiera powrót na `http://127.0.0.1:<port>/oauth/callback` (RFC 8252), aplikacja na telefon przez `avenmail://` (w Expo Go przez `exp://127.0.0.1:8081`, dlatego Metro startuje z `--localhost`). Tokeny trzymają w systemowym sejfie: Pęk kluczy macOS, Credential Manager, Secret Service, Keychain i Keystore na telefonie. Adresy powrotu rejestruje w lokalnym Core `pnpm oauth:seed`.

Baza: PostgreSQL z Prismą (ADR-0096), lokalnie w Dockerze. Serwer łączy się rolą `aven_mail_app`, którą obowiązuje RLS: skrzynkę widzi tylko jej właściciel w swojej firmie (ADR-0037). Zmiana schematu: `packages/db/prisma/schema.prisma`, potem w `packages/db` `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (różnica między lokalną bazą po `pnpm db:migrate` a schematem) do nowego katalogu migracji, z RLS dla nowych tabel z danymi osób i firm.

## Kontrole

```bash
pnpm check              # formatowanie, zgodność wersji, lint, typy, testy, build (wymaga pnpm db:up)
AVEN_TEST_IMAP_HOST=127.0.0.1 pnpm test   # testy silnika i API na GreenMail
```

## Wersje

Jedna wersja wszystkich części (ADR-0087): Release Please liczy ją z commitów i wpisuje do `package.json` każdej części i do `Cargo.toml`; Tauri i Expo czytają ją z `package.json`, a numer kompilacji na telefony jest z niej wyliczany. `pnpm check:versions` odrzuca każdą rozbieżność.

Wspólne biblioteki `@monorise-team/*` mają w AvenMail zawsze jedną, dokładną wersję. Aktualizacja: Renovate (pull request co tydzień) albo ręcznie `pnpm shared:update` (`latest`, `dev` albo numer wersji).

Zasady pracy: [CONTRIBUTING.md organizacji](https://github.com/Monorise-Team/.github/blob/main/CONTRIBUTING.md).
