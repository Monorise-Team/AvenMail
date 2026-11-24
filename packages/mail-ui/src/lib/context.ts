"use client";

import type { AvenClient } from "@aven/client";
import { createContext, use } from "react";

export type Platform = "web" | "desktop";

export interface MailContextValue {
  client: AvenClient;
  platform: Platform;
  /**
   * Logowanie kontem Monorise poza przeglądarką (aplikacja na komputer): przeglądarka systemowa i powrót
   * do aplikacji, tokeny w systemowym sejfie. W przeglądarce go nie ma, bo logowanie prowadzi serwer (BFF).
   */
  signIn?: () => Promise<void>;
  /** Wylogowanie poza przeglądarką: czyści sejf i unieważnia token w Core. */
  signOut?: () => Promise<void>;
}

export const MailContext = createContext<MailContextValue | null>(null);

export function useMailClient(): MailContextValue {
  const value = use(MailContext);
  if (!value) throw new Error("useMailClient poza <MailApp>");
  return value;
}
