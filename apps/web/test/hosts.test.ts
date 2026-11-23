import { describe, expect, it } from "vitest";
import { hostname, mailHosts, routeFor } from "@/lib/hosts";

const HOSTS = mailHosts(undefined);

describe("dwa adresy z jednej aplikacji", () => {
  it("aven-mail. pokazuje pocztę: ścieżki przepisuje na /mail", () => {
    expect(routeFor("aven-mail.monorise.studio", "/", HOSTS)).toEqual({ kind: "rewrite", pathname: "/mail" });
    expect(routeFor("aven-mail.localhost", "/inbox", HOSTS)).toEqual({ kind: "rewrite", pathname: "/mail/inbox" });
  });

  it("aven. pokazuje stronę produktu, a poczta daje tam 404", () => {
    expect(routeFor("aven.monorise.studio", "/", HOSTS)).toEqual({ kind: "next" });
    expect(routeFor("aven.monorise.studio", "/mail", HOSTS)).toEqual({ kind: "not-found" });
    expect(routeFor("localhost", "/mail/inbox", HOSTS)).toEqual({ kind: "not-found" });
  });

  it("czyta nazwę hosta bez portu", () => {
    expect(hostname("Aven-Mail.localhost:3000")).toBe("aven-mail.localhost");
    expect(hostname(null)).toBe("");
  });

  it("lista adresów poczty z AVEN_MAIL_HOSTS", () => {
    expect(mailHosts("mail.example.test, Poczta.Example.test")).toEqual(["mail.example.test", "poczta.example.test"]);
  });
});
