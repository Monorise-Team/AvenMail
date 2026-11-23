import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashToken } from "@/server/crypto";
import { uuidv7 } from "@aven/db";

describe("szyfrowanie haseł do skrzynek", () => {
  it("odszyfrowuje tylko z tym samym kontekstem", () => {
    const secret = encryptSecret("hasło-aplikacji", "mail_accounts:a:u");
    expect(secret).toMatch(/^v1\./);
    expect(secret).not.toContain("hasło");
    expect(decryptSecret(secret, "mail_accounts:a:u")).toBe("hasło-aplikacji");
    expect(() => decryptSecret(secret, "mail_accounts:b:u")).toThrow();
  });

  it("wykrywa zmieniony szyfrogram", () => {
    const [version, iv, tag, data] = encryptSecret("x", "c").split(".");
    const tampered = [version, iv, tag, `${data!.slice(0, -2)}AA`].join(".");
    expect(() => decryptSecret(tampered, "c")).toThrow();
  });

  it("ten sam tekst daje inny szyfrogram (losowy IV)", () => {
    expect(encryptSecret("x", "c")).not.toBe(encryptSecret("x", "c"));
  });

  it("skrót tokenu i UUID v7", () => {
    expect(hashToken("abc")).toHaveLength(64);
    const id = uuidv7(Date.parse("2026-11-23T12:00:00Z"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv7(1) < uuidv7(2)).toBe(true);
  });
});
