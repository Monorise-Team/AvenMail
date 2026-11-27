import { describe, expect, it } from "vitest";
import {
  ApiErrorResponse,
  apiSuccessSchema,
  AVENMAIL_PERMISSION_MANIFEST,
  AVENMAIL_PERMISSIONS,
  AVENMAIL_ROLE_TEMPLATES,
  Capabilities,
  detectProvider,
  ERROR_CODES,
  guessServers,
  Health,
  MailAccountInput,
  Me,
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

  it("używa kodu INTERNAL_ERROR i PRODUCT_ACCESS_REQUIRED w ERROR_CODES", () => {
    expect(ERROR_CODES).toContain("INTERNAL_ERROR");
    expect(ERROR_CODES).toContain("PRODUCT_ACCESS_REQUIRED");
    expect(ERROR_CODES).not.toContain("INTERNAL");
  });

  it("waliduje koperty sukcesu, błędu, Health i Me z capabilities", () => {
    const healthEnvelope = apiSuccessSchema(Health).parse({
      data: { status: "ok", version: "0.0.0" },
      meta: { requestId: "req_123" },
      error: null,
    });
    expect(healthEnvelope.data.status).toBe("ok");

    const errorEnvelope = ApiErrorResponse.parse({
      data: null,
      meta: { requestId: "req_123" },
      error: { code: "PRODUCT_ACCESS_REQUIRED", message: "Brak dostępu", details: [] },
    });
    expect(errorEnvelope.error.code).toBe("PRODUCT_ACCESS_REQUIRED");

    const caps = Capabilities.parse({
      hasProductAccess: true,
      readMail: true,
      sendMail: true,
      manageMailboxes: false,
    });
    const me = Me.parse({
      account: { id: "acc-1", email: "anna@acme.test" },
      employee: { id: "emp-1", firstName: "Anna", lastName: "Nowak", fullName: "Anna Nowak", jobTitle: null },
      organization: { id: "org-1", name: "Acme" },
      capabilities: caps,
    });
    expect(me.capabilities.readMail).toBe(true);
  });
});

describe("uprawnienia i gotowe role AvenMail", () => {
  it("deklaruje manifest uprawnień pod prefiksem avenmail.*", () => {
    expect(AVENMAIL_PERMISSIONS.product).toBe("avenmail");
    expect(AVENMAIL_PERMISSION_MANIFEST.map((item) => item.key)).toEqual([
      "avenmail.mail.read",
      "avenmail.mail.send",
      "avenmail.mailboxes.manage",
    ]);
    for (const entry of AVENMAIL_PERMISSION_MANIFEST) {
      expect(entry.description.length).toBeGreaterThan(5);
    }
  });

  it("definiuje gotowe role wyłącznie z zadeklarowanych uprawnień", () => {
    const manifestKeys = new Set<string>(AVENMAIL_PERMISSION_MANIFEST.map((item) => item.key));
    expect(AVENMAIL_ROLE_TEMPLATES.map((template) => template.key)).toEqual(["avenmail.user", "avenmail.admin"]);
    expect(AVENMAIL_ROLE_TEMPLATES.map((template) => template.name)).toEqual([
      "Użytkownik AvenMail",
      "Administrator AvenMail",
    ]);
    for (const template of AVENMAIL_ROLE_TEMPLATES) {
      expect(template.permissions.length).toBeGreaterThan(0);
      for (const perm of template.permissions) {
        expect(manifestKeys.has(perm)).toBe(true);
      }
    }
  });
});
