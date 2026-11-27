"use client";

import { createClient } from "@aven/client";
import { MailApp } from "@aven/mail-ui";
import { ThemeProvider, ToastProvider, TooltipProvider } from "@monorise-team/ui";
import { useState } from "react";

/** Poczta w przeglądarce: ten sam adres co API, sesja w ciasteczku (BFF, ADR-0050). */
export function WebMail() {
  const [client] = useState(() => createClient());
  return (
    <ThemeProvider>
      <ToastProvider>
        <TooltipProvider>
          <MailApp client={client} platform="web" />
        </TooltipProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
