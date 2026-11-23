"use client";

import { Button, Card, TextField } from "@monorise-team/ui";
import { useState, type FormEvent } from "react";
import { useMailClient } from "../lib/context.js";
import { errorMessage } from "../lib/errors.js";

/**
 * Logowanie deweloperskie: dopóki nie ma logowania przez Core (ADR-0090), lokalnie wystarczy adres i imię.
 * Na produkcji serwer tego nie przyjmie.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (token: string | null) => void }) {
  const { client, platform } = useMailClient();
  const [email, setEmail] = useState("anna@acme.com");
  const [name, setName] = useState("Anna Kowalska");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await client.session.devSignIn({ email, name, app: platform !== "web" });
      onSignedIn(session.token);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card surface="float" className="mr-enter flex w-full max-w-sm flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-xl font-semibold">Zaloguj się do AvenMail</h1>
          <p className="text-sm text-text-tertiary">Logowanie deweloperskie. Docelowo logujesz się kontem Monorise.</p>
        </div>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <TextField
            label="Adres e-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <TextField label="Imię i nazwisko" value={name} onChange={(e) => setName(e.target.value)} required />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            {busy ? "Logowanie…" : "Zaloguj się"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
