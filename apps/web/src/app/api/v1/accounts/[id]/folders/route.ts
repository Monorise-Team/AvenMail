import { listFolders } from "@aven/mail-engine";
import { route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { mailboxConfig, policy } from "@/server/mailboxes";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async ({ request, params }) => {
  const user = await requireUser(request);
  return listFolders(await mailboxConfig(user.id, params.id), policy());
});
