import { DevSignInRequest } from "@aven/contracts";
import { z } from "zod";
import { readJson, route } from "@/server/api";
import { devSignIn, signOut } from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

const Body = DevSignInRequest.extend({ app: z.boolean().optional() });

/** Logowanie deweloperskie (tylko AVEN_DEV_AUTH=1): przeglądarka dostaje ciasteczko, aplikacja token. */
export const POST = route(async ({ request, cookies }) => {
  rateLimit(`sign-in:${request.headers.get("x-forwarded-for") ?? "local"}`, 20, 10 * 60_000);
  const body = Body.parse(await readJson(request));
  return devSignIn({ email: body.email, name: body.name, app: body.app === true }, cookies);
});

export const DELETE = route(async ({ request, cookies }) => {
  await signOut(request, cookies);
  return null;
});
