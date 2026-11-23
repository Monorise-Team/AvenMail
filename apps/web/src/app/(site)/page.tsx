import { AppBackdrop, Badge, Button, Card } from "@monorise-team/ui";
import { Inbox, Keyboard, Laptop, Lock, Mail, MonitorSmartphone, Smartphone, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

const MAIL_URL = process.env.AVEN_MAIL_URL ?? "https://aven-mail.monorise.studio";

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Inbox />,
    title: "Bez przeprowadzki",
    body: "Skrzynki zostają tam, gdzie są: w home.pl, OVH, WP, Onecie czy Gmailu. AvenMail łączy się z nimi przez IMAP i SMTP.",
  },
  {
    icon: <Lock />,
    title: "Treść zostaje u dostawcy",
    body: "Nie zapisujemy treści maili na naszych serwerach. Pobieramy wiadomość, kiedy ją otwierasz, a hasło do skrzynki trzymamy zaszyfrowane.",
  },
  {
    icon: <Keyboard />,
    title: "Szybko z klawiatury",
    body: "J i K przechodzą między wiadomościami, R odpowiada, C zaczyna nową. Myszka przydaje się rzadziej, niż myślisz.",
  },
  {
    icon: <Sparkles />,
    title: "Spokojny wygląd",
    body: "Szklane panele na tle, tryb jasny i ciemny, kilka motywów. Ten sam wygląd w przeglądarce, na komputerze i na telefonie.",
  },
];

const PLATFORMS: { icon: ReactNode; title: string; body: string; status: "ready" | "soon" }[] = [
  { icon: <MonitorSmartphone />, title: "Przeglądarka", body: "aven-mail.monorise.studio", status: "ready" },
  { icon: <Laptop />, title: "Komputer", body: "Windows, macOS i Linux", status: "soon" },
  { icon: <Smartphone />, title: "Telefon", body: "iPhone i Android", status: "soon" },
];

export default function ProductPage() {
  return (
    <>
      <AppBackdrop />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <a href="/" className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
          <span className="mr-glow flex size-8 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <Mail className="size-4" aria-hidden />
          </span>
          AvenMail
        </a>
        <nav aria-label="Strona" className="hidden gap-6 text-sm text-text-secondary sm:flex">
          <a href="#funkcje" className="hover:text-text-primary">
            Funkcje
          </a>
          <a href="#platformy" className="hover:text-text-primary">
            Platformy
          </a>
          <a href="https://monorise.studio" className="hover:text-text-primary">
            Monorise
          </a>
        </nav>
        <Button asChild variant="primary" size="md" className="rounded-full">
          <a href={MAIL_URL}>Otwórz pocztę</a>
        </Button>
      </header>

      <main id="main" className="mx-auto flex max-w-6xl flex-col gap-24 px-6 pt-12 pb-24">
        <section className="mr-enter flex max-w-3xl flex-col gap-6">
          <Badge tone="accent" className="w-fit px-2.5">
            Wczesna wersja
          </Badge>
          <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight sm:text-6xl">
            Firmowa poczta tam, gdzie pracujesz
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-text-secondary">
            AvenMail łączy się z pocztą, którą Twoja firma już ma. Czytasz i wysyłasz maile w przeglądarce, na
            komputerze i na telefonie, z jednym wyglądem i bez przenoszenia skrzynek.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="primary" size="lg" className="rounded-full">
              <a href={MAIL_URL}>Otwórz AvenMail w przeglądarce</a>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-full">
              <a href="#funkcje">Jak to działa</a>
            </Button>
          </div>
        </section>

        <section id="funkcje" aria-labelledby="funkcje-tytul" className="flex flex-col gap-6">
          <h2 id="funkcje-tytul" className="font-display text-2xl font-semibold">
            Co dostajesz
          </h2>
          <div className="grid gap-card sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <Card key={feature.title} surface="reading" className="flex flex-col gap-3 p-6">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent-light text-accent [&_svg]:size-5">
                  {feature.icon}
                </span>
                <h3 className="text-base font-semibold">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{feature.body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section id="platformy" aria-labelledby="platformy-tytul" className="flex flex-col gap-6">
          <h2 id="platformy-tytul" className="font-display text-2xl font-semibold">
            Jedna poczta, trzy miejsca
          </h2>
          <div className="grid gap-card sm:grid-cols-3">
            {PLATFORMS.map((platform) => (
              <Card key={platform.title} surface="middle" className="flex flex-col gap-2 p-6">
                <span className="text-accent [&_svg]:size-6">{platform.icon}</span>
                <h3 className="text-base font-semibold">{platform.title}</h3>
                <p className="text-sm text-text-secondary">{platform.body}</p>
                <Badge tone={platform.status === "ready" ? "success" : "neutral"} className="mt-2 w-fit px-2.5">
                  {platform.status === "ready" ? "Dostępne" : "W przygotowaniu"}
                </Badge>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-2 px-6 pb-10 text-sm text-text-tertiary sm:flex-row sm:justify-between">
        <span>© {new Date().getFullYear()} Monorise. AvenMail jest produktem Monorise.</span>
        <a href="https://monorise.studio" className="hover:text-text-primary">
          monorise.studio
        </a>
      </footer>
    </>
  );
}
