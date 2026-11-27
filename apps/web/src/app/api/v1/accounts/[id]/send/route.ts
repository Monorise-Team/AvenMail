import { AVENMAIL_PERMISSIONS, SendRequest } from "@aven/contracts";
import { appendToSent, sendMessage } from "@aven/mail-engine";
import { readJson, route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { policy, withConnectedMailbox } from "@/server/mailboxes";
import { assertPermission } from "@/server/permissions";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/** Serwery, które same zapisują wysłaną wiadomość w folderze Wysłane. */
const SAVES_SENT_ITSELF = [/(^|\.)gmail\.com$/, /(^|\.)googlemail\.com$/];

export const POST = route<{ id: string }>(async ({ request, params }) => {
  const user = await requireUser(request);
  await assertPermission(user, AVENMAIL_PERMISSIONS.keys["mail.send"]);
  rateLimit(`send:${user.id}`, 60, 60 * 60_000);
  const message = SendRequest.parse(await readJson(request));
  return withConnectedMailbox(user, params.id, async (mailbox) => {
    const { messageId, raw } = await sendMessage(mailbox, policy(), message);
    const savedToSent = SAVES_SENT_ITSELF.some((pattern) => pattern.test(mailbox.smtp.host))
      ? true
      : await appendToSent(mailbox, policy(), raw).catch(() => false);
    return { messageId, savedToSent };
  });
});
