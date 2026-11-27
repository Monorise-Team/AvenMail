import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AVENMAIL_PERMISSION_MANIFEST, AVENMAIL_ROLE_TEMPLATES } from "@aven/contracts";
import { createFakeCore } from "@monorise-team/testing";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_PERMISSIONS_REGISTER_SCOPE,
  CoreRegistrationError,
  formatRegistrationStep,
  parseDotEnv,
  registerWithCore,
  resolveRegistrationConfig,
  type RegistrationStepEvent,
} from "@/server/core-registration";

const BASE_CONFIG = {
  coreAuthUrl: "http://core-auth.test/",
  coreApiUrl: "http://core-api.test/",
  clientId: "avenmail-web",
  clientSecret: "tajny-sekret-klienta-tylko-do-testow",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("rejestracja uprawnień i gotowych ról w MonoriseCore", () => {
  it("pobiera token maszynowy, rejestruje manifest uprawnień, a potem gotowe role w tej kolejności", async () => {
    const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
    const permissionsSummary = {
      added: ["avenmail.mail.read"],
      updated: [],
      deprecated: [],
      restored: [],
      unchanged: 2,
    };
    const roleTemplatesSummary = {
      added: ["avenmail.user", "avenmail.admin"],
      updated: [],
      archived: [],
      restored: [],
      unchanged: 0,
    };

    const fakeFetch: typeof fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, method: init?.method ?? "GET", headers, body });

      if (calls.length === 1) {
        return jsonResponse({ access_token: "token-maszynowy-test", expires_in: 300, token_type: "Bearer" });
      }
      if (calls.length === 2) {
        return jsonResponse({ data: permissionsSummary, meta: { requestId: "req_perm" }, error: null });
      }
      return jsonResponse({ data: roleTemplatesSummary, meta: { requestId: "req_roles" }, error: null });
    });

    const events: RegistrationStepEvent[] = [];
    const result = await registerWithCore({
      ...BASE_CONFIG,
      fetch: fakeFetch,
      onStep: (event) => events.push(event),
    });

    expect(result).toEqual({
      permissions: permissionsSummary,
      roleTemplates: roleTemplatesSummary,
    });
    expect(calls).toHaveLength(3);

    const tokenCall = calls[0]!;
    expect(tokenCall.method).toBe("POST");
    expect(tokenCall.url).toBe("http://core-auth.test/api/auth/oauth2/token");
    expect(tokenCall.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    const tokenParams = new URLSearchParams(tokenCall.body);
    expect(tokenParams.get("grant_type")).toBe("client_credentials");
    expect(tokenParams.get("client_id")).toBe("avenmail-web");
    expect(tokenParams.get("client_secret")).toBe(BASE_CONFIG.clientSecret);
    expect(tokenParams.get("resource")).toBe("http://core-api.test");
    expect(tokenParams.get("scope")).toBe(CORE_PERMISSIONS_REGISTER_SCOPE);

    const permissionsCall = calls[1]!;
    expect(permissionsCall.method).toBe("PUT");
    expect(permissionsCall.url).toBe("http://core-api.test/core/v1/products/avenmail/permissions");
    expect(permissionsCall.headers.get("authorization")).toBe("Bearer token-maszynowy-test");
    expect(JSON.parse(permissionsCall.body)).toEqual(AVENMAIL_PERMISSION_MANIFEST);

    const templatesCall = calls[2]!;
    expect(templatesCall.method).toBe("PUT");
    expect(templatesCall.url).toBe("http://core-api.test/core/v1/products/avenmail/role-templates");
    expect(templatesCall.headers.get("authorization")).toBe("Bearer token-maszynowy-test");
    expect(JSON.parse(templatesCall.body)).toEqual(AVENMAIL_ROLE_TEMPLATES);

    const lines = events.map(formatRegistrationStep);
    expect(lines).toEqual([
      "1/3 Token maszynowy pobrany dla klienta avenmail-web.",
      "2/3 Uprawnienia (avenmail): dodano 1 (avenmail.mail.read), zaktualizowano 0, wycofano 0, przywrócono 0, bez zmian 2.",
      "3/3 Gotowe role (avenmail): dodano 2 (avenmail.user, avenmail.admin), zaktualizowano 0, zarchiwizowano 0, przywrócono 0, bez zmian 0.",
    ]);
    for (const line of lines) {
      expect(line).not.toContain(BASE_CONFIG.clientSecret);
      expect(line).not.toContain("token-maszynowy-test");
    }
  });

  it("zwraca czytelny błąd po odrzuceniu prośby o token i nie ujawnia sekretu", async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse(
        {
          error: "invalid_client",
          error_description: "Nieprawidłowe dane uwierzytelniające klienta",
        },
        401,
      ),
    );

    const error = await registerWithCore({ ...BASE_CONFIG, fetch: fakeFetch }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CoreRegistrationError);
    const regError = error as CoreRegistrationError;
    expect(regError.step).toBe("token");
    expect(regError.status).toBe(401);
    expect(regError.code).toBe("invalid_client");
    expect(regError.message).not.toContain(BASE_CONFIG.clientSecret);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("zwraca status, kod, komunikat i szczegóły przy błędzie 422 z Core API", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-maszynowy-test", expires_in: 300 }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { added: [], updated: [], deprecated: [], restored: [], unchanged: 3 },
          meta: { requestId: "req_perm" },
          error: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: null,
            meta: { requestId: "req_err" },
            error: {
              code: "VALIDATION_FAILED",
              message: "Nieznane lub wycofane uprawnienie w szablonie roli",
              details: [
                {
                  field: "1.permissions.0",
                  message: 'Uprawnienie "avenmail.nieistniejace" nie jest zarejestrowane',
                },
              ],
            },
          },
          422,
        ),
      );

    const error = await registerWithCore({ ...BASE_CONFIG, fetch: fakeFetch }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CoreRegistrationError);
    const regError = error as CoreRegistrationError;
    expect(regError.step).toBe("roleTemplates");
    expect(regError.status).toBe(422);
    expect(regError.code).toBe("VALIDATION_FAILED");
    expect(regError.details).toEqual([
      {
        field: "1.permissions.0",
        message: 'Uprawnienie "avenmail.nieistniejace" nie jest zarejestrowane',
      },
    ]);
    expect(regError.message).not.toContain("token-maszynowy-test");
    expect(regError.message).not.toContain(BASE_CONFIG.clientSecret);
  });

  it("przerywa po błędzie rejestracji uprawnień i nie wysyła gotowych ról", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-maszynowy-test", expires_in: 300 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: null,
            meta: { requestId: "req_denied" },
            error: {
              code: "PERMISSION_DENIED",
              message: "Ten klient nie może rejestrować uprawnień wskazanego produktu",
              details: [],
            },
          },
          403,
        ),
      );

    const error = await registerWithCore({ ...BASE_CONFIG, fetch: fakeFetch }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CoreRegistrationError);
    expect((error as CoreRegistrationError).step).toBe("permissions");
    expect((error as CoreRegistrationError).status).toBe(403);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("zgłasza brakujące zmienne środowiskowe bez wywoływania fetch", async () => {
    const fakeFetch = vi.fn<typeof fetch>();
    const config = resolveRegistrationConfig({});

    const error = await registerWithCore({ ...config, fetch: fakeFetch }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CoreRegistrationError);
    const regError = error as CoreRegistrationError;
    expect(regError.step).toBe("config");
    expect(regError.message).toContain("CORE_AUTH_URL");
    expect(regError.message).toContain("CORE_API_URL");
    expect(regError.message).toContain("AVEN_OAUTH_CLIENT_ID");
    expect(regError.message).toContain("AVEN_OAUTH_CLIENT_SECRET");
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("czyta fallback z pliku .env.local, ale daje pierwszeństwo zmiennym środowiskowym", () => {
    const dir = mkdtempSync(join(tmpdir(), "avenmail-reg-"));
    try {
      const envFilePath = join(dir, ".env.local");
      writeFileSync(
        envFilePath,
        [
          "# Komentarz",
          "CORE_AUTH_URL=http://localhost:3100",
          'CORE_API_URL="http://localhost:3200"',
          "AVEN_OAUTH_CLIENT_ID=avenmail-web",
          "AVEN_OAUTH_CLIENT_SECRET=sekret=z=równością",
          "",
        ].join("\n"),
      );

      expect(parseDotEnv("export FOO='bar'\n# skip\nEMPTY=")).toEqual({ FOO: "bar", EMPTY: "" });

      expect(resolveRegistrationConfig({}, { envFilePath })).toEqual({
        coreAuthUrl: "http://localhost:3100",
        coreApiUrl: "http://localhost:3200",
        clientId: "avenmail-web",
        clientSecret: "sekret=z=równością",
      });

      expect(
        resolveRegistrationConfig(
          {
            CORE_API_URL: "https://api.example.test",
            AVEN_OAUTH_CLIENT_SECRET: "sekret-ze-srodowiska",
          },
          { envFilePath },
        ),
      ).toEqual({
        coreAuthUrl: "http://localhost:3100",
        coreApiUrl: "https://api.example.test",
        clientId: "avenmail-web",
        clientSecret: "sekret-ze-srodowiska",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejestruje manifest i gotowe role idempotentnie w atrapie MonoriseCore (createFakeCore)", async () => {
    const fakeCore = await createFakeCore({
      issuer: "http://core-auth.test",
      coreApiUrl: "http://core-api.test",
      products: [{ key: "avenmail", clientId: BASE_CONFIG.clientId, clientSecret: BASE_CONFIG.clientSecret }],
    });

    const first = await registerWithCore({ ...BASE_CONFIG, fetch: fakeCore.fetch });
    expect(first.permissions.added).toHaveLength(AVENMAIL_PERMISSION_MANIFEST.length);
    expect(first.permissions.unchanged).toBe(0);
    expect(first.roleTemplates.added).toEqual(["avenmail.admin", "avenmail.user"]);
    expect(fakeCore.registrations.permissions).toHaveLength(1);
    expect(fakeCore.registrations.roleTemplates).toHaveLength(1);

    const second = await registerWithCore({ ...BASE_CONFIG, fetch: fakeCore.fetch });
    expect(second.permissions.added).toEqual([]);
    expect(second.permissions.unchanged).toBe(AVENMAIL_PERMISSION_MANIFEST.length);
    expect(second.roleTemplates.added).toEqual([]);
    expect(second.roleTemplates.unchanged).toBe(AVENMAIL_ROLE_TEMPLATES.length);
  });
});
