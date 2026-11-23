import { route } from "@/server/api";
import { requireUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export const GET = route(async ({ request }) => requireUser(request));
