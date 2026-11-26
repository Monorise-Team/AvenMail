import { describe, expect, it } from "vitest";
import { ApiError, createClient } from "../src/index.js";

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}) {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("klient API", () => {
  it("dokleja /api/v1, token aplikacji i koduje folder", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const client = createClient({
      baseUrl: "https://aven.monorise.studio",
      getToken: () => "tajny-token",
      fetch: fakeFetch(
        200,
        { data: { folder: "INBOX/Klienci", messages: [], total: 0, page: 1, pageSize: 50 }, meta: {}, error: null },
        seen,
      ),
    });
    const page = await client.mail.messages("acc_1", "INBOX/Klienci");
    expect(page.total).toBe(0);
    expect(seen.url).toBe(
      "https://aven.monorise.studio/api/v1/accounts/acc_1/messages?folder=INBOX%2FKlienci&page=1&pageSize=50",
    );
    expect((seen.init?.headers as Record<string, string>).Authorization).toBe("Bearer tajny-token");
    expect(seen.init?.credentials).toBe("omit");
  });

  it("w przeglądarce używa ciasteczka zamiast tokenu", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const client = createClient({ fetch: fakeFetch(200, { data: [], meta: {}, error: null }, seen) });
    await client.accounts.list();
    expect(seen.init?.credentials).toBe("same-origin");
    expect((seen.init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("zamienia błąd API na ApiError z kodem", async () => {
    const client = createClient({
      fetch: fakeFetch(422, {
        data: null,
        meta: {},
        error: { code: "MAIL_AUTH_FAILED", message: "IMAP: serwer odrzucił login albo hasło", details: [] },
      }),
    });
    const error = await client.accounts.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "MAIL_AUTH_FAILED", status: 422 });
  });

  it("zwraca INTERNAL_ERROR przy błędzie sieci lub nie-JSON z serwera", async () => {
    const networkClient = createClient({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    const networkError = await networkClient.accounts.list().catch((e: unknown) => e);
    expect(networkError).toBeInstanceOf(ApiError);
    expect(networkError).toMatchObject({ code: "INTERNAL_ERROR", status: 0 });

    const htmlClient = createClient({
      fetch: (async () =>
        new Response("Bad Gateway", {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        })) as unknown as typeof fetch,
    });
    const serverError = await htmlClient.accounts.list().catch((e: unknown) => e);
    expect(serverError).toBeInstanceOf(ApiError);
    expect(serverError).toMatchObject({ code: "INTERNAL_ERROR", status: 502 });
  });
});
