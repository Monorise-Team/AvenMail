import { AVENMAIL_PERMISSIONS, MailAccountInput } from "@aven/contracts";
import { readJson, route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { createAccount, listAccounts } from "@/server/mailboxes";
import { assertPermission, requireAuthorizedSnapshot } from "@/server/permissions";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

export const GET = route(async ({ request }) => {
  const user = await requireUser(request);
  await requireAuthorizedSnapshot(user);
  return listAccounts(user);
});

/** Dodaje skrzynkę po udanym logowaniu do IMAP i SMTP. */
export const POST = route(
  async ({ request }) => {
    const user = await requireUser(request);
    await assertPermission(user, AVENMAIL_PERMISSIONS.keys["mailboxes.manage"]);
    rateLimit(`accounts:${user.id}`, 10, 10 * 60_000);
    return createAccount(user, MailAccountInput.parse(await readJson(request)));
  },
  { status: 201 },
);
