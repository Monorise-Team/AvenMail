import { getAuth } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Wylogowanie z AvenMail (tylko POST z adresu poczty); unieważnia token odświeżania w Core. */
export const POST = (request: Request) => getAuth().signOut(request);
