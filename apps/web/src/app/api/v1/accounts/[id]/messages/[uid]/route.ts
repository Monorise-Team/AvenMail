import { FlagsRequest } from "@aven/contracts";
import { deleteMessage, getMessage, setFlags } from "@aven/mail-engine";
import { z } from "zod";
import { readJson, route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { mailboxConfig, policy } from "@/server/mailboxes";

export const dynamic = "force-dynamic";

const Target = z.object({
  uid: z.coerce.number().int().positive(),
  folder: z.string().min(1).max(1000),
});

type Params = { id: string; uid: string };

const target = (url: URL, params: Params) => Target.parse({ uid: params.uid, folder: url.searchParams.get("folder") });

export const GET = route<Params>(async ({ request, params }) => {
  const user = await requireUser(request);
  return getMessage(await mailboxConfig(user, params.id), policy(), target(request.nextUrl, params));
});

/** Przeczytana albo nie, z gwiazdką albo bez: { "seen": true } */
export const PATCH = route<Params>(async ({ request, params }) => {
  const user = await requireUser(request);
  const flags = FlagsRequest.parse(await readJson(request));
  await setFlags(await mailboxConfig(user, params.id), policy(), { ...target(request.nextUrl, params), ...flags });
  return null;
});

/** Do kosza, a z kosza na stałe. */
export const DELETE = route<Params>(async ({ request, params }) => {
  const user = await requireUser(request);
  return deleteMessage(await mailboxConfig(user, params.id), policy(), target(request.nextUrl, params));
});
