"use client";

import { Button, Dialog, TextArea, TextField } from "@monorise-team/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useMailClient } from "../lib/context.js";
import { errorMessage } from "../lib/errors.js";
import { parseAddresses } from "../lib/format.js";

export interface Draft {
  to: string;
  cc: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
}

export const emptyDraft: Draft = { to: "", cc: "", subject: "", text: "" };

/** Nowa wiadomość, odpowiedź albo przekazanie dalej; zwykły tekst. Ctrl/⌘ + Enter wysyła. */
export function Composer({
  accountId,
  from,
  draft,
  onClose,
}: {
  accountId: string;
  from: string;
  draft: Draft;
  onClose: () => void;
}) {
  const { client } = useMailClient();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(draft);
  const [invalid, setInvalid] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => {
      const to = parseAddresses(value.to);
      const cc = parseAddresses(value.cc);
      const wrong = [...to.invalid, ...cc.invalid];
      if (wrong.length || !to.addresses.length) {
        throw new Error(wrong.length ? `Niepoprawny adres: ${wrong.join(", ")}` : "Podaj co najmniej jednego odbiorcę");
      }
      return client.mail.send(accountId, {
        to: to.addresses,
        cc: cc.addresses,
        subject: value.subject,
        text: value.text,
        inReplyTo: value.inReplyTo,
        references: value.references,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["folders", accountId] });
      onClose();
    },
    onError: (error) => setInvalid(error instanceof Error && !("code" in error) ? error.message : null),
  });

  function submit(event?: FormEvent) {
    event?.preventDefault();
    setInvalid(null);
    send.mutate();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={value.subject || "Nowa wiadomość"}
      className="max-w-2xl"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
        }}
      >
        <p className="text-xs text-text-tertiary">Od: {from}</p>
        <TextField
          label="Do"
          placeholder="anna@acme.com, Marek Nowak <marek@nowak.pl>"
          value={value.to}
          onChange={(e) => setValue({ ...value, to: e.target.value })}
          autoFocus={!value.to}
        />
        <TextField label="DW" value={value.cc} onChange={(e) => setValue({ ...value, cc: e.target.value })} />
        <TextField
          label="Temat"
          value={value.subject}
          onChange={(e) => setValue({ ...value, subject: e.target.value })}
        />
        <TextArea
          aria-label="Treść"
          rows={12}
          value={value.text}
          onChange={(e) => setValue({ ...value, text: e.target.value })}
          autoFocus={Boolean(value.to)}
        />
        {invalid || send.error ? <p className="text-sm text-danger">{invalid ?? errorMessage(send.error)}</p> : null}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-tertiary">Ctrl albo ⌘ + Enter wysyła</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={onClose}>
              Odrzuć
            </Button>
            <Button type="submit" variant="primary" size="md" icon={<Send />} disabled={send.isPending}>
              {send.isPending ? "Wysyłanie…" : "Wyślij"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
