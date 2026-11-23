"use client";

import { detectProvider, guessServers, type MailAccountInput, type Security } from "@aven/contracts";
import { Button, Dialog, Select, TextField } from "@monorise-team/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useMailClient } from "../lib/context.js";
import { errorMessage } from "../lib/errors.js";

interface ServerForm {
  host: string;
  port: string;
  security: Security;
}

const SECURITY_LABELS: Record<Security, string> = { ssl: "SSL/TLS", starttls: "STARTTLS", none: "Bez szyfrowania" };

function ServerFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ServerForm;
  onChange: (v: ServerForm) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-semibold tracking-wide text-text-tertiary uppercase">{label}</legend>
      <div className="grid grid-cols-[1fr_84px] gap-2">
        <TextField
          label="Serwer"
          value={value.host}
          onChange={(e) => onChange({ ...value, host: e.target.value })}
          required
          autoComplete="off"
        />
        <TextField
          label="Port"
          inputMode="numeric"
          value={value.port}
          onChange={(e) => onChange({ ...value, port: e.target.value.replace(/\D/g, "") })}
          required
        />
      </div>
      <Select
        label="Szyfrowanie"
        value={value.security}
        onChange={(e) => onChange({ ...value, security: e.target.value as Security })}
      >
        {(["ssl", "starttls", "none"] as const).map((security) => (
          <option key={security} value={security}>
            {SECURITY_LABELS[security]}
          </option>
        ))}
      </Select>
    </fieldset>
  );
}

const toForm = (s: { host: string; port: number; security: Security }): ServerForm => ({
  host: s.host,
  port: String(s.port),
  security: s.security,
});

/** Dodawanie skrzynki: adres, hasło i serwery (podpowiadane dla znanych dostawców), z próbą połączenia. */
export function AccountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { client } = useMailClient();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [imap, setImap] = useState<ServerForm>({ host: "", port: "993", security: "ssl" });
  const [smtp, setSmtp] = useState<ServerForm>({ host: "", port: "465", security: "ssl" });
  const [advanced, setAdvanced] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: MailAccountInput) => client.accounts.create(input),
    onSuccess: async (account) => {
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      onCreated(account.id);
      onOpenChange(false);
      setPassword("");
    },
  });

  function fillServers(value: string) {
    const preset = detectProvider(value);
    const servers = preset ?? guessServers(value);
    if (servers) {
      setImap(toForm(servers.imap));
      setSmtp(toForm(servers.smtp));
    }
    setNote(preset?.note ?? null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate({
      email: email.trim(),
      password,
      displayName: displayName.trim() || undefined,
      username: username.trim() || undefined,
      imap: { host: imap.host.trim(), port: Number(imap.port), security: imap.security },
      smtp: { host: smtp.host.trim(), port: Number(smtp.port), security: smtp.security },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Dodaj skrzynkę"
      description="AvenMail łączy się z Twoją pocztą przez IMAP i SMTP. Hasło trzymamy zaszyfrowane, a treści maili nie zapisujemy na serwerze."
      className="max-w-lg"
    >
      <form id="account-form" className="flex flex-col gap-4" onSubmit={submit}>
        <TextField
          label="Adres e-mail"
          type="email"
          placeholder="anna@acme.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => fillServers(email)}
          required
          autoFocus
        />
        <TextField
          label="Hasło"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={note ?? "Hasło do skrzynki albo hasło aplikacji."}
          required
          autoComplete="off"
        />
        <TextField
          label="Nazwa nadawcy"
          placeholder="Anna Kowalska"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <button
          type="button"
          className="w-fit text-sm text-link hover:underline"
          onClick={() => setAdvanced((value) => !value)}
          aria-expanded={advanced}
        >
          {advanced ? "Ukryj ustawienia serwerów" : "Ustawienia serwerów"}
        </button>
        {advanced ? (
          <div className="flex flex-col gap-4">
            <TextField
              label="Login (gdy inny niż adres)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <ServerFields label="Odbieranie (IMAP)" value={imap} onChange={setImap} />
              <ServerFields label="Wysyłanie (SMTP)" value={smtp} onChange={setSmtp} />
            </div>
          </div>
        ) : null}
        {create.error ? <p className="text-sm text-danger">{errorMessage(create.error)}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={create.isPending}>
            {create.isPending ? "Sprawdzam połączenie…" : "Połącz"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
