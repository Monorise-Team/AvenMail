/**
 * API na prawdziwych trasach Next.js: PostgreSQL z RLS (pnpm db:up && pnpm db:migrate albo usługa w CI)
 * i serwer poczty GreenMail (`pnpm mail:test-server`). Część z GreenMail pomija się bez AVEN_TEST_IMAP_HOST.
 * Tokeny podpisuje testowy klucz „Core” (test/setup.ts).
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import * as accounts from "@/app/api/v1/accounts/route";
import * as folders from "@/app/api/v1/accounts/[id]/folders/route";
import * as mailbox from "@/app/api/v1/accounts/[id]/route";
import * as messages from "@/app/api/v1/accounts/[id]/messages/route";
import * as one from "@/app/api/v1/accounts/[id]/messages/[uid]/route";
import * as send from "@/app/api/v1/accounts/[id]/send/route";
import * as me from "@/app/api/v1/me/route";
import * as signInRoute from "@/app/api/auth/sign-in/route";
import { route } from "@/server/api";
import { API, CORE, coreToken } from "./setup";

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

const ACME = randomUUID();

/** Osoba zalogowana w Core: token, jaki dostaje aplikacja na komputer albo telefon. */
async function signIn(organizationId = ACME) {
  const userId = randomUUID();
  return { userId, organizationId, token: await coreToken({ userId, organizationId }) };
}

describe("API: sesja i błędy", () => {
  it("bez sesji odpowiada UNAUTHENTICATED w formacie { data, meta, error }", async () => {
    const { status, body } = await call(me.GET, "/me");
    expect(status).toBe(401);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.meta.requestId).toMatch(/^req_/);
  });

  it("przyjmuje token z Core i podaje osobę z jej firmą", async () => {
    const anna = await signIn();
    const { status, body } = await call(me.GET, "/me", { token: anna.token });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: anna.userId, organizationId: ACME });
  });

  it("odrzuca token dla innego API i token po terminie", async () => {
    const userId = randomUUID();
    const otherApi = await coreToken({ userId, organizationId: ACME, audience: "http://localhost:3200" });
    expect((await call(me.GET, "/me", { token: otherApi })).status).toBe(401);
    const expired = await coreToken({ userId, organizationId: ACME, expiresIn: "-1m" });
    expect((await call(me.GET, "/me", { token: expired })).body.error.code).toBe("UNAUTHENTICATED");
  });

  it("logowanie w przeglądarce przekierowuje do Core z PKCE i oboma API", async () => {
    const response = await signInRoute.GET(new Request("http://aven-mail.localhost:3000/api/auth/sign-in?returnTo=/"));
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location") ?? "");
    expect(`${target.origin}${target.pathname}`).toBe(`${CORE}/api/auth/oauth2/authorize`);
    expect(target.searchParams.get("client_id")).toBe("avenmail-web");
    expect(target.searchParams.get("redirect_uri")).toBe("http://aven-mail.localhost:3000/api/auth/callback");
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.getAll("resource")).toEqual([API, "http://localhost:3200"]);
    expect(response.headers.get("set-cookie")).toMatch(/^monorise-oauth=.*HttpOnly; SameSite=Lax/);
  });

  it("odrzuca zmianę z ciasteczkiem spoza strony (CSRF)", async () => {
    const { status, body } = await call(accounts.POST, "/accounts", {
      method: "POST",
      body: {},
      headers: { cookie: "monorise-session=x", origin: "https://zla-strona.example" },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("PERMISSION_DENIED");
  });

  it("zwraca VALIDATION_FAILED z polami", async () => {
    const { token } = await signIn();
    const { status, body } = await call(accounts.POST, "/accounts", {
      method: "POST",
      token,
      body: { email: "to-nie-adres", password: "" },
    });
    expect(status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.map((d: { field: string }) => d.field)).toContain("email");
  });

  it("zwraca INTERNAL_ERROR (500) przy nieoczekiwanym błędzie trasy", async () => {
    const failing = route(async () => {
      throw new Error("nieoczekiwany błąd");
    });
    const { status, body } = await call(failing, "/boom");
    expect(status).toBe(500);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("nowa osoba nie ma skrzynek, a zły identyfikator skrzynki to NOT_FOUND", async () => {
    const { token } = await signIn();
    const list = await call(accounts.GET, "/accounts", { token });
    expect(list.body.data).toEqual([]);
    const missing = await call(folders.GET, "/accounts/nie-uuid/folders", { token }, { id: "nie-uuid" });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });
});

const host = process.env.AVEN_TEST_IMAP_HOST;

describe.skipIf(!host)("API z prawdziwym serwerem poczty (GreenMail)", () => {
  it("dodaje skrzynkę, wysyła, listuje, czyta, oznacza i usuwa", { timeout: 60_000 }, async () => {
    const { token } = await signIn();
    const email = `marek-${randomUUID().slice(0, 6)}@acme.test`;
    const created = await call(accounts.POST, "/accounts", {
      method: "POST",
      token,
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
        token,
        body: { to: [{ name: null, address: email }], subject, text: "Szkolenie w poniedziałek, start w środę." },
      },
      { id },
    );
    expect(sent.status).toBe(200);

    let uid = 0;
    for (let i = 0; i < 20 && !uid; i++) {
      const page = await call(messages.GET, `/accounts/${id}/messages?folder=INBOX`, { token }, { id });
      uid = page.body.data.messages.find((m: { subject: string }) => m.subject === subject)?.uid ?? 0;
      if (!uid) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(uid).toBeGreaterThan(0);

    const list = await call(folders.GET, `/accounts/${id}/folders`, { token }, { id });
    expect(list.body.data[0].role).toBe("inbox");

    const opened = await call(
      one.GET,
      `/accounts/${id}/messages/${uid}?folder=INBOX`,
      { token },
      { id, uid: String(uid) },
    );
    expect(opened.body.data.text).toContain("start w środę");

    const flagged = await call(
      one.PATCH,
      `/accounts/${id}/messages/${uid}?folder=INBOX`,
      {
        method: "PATCH",
        token,
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
        token,
      },
      { id, uid: String(uid) },
    );
    expect(removed.body.data.permanently).toBe(true);
  });

  it("skrzynki Anny nie widzi ani nie usunie Bartek z jej firmy ani nikt z innej firmy", async () => {
    const anna = await signIn();
    const created = await call(accounts.POST, "/accounts", {
      method: "POST",
      token: anna.token,
      body: {
        email: `anna-${randomUUID().slice(0, 6)}@acme.test`,
        password: "dowolne",
        imap: { host, port: 3143, security: "none" },
        smtp: { host, port: 3025, security: "none" },
      },
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    for (const other of [await signIn(), await signIn(randomUUID())]) {
      expect((await call(accounts.GET, "/accounts", { token: other.token })).body.data).toEqual([]);
      expect((await call(folders.GET, `/accounts/${id}/folders`, { token: other.token }, { id })).status).toBe(404);
      const removed = await call(mailbox.DELETE, `/accounts/${id}`, { method: "DELETE", token: other.token }, { id });
      expect(removed.status).toBe(404);
    }
    expect((await call(accounts.GET, "/accounts", { token: anna.token })).body.data).toHaveLength(1);
  });

  it("zły port daje MAIL_CONNECTION_FAILED i nie zapisuje skrzynki", async () => {
    const { token } = await signIn();
    const result = await call(accounts.POST, "/accounts", {
      method: "POST",
      token,
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
