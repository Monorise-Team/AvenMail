import { AVENMAIL_PERMISSIONS, MailAccountInput } from "@aven/contracts";
import { readJson, route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { testAccount } from "@/server/mailboxes";
import { assertPermission } from "@/server/permissions";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/** Sprawdza logowanie do IMAP i SMTP bez zapisywania skrzynki. */
export const POST = route(async ({ request }) => {
  const user = await requireUser(request);
  await assertPermission(user, AVENMAIL_PERMISSIONS.keys["mailboxes.manage"]);
  rateLimit(`accounts:${user.id}`, 10, 10 * 60_000);
  await testAccount(MailAccountInput.parse(await readJson(request)));
  return { ok: true };
});
