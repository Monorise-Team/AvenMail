import { route } from "@/server/api";
import { currentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export const GET = route(async ({ request }) => currentUser(request));
