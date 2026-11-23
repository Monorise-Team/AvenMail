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

## Uruchomienie lokalne

Potrzebne: Node.js 24 (`.nvmrc`), pnpm 11, Docker (serwer poczty do testów), dla aplikacji na komputer [Rust i wymagania Tauri 2](https://v2.tauri.app/start/prerequisites/).

```bash
# raz: dostęp do paczek @monorise-team/* w GitHub Packages
gh auth refresh -h github.com -s read:packages
export GITHUB_PACKAGES_TOKEN=$(gh auth token)

pnpm install
pnpm setup:env          # apps/web/.env.local: klucz szyfrujący, logowanie deweloperskie
pnpm mail:test-server   # GreenMail: IMAP 3143, SMTP 3025 (każdy login i hasło działają)
pnpm dev                # http://aven.localhost:3000 (strona) i http://aven-mail.localhost:3000 (poczta)
```

Skrzynka testowa w GreenMail: dowolny adres, dowolne hasło, IMAP `127.0.0.1:3143`, SMTP `127.0.0.1:3025`, „Bez szyfrowania” (lokalnie dozwolone przez `AVEN_ALLOW_PRIVATE_MAIL_HOSTS=1`).

```bash
pnpm dev:desktop        # aplikacja na komputer (łączy się z http://aven.localhost:3000)
pnpm dev:mobile         # Expo; adres serwera: EXPO_PUBLIC_AVEN_API (symulator iOS: http://127.0.0.1:3000)
```

Baza: lokalnie PGlite (PostgreSQL w procesie, `apps/web/.data/`), na stagingu i produkcji PostgreSQL przez `DATABASE_URL`. Zmiana schematu: `pnpm --filter @aven/web db:generate`.

## Kontrole

```bash
pnpm check              # formatowanie, zgodność wersji, lint, typy, testy, build
AVEN_TEST_IMAP_HOST=127.0.0.1 pnpm test   # testy silnika i API na GreenMail
```

## Wersje

Jedna wersja wszystkich części (ADR-0087): Release Please liczy ją z commitów i wpisuje do `package.json` każdej części i do `Cargo.toml`; Tauri i Expo czytają ją z `package.json`, a numer kompilacji na telefony jest z niej wyliczany. `pnpm check:versions` odrzuca każdą rozbieżność.

Wspólne biblioteki `@monorise-team/*` mają w AvenMail zawsze jedną, dokładną wersję. Aktualizacja: Renovate (pull request co tydzień) albo ręcznie `pnpm shared:update` (`latest`, `dev` albo numer wersji).

Zasady pracy: [CONTRIBUTING.md organizacji](https://github.com/Monorise-Team/.github/blob/main/CONTRIBUTING.md).
