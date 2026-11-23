import { describe, expect, it } from "vitest";
import { listDate, messageDocument, parseAddresses, prefixSubject, quoteForReply } from "../src/index.js";

describe("adresy i tematy", () => {
  it("czyta listę adresów z nazwami i wskazuje błędne", () => {
    expect(parseAddresses("Anna Kowalska <anna@acme.com>, marek@nowak.pl; zly-adres")).toEqual({
      addresses: [
        { name: "Anna Kowalska", address: "anna@acme.com" },
        { name: null, address: "marek@nowak.pl" },
      ],
      invalid: ["zly-adres"],
    });
  });

  it("nie dubluje Re: i Fwd:", () => {
    expect(prefixSubject("Re", "Faktura")).toBe("Re: Faktura");
    expect(prefixSubject("Re", "RE: Faktura")).toBe("RE: Faktura");
    expect(prefixSubject("Fwd", "Plan")).toBe("Fwd: Plan");
  });

  it("cytuje odpowiedź linijka po linijce", () => {
    const quoted = quoteForReply(
      "Cześć\nTermin 14 dni",
      { name: "Anna", address: "anna@acme.com" },
      "2026-11-23T09:41:00Z",
    );
    expect(quoted).toContain("Anna napisał(a):");
    expect(quoted).toContain("> Cześć\n> Termin 14 dni");
  });

  it("w liście pokazuje godzinę dla dzisiejszych i datę dla starszych", () => {
    const now = new Date("2026-11-23T12:00:00");
    expect(listDate("2026-11-23T09:41:00", now)).toMatch(/09:41|9:41/);
    expect(listDate("2025-01-05T09:41:00", now)).toMatch(/2025/);
  });
});

describe("bezpieczny HTML wiadomości", () => {
  it("usuwa skrypty i blokuje obrazy z internetu bez zgody", () => {
    const doc = messageDocument(
      '<p onclick="x()">Cześć</p><script>alert(1)</script><img src="https://tracker.example/p.gif">',
      {
        remoteImages: false,
      },
    );
    expect(doc).not.toContain("<script>alert");
    expect(doc).not.toContain("onclick");
    expect(doc).toContain("img-src data:;");
    expect(messageDocument("<p>x</p>", { remoteImages: true })).toContain("img-src data: https: http:;");
  });
});
