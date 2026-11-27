import { describe, expect, it } from "vitest";
import {
  canManageMailboxes,
  canReadMail,
  canSendMail,
  DEFAULT_NO_ACCESS_MESSAGE,
  DEFAULT_NO_ROLE_MESSAGE,
  normalizeMailPathname,
  readAccountParam,
  resolveAccessDenialMessage,
  sanitizeReturnTo,
} from "../src/lib/access.js";

describe("stan dostępu do AvenMail i bezpieczny powrót po logowaniu", () => {
  it("blokuje dostęp, gdy konto nie ma włączonego produktu AvenMail", () => {
    expect(
      resolveAccessDenialMessage({
        hasProductAccess: false,
        readMail: false,
        sendMail: false,
        manageMailboxes: false,
      }),
    ).toBe(DEFAULT_NO_ACCESS_MESSAGE);
  });

  it("blokuje dostęp, gdy produkt jest włączony, ale konto nie ma żadnej roli", () => {
    expect(
      resolveAccessDenialMessage({
        hasProductAccess: true,
        readMail: false,
        sendMail: false,
        manageMailboxes: false,
      }),
    ).toBe(DEFAULT_NO_ROLE_MESSAGE);
  });

  it("wpuszcza osobę z dostępem do produktu i co najmniej jednym uprawnieniem", () => {
    const userCaps = {
      hasProductAccess: true,
      readMail: true,
      sendMail: true,
      manageMailboxes: false,
    };
    expect(resolveAccessDenialMessage(userCaps)).toBeNull();
    expect(canReadMail(userCaps)).toBe(true);
    expect(canSendMail(userCaps)).toBe(true);
    expect(canManageMailboxes(userCaps)).toBe(false);

    const adminCaps = { ...userCaps, manageMailboxes: true };
    expect(resolveAccessDenialMessage(adminCaps)).toBeNull();
    expect(canManageMailboxes(adminCaps)).toBe(true);
  });

  it("normalizuje prefiks /mail, czyści auth_error i chroni returnTo przed otwartym przekierowaniem", () => {
    expect(normalizeMailPathname("/mail")).toBe("/");
    expect(normalizeMailPathname("/mail/")).toBe("/");
    expect(normalizeMailPathname("/mail/inbox")).toBe("/inbox");
    expect(sanitizeReturnTo("/mail", "?account=acc-1&auth_error=expired")).toBe("/?account=acc-1");
    expect(sanitizeReturnTo("//evil.test/login")).toBe("/");
    expect(readAccountParam("?account=019a-1")).toBe("019a-1");
    expect(readAccountParam("?account=   ")).toBeNull();
  });
});
