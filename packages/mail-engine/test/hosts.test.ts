import { describe, expect, it } from "vitest";
import { folderRole, isPrivateAddress, resolveMailHost } from "../src/index.js";

const STRICT = { allowPrivateHosts: false, allowInsecure: false };

describe("ochrona przed łączeniem z siecią wewnętrzną", () => {
  it.each([
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.20.0.1",
    "192.168.1.10",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("%s to adres prywatny", (address) => expect(isPrivateAddress(address)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2a00:1450:4001::1"])("%s to adres publiczny", (address) =>
    expect(isPrivateAddress(address)).toBe(false),
  );

  it("odrzuca serwer w sieci prywatnej i port spoza IMAP", async () => {
    await expect(resolveMailHost("127.0.0.1", 993, "imap", STRICT)).rejects.toMatchObject({
      code: "MAIL_HOST_NOT_ALLOWED",
    });
    await expect(resolveMailHost("8.8.8.8", 22, "imap", STRICT)).rejects.toMatchObject({
      code: "MAIL_HOST_NOT_ALLOWED",
    });
    await expect(resolveMailHost("8.8.8.8", 993, "imap", STRICT)).resolves.toBe("8.8.8.8");
  });

  it("lokalnie i w testach pozwala na serwer w sieci prywatnej", async () => {
    await expect(
      resolveMailHost("127.0.0.1", 3143, "imap", { allowPrivateHosts: true, allowInsecure: true }),
    ).resolves.toBe("127.0.0.1");
  });
});

describe("role folderów", () => {
  it("rozpoznaje INBOX, znaczniki serwera i polskie nazwy", () => {
    expect(folderRole({ path: "INBOX", name: "INBOX", specialUse: undefined })).toBe("inbox");
    expect(folderRole({ path: "Foo", name: "Foo", specialUse: "\\Sent" })).toBe("sent");
    expect(folderRole({ path: "INBOX.Kosz", name: "Kosz", specialUse: undefined })).toBe("trash");
    expect(folderRole({ path: "Wysłane", name: "Wysłane", specialUse: undefined })).toBe("sent");
    expect(folderRole({ path: "Klienci", name: "Klienci", specialUse: undefined })).toBeNull();
  });
});
