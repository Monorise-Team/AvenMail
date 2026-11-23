"use client";

import { createClient } from "@aven/client";
import { MailApp } from "@aven/mail-ui";
import { ThemeProvider } from "@monorise-team/ui";
import { useState } from "react";

/** Poczta w przeglądarce: ten sam adres co API, sesja w ciasteczku (BFF, ADR-0050). */
export function WebMail() {
  const [client] = useState(() => createClient());
  return (
    <ThemeProvider>
      <MailApp client={client} platform="web" />
    </ThemeProvider>
  );
}
