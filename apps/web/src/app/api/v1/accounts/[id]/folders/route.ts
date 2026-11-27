import { AVENMAIL_PERMISSIONS } from "@aven/contracts";
import { listFolders } from "@aven/mail-engine";
import { route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { policy, withConnectedMailbox } from "@/server/mailboxes";
import { assertPermission } from "@/server/permissions";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async ({ request, params }) => {
  const user = await requireUser(request);
  await assertPermission(user, AVENMAIL_PERMISSIONS.keys["mail.read"]);
  return withConnectedMailbox(user, params.id, (mailbox) => listFolders(mailbox, policy()));
});
