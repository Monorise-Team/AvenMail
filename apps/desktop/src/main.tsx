import { createClient } from "@aven/client";
import { MailApp } from "@aven/mail-ui";
import { ThemeProvider } from "@monorise-team/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { readToken, writeToken } from "./session";
import "./styles.css";

const client = createClient({
  baseUrl: import.meta.env.VITE_AVEN_API ?? "http://aven.localhost:3000",
  getToken: readToken,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <MailApp client={client} platform="desktop" onToken={writeToken} />
    </ThemeProvider>
  </StrictMode>,
);
