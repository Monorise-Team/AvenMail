import { MoveRequest } from "@aven/contracts";
import { moveMessage } from "@aven/mail-engine";
import { z } from "zod";
import { readJson, route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { mailboxConfig, policy } from "@/server/mailboxes";

export const dynamic = "force-dynamic";

const Target = z.object({ uid: z.coerce.number().int().positive(), folder: z.string().min(1).max(1000) });

export const POST = route<{ id: string; uid: string }>(async ({ request, params }) => {
  const user = await requireUser(request);
  const { to } = MoveRequest.parse(await readJson(request));
  const { uid, folder } = Target.parse({ uid: params.uid, folder: request.nextUrl.searchParams.get("folder") });
  await moveMessage(await mailboxConfig(user.id, params.id), policy(), { folder, uid, to });
  return null;
});
