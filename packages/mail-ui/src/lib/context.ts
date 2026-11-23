"use client";

import type { AvenClient } from "@aven/client";
import { createContext, use } from "react";

export type Platform = "web" | "desktop";

export interface MailContextValue {
  client: AvenClient;
  platform: Platform;
}

export const MailContext = createContext<MailContextValue | null>(null);

export function useMailClient(): MailContextValue {
  const value = use(MailContext);
  if (!value) throw new Error("useMailClient poza <MailApp>");
  return value;
}
