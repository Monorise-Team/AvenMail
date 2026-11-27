import { AVENMAIL_PERMISSIONS } from "@aven/contracts";
import { route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { deleteAccount } from "@/server/mailboxes";
import { assertPermission } from "@/server/permissions";

export const dynamic = "force-dynamic";

/** Usuwa skrzynkę z AvenMail (u dostawcy poczty zostaje bez zmian). */
export const DELETE = route<{ id: string }>(async ({ request, params }) => {
  const user = await requireUser(request);
  await assertPermission(user, AVENMAIL_PERMISSIONS.keys["mailboxes.manage"]);
  await deleteAccount(user, params.id);
  return null;
});
