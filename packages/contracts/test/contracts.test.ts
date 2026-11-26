import { describe, expect, it } from "vitest";
import {
  detectProvider,
  ERROR_CODES,
  guessServers,
  MailAccountInput,
  PageQuery,
  PROVIDER_PRESETS,
  SendRequest,
} from "../src/index.js";

describe("dostawcy poczty", () => {
  it("rozpoznaje dostawcę po domenie", () => {
    expect(detectProvider("anna@wp.pl")?.id).toBe("wp");
    expect(detectProvider("Anna@Gmail.com")?.imap.host).toBe("imap.gmail.com");
    expect(detectProvider("anna@acme.com")).toBeNull();
  });

  it("proponuje imap. i smtp. dla nieznanej domeny", () => {
    expect(guessServers("anna@acme.com")).toEqual({
      imap: { host: "imap.acme.com", port: 993, security: "ssl" },
      smtp: { host: "smtp.acme.com", port: 465, security: "ssl" },
    });
    expect(guessServers("bez-domeny")).toBeNull();
  });

  it("każda domena należy do jednego dostawcy", () => {
    const domains = PROVIDER_PRESETS.flatMap((preset) => preset.domains);
    expect(new Set(domains).size).toBe(domains.length);
  });
});

describe("schematy", () => {
  it("odrzuca nazwę serwera z niedozwolonymi znakami", () => {
    const result = MailAccountInput.safeParse({
      email: "anna@acme.com",
      password: "x",
      imap: { host: "imap.acme.com/../", port: 993, security: "ssl" },
      smtp: { host: "smtp.acme.com", port: 465, security: "ssl" },
    });
    expect(result.success).toBe(false);
  });

  it("strona wiadomości ma domyślnie INBOX i 50 pozycji", () => {
    expect(PageQuery.parse({})).toEqual({ folder: "INBOX", page: 1, pageSize: 50 });
  });

  it("wiadomość wymaga co najmniej jednego odbiorcy", () => {
    expect(SendRequest.safeParse({ to: [], text: "Cześć" }).success).toBe(false);
    expect(SendRequest.parse({ to: [{ name: null, address: "anna@acme.com" }], text: "Cześć" })).toMatchObject({
      cc: [],
      bcc: [],
      subject: "",
    });
  });

  it("używa kodu INTERNAL_ERROR dla błędów serwera", () => {
    expect(ERROR_CODES).toContain("INTERNAL_ERROR");
    expect(ERROR_CODES).not.toContain("INTERNAL");
  });
});
