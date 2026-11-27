import { AVENMAIL_PERMISSIONS, FlagsRequest } from "@aven/contracts";
import { deleteMessage, getMessage, setFlags } from "@aven/mail-engine";
import { z } from "zod";
import { readJson, route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { policy, withConnectedMailbox } from "@/server/mailboxes";
import { assertPermission } from "@/server/permissions";

export const dynamic = "force-dynamic";

const Target = z.object({
  uid: z.coerce.number().int().positive(),
  folder: z.string().min(1).max(1000),
});

type Params = { id: string; uid: string };

const target = (url: URL, params: Params) => Target.parse({ uid: params.uid, folder: url.searchParams.get("folder") });

export const GET = route<Params>(async ({ request, params }) => {
  const user = await requireUser(request);
  await assertPermission(user, AVENMAIL_PERMISSIONS.keys["mail.read"]);
  const messageTarget = target(request.nextUrl, params);
  return withConnectedMailbox(user, params.id, (mailbox) => getMessage(mailbox, policy(), messageTarget));
});

/** Przeczytana albo nie, z gwiazdką albo bez: { "seen": true } */
export const PATCH = route<Params>(async ({ request, params }) => {
  const user = await requireUser(request);
  await assertPermission(user, AVENMAIL_PERMISSIONS.keys["mail.read"]);
  const flags = FlagsRequest.parse(await readJson(request));
  const messageTarget = target(request.nextUrl, params);
  await withConnectedMailbox(user, params.id, (mailbox) => setFlags(mailbox, policy(), { ...messageTarget, ...flags }));
  return null;
});

/** Do kosza, a z kosza na stałe. */
export const DELETE = route<Params>(async ({ request, params }) => {
  const user = await requireUser(request);
  await assertPermission(user, AVENMAIL_PERMISSIONS.keys["mail.read"]);
  const messageTarget = target(request.nextUrl, params);
  return withConnectedMailbox(user, params.id, (mailbox) => deleteMessage(mailbox, policy(), messageTarget));
});
