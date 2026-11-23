import { SendRequest } from "@aven/contracts";
import { appendToSent, sendMessage } from "@aven/mail-engine";
import { readJson, route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { mailboxConfig, policy } from "@/server/mailboxes";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/** Serwery, które same zapisują wysłaną wiadomość w folderze Wysłane. */
const SAVES_SENT_ITSELF = [/(^|\.)gmail\.com$/, /(^|\.)googlemail\.com$/];

export const POST = route<{ id: string }>(async ({ request, params }) => {
  const user = await requireUser(request);
  rateLimit(`send:${user.id}`, 60, 60 * 60_000);
  const message = SendRequest.parse(await readJson(request));
  const mailbox = await mailboxConfig(user.id, params.id);
  const { messageId, raw } = await sendMessage(mailbox, policy(), message);
  const savedToSent = SAVES_SENT_ITSELF.some((pattern) => pattern.test(mailbox.smtp.host))
    ? true
    : await appendToSent(mailbox, policy(), raw).catch(() => false);
  return { messageId, savedToSent };
});
