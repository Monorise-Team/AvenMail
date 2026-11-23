import { MailAccountInput } from "@aven/contracts";
import { readJson, route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { createAccount, listAccounts } from "@/server/mailboxes";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

export const GET = route(async ({ request }) => listAccounts(await requireUser(request)));

/** Dodaje skrzynkę po udanym logowaniu do IMAP i SMTP. */
export const POST = route(
  async ({ request }) => {
    const user = await requireUser(request);
    rateLimit(`accounts:${user.id}`, 10, 10 * 60_000);
    return createAccount(user, MailAccountInput.parse(await readJson(request)));
  },
  { status: 201 },
);
