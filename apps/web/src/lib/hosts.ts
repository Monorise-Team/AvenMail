/**
 * Jedna aplikacja Next.js obsługuje dwa adresy (ADR-0088):
 *
 *   aven.monorise.studio       strona produktu i API /api/v1
 *   aven-mail.monorise.studio  poczta w przeglądarce (ścieżki aplikacji pod /mail)
 *
 * Lokalnie: aven.localhost:3000 i aven-mail.localhost:3000 (przeglądarki kierują *.localhost na 127.0.0.1).
 */
export const DEFAULT_MAIL_HOSTS = ["aven-mail.monorise.studio", "aven-mail.localhost"];

export function mailHosts(env: string | undefined = process.env.AVEN_MAIL_HOSTS): string[] {
  return (env ? env.split(",") : DEFAULT_MAIL_HOSTS).map((host) => host.trim().toLowerCase()).filter(Boolean);
}

/** Nazwa hosta bez portu, małymi literami. */
export function hostname(header: string | null): string {
  const host = (header ?? "").trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0] ?? "";
}

export type Route = { kind: "next" } | { kind: "rewrite"; pathname: string } | { kind: "not-found" };

/** Co zrobić z żądaniem strony (nie API): przepisać na /mail, przepuścić albo odpowiedzieć 404. */
export function routeFor(host: string, pathname: string, hosts: string[] = mailHosts()): Route {
  const isMailPath = pathname === "/mail" || pathname.startsWith("/mail/");
  if (hosts.includes(host)) {
    if (isMailPath) return { kind: "next" };
    return { kind: "rewrite", pathname: `/mail${pathname === "/" ? "" : pathname}` };
  }
  // Poczta działa tylko pod swoim adresem
  if (isMailPath) return { kind: "not-found" };
  return { kind: "next" };
}
