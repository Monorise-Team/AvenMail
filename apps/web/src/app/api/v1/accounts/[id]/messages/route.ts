import { AVENMAIL_PERMISSIONS, PageQuery } from "@aven/contracts";
import { listMessages } from "@aven/mail-engine";
import { route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { policy, withConnectedMailbox } from "@/server/mailboxes";
import { assertPermission } from "@/server/permissions";

export const dynamic = "force-dynamic";

/** Strona wiadomości folderu, od najnowszych: ?folder=INBOX&page=1&pageSize=50 */
export const GET = route<{ id: string }>(async ({ request, params }) => {
  const user = await requireUser(request);
  await assertPermission(user, AVENMAIL_PERMISSIONS.keys["mail.read"]);
  const query = PageQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
  return withConnectedMailbox(user, params.id, (mailbox) => listMessages(mailbox, policy(), query));
});
