import { route } from "@/server/api";
import { requireUser } from "@/server/auth";
import { deleteAccount } from "@/server/mailboxes";

export const dynamic = "force-dynamic";

/** Usuwa skrzynkę z AvenMail (u dostawcy poczty zostaje bez zmian). */
export const DELETE = route<{ id: string }>(async ({ request, params }) => {
  await deleteAccount(await requireUser(request), params.id);
  return null;
});
