import { createAppSession, createClient } from "@aven/client";
import { MailApp } from "@aven/mail-ui";
import { ThemeProvider } from "@monorise-team/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { API, desktopSignIn, keychain } from "./auth";
import "./styles.css";

const session = createAppSession(desktopSignIn, keychain);
const client = createClient({ baseUrl: API, getToken: () => session.accessToken() });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <MailApp client={client} platform="desktop" signIn={session.signIn} signOut={session.signOut} />
    </ThemeProvider>
  </StrictMode>,
);
