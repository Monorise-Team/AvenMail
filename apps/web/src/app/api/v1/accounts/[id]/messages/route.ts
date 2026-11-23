import { PageQuery } from "@aven/contracts";
import { listMessages } from "@aven/mail-engine";
import { route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { mailboxConfig, policy } from "@/server/mailboxes";

export const dynamic = "force-dynamic";

/** Strona wiadomości folderu, od najnowszych: ?folder=INBOX&page=1&pageSize=50 */
export const GET = route<{ id: string }>(async ({ request, params }) => {
  const user = await requireUser(request);
  const query = PageQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
  return listMessages(await mailboxConfig(user.id, params.id), policy(), query);
});
