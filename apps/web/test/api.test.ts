/**
 * API na prawdziwych trasach Next.js: baza PGlite w pamięci i serwer poczty GreenMail
 * (`pnpm mail:test-server` albo usługa w CI). Część z GreenMail pomija się bez AVEN_TEST_IMAP_HOST.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import * as accounts from "@/app/api/v1/accounts/route";
import * as folders from "@/app/api/v1/accounts/[id]/folders/route";
import * as messages from "@/app/api/v1/accounts/[id]/messages/route";
import * as one from "@/app/api/v1/accounts/[id]/messages/[uid]/route";
import * as send from "@/app/api/v1/accounts/[id]/send/route";
import * as me from "@/app/api/v1/me/route";
import * as session from "@/app/api/v1/session/route";

const BASE = "http://aven.localhost:3000/api/v1";

function call<P>(
  handler: (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>,
  path: string,
  init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
  params = {} as P,
) {
  const headers: Record<string, string> = { host: "aven.localhost:3000", ...init.headers };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const request = new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return handler(request, { params: Promise.resolve(params) }).then(async (response) => ({
    status: response.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- w testach czytamy odpowiedzi API swobodnie
    body: (await response.json()) as { data: any; meta: { requestId: string }; error: any },
    response,
  }));
}

async function signIn(app = true) {
  const { body, response } = await call(session.POST, "/session", {
    method: "POST",
    body: { email: `anna-${randomUUID().slice(0, 6)}@acme.test`, name: "Anna Kowalska", app },
    headers: { origin: "http://aven.localhost:3000" },
  });
  return { token: body.data.token as string | null, cookie: response.headers.get("set-cookie") };
}

describe("API: sesja i błędy", () => {
  it("bez sesji odpowiada UNAUTHENTICATED w formacie { data, meta, error }", async () => {
    const { status, body } = await call(me.GET, "/me");
    expect(status).toBe(401);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.meta.requestId).toMatch(/^req_/);
  });

  it("aplikacja dostaje token, przeglądarka ciasteczko HttpOnly", async () => {
    const app = await signIn(true);
    expect(app.token).toBeTruthy();
    const { body } = await call(me.GET, "/me", { token: app.token! });
    expect(body.data.name).toBe("Anna Kowalska");

    const web = await signIn(false);
    expect(web.token).toBeNull();
    expect(web.cookie).toMatch(/aven_session=.*HttpOnly/i);
  });

  it("odrzuca zmianę z ciasteczkiem spoza strony (CSRF)", async () => {
    const { status, body } = await call(accounts.POST, "/accounts", {
      method: "POST",
      body: {},
      headers: { cookie: "aven_session=x", origin: "https://zla-strona.example" },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("PERMISSION_DENIED");
  });

  it("zwraca VALIDATION_FAILED z polami", async () => {
    const { token } = await signIn();
    const { status, body } = await call(accounts.POST, "/accounts", {
      method: "POST",
      token: token!,
      body: { email: "to-nie-adres", password: "" },
    });
    expect(status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.map((d: { field: string }) => d.field)).toContain("email");
  });

  it("nowy użytkownik nie ma skrzynek", async () => {
    const { token } = await signIn();
    const list = await call(accounts.GET, "/accounts", { token: token! });
    expect(list.body.data).toEqual([]);
  });
});

const host = process.env.AVEN_TEST_IMAP_HOST;

describe.skipIf(!host)("API z prawdziwym serwerem poczty (GreenMail)", () => {
  it("dodaje skrzynkę, wysyła, listuje, czyta, oznacza i usuwa", { timeout: 60_000 }, async () => {
    const { token } = await signIn();
    const email = `marek-${randomUUID().slice(0, 6)}@acme.test`;
    const created = await call(accounts.POST, "/accounts", {
      method: "POST",
      token: token!,
      body: {
        email,
        displayName: "Marek Nowak",
        password: "dowolne",
        imap: { host, port: 3143, security: "none" },
        smtp: { host, port: 3025, security: "none" },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).not.toHaveProperty("password");
    const id = created.body.data.id as string;

    const subject = `Plan wdrożenia ${randomUUID().slice(0, 6)}`;
    const sent = await call(
      send.POST,
      `/accounts/${id}/send`,
      {
        method: "POST",
        token: token!,
        body: { to: [{ name: null, address: email }], subject, text: "Szkolenie w poniedziałek, start w środę." },
      },
      { id },
    );
    expect(sent.status).toBe(200);

    let uid = 0;
    for (let i = 0; i < 20 && !uid; i++) {
      const page = await call(messages.GET, `/accounts/${id}/messages?folder=INBOX`, { token: token! }, { id });
      uid = page.body.data.messages.find((m: { subject: string }) => m.subject === subject)?.uid ?? 0;
      if (!uid) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(uid).toBeGreaterThan(0);

    const list = await call(folders.GET, `/accounts/${id}/folders`, { token: token! }, { id });
    expect(list.body.data[0].role).toBe("inbox");

    const opened = await call(
      one.GET,
      `/accounts/${id}/messages/${uid}?folder=INBOX`,
      { token: token! },
      { id, uid: String(uid) },
    );
    expect(opened.body.data.text).toContain("start w środę");

    const flagged = await call(
      one.PATCH,
      `/accounts/${id}/messages/${uid}?folder=INBOX`,
      {
        method: "PATCH",
        token: token!,
        body: { seen: true, flagged: true },
      },
      { id, uid: String(uid) },
    );
    expect(flagged.status).toBe(200);

    const removed = await call(
      one.DELETE,
      `/accounts/${id}/messages/${uid}?folder=INBOX`,
      {
        method: "DELETE",
        token: token!,
      },
      { id, uid: String(uid) },
    );
    expect(removed.body.data.permanently).toBe(true);
  });

  it("zły port daje MAIL_CONNECTION_FAILED i nie zapisuje skrzynki", async () => {
    const { token } = await signIn();
    const result = await call(accounts.POST, "/accounts", {
      method: "POST",
      token: token!,
      body: {
        email: "ola@acme.test",
        password: "x",
        imap: { host, port: 3999, security: "none" },
        smtp: { host, port: 3025, security: "none" },
      },
    });
    expect(result.status).toBe(502);
    expect(result.body.error.code).toBe("MAIL_CONNECTION_FAILED");
  });
});
