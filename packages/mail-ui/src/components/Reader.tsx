"use client";

import type { Message } from "@aven/contracts";
import { Avatar, Button, Card, CardHeader, EmptyState, Separator, Skeleton, Toolbar, Tooltip } from "@monorise-team/ui";
import { Forward, Image as ImageIcon, MailOpen, Paperclip, Reply, ReplyAll, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { displayName, formatAddresses, readerDate } from "../lib/format.js";
import { hasRemoteImages, messageDocument } from "../lib/html.js";

export interface ReaderActions {
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onToggleFlag: () => void;
  onMarkUnread: () => void;
  onDelete: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Treść HTML w ramce bez skryptów i bez dostępu do strony; obrazy z internetu po kliknięciu. */
function HtmlBody({ html }: { html: string }) {
  const [remoteImages, setRemoteImages] = useState(false);
  const doc = useMemo(() => messageDocument(html, { remoteImages }), [html, remoteImages]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {!remoteImages && hasRemoteImages(html) ? (
        <div className="mr-card mr-strong flex items-center justify-between gap-3 px-3 py-2 text-xs text-text-secondary">
          <span>Obrazy z internetu są ukryte, żeby nadawca nie wiedział, że otwierasz wiadomość.</span>
          <Button size="xs" variant="outline" icon={<ImageIcon />} onClick={() => setRemoteImages(true)}>
            Pokaż obrazy
          </Button>
        </div>
      ) : null}
      <iframe
        title="Treść wiadomości"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        className="min-h-[420px] w-full flex-1 rounded-row border-0 bg-white"
      />
    </div>
  );
}

export function Reader({
  message,
  loading,
  error,
  actions,
}: {
  message: Message | undefined;
  loading: boolean;
  error: string | null;
  actions: ReaderActions;
}) {
  if (loading) {
    return (
      <Card surface="reading" className="flex min-w-0 flex-1 flex-col gap-4 p-6" aria-busy>
        <Skeleton className="h-6 w-2/3" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </Card>
    );
  }
  if (error || !message) {
    return (
      <Card surface="reading" className="flex min-w-0 flex-1 items-center justify-center">
        <EmptyState
          icon={<MailOpen />}
          title={error ? "Nie udało się otworzyć wiadomości" : "Wybierz wiadomość"}
          description={error ?? "Kliknij wiadomość na liście albo użyj klawiszy J i K."}
        />
      </Card>
    );
  }

  const attachments = message.attachments.filter((attachment) => !attachment.inline);
  return (
    <Card surface="reading" className="flex min-w-0 flex-1 flex-col">
      <CardHeader className="justify-between">
        <Toolbar aria-label="Działania na wiadomości">
          <Tooltip content="Odpowiedz" shortcut="R">
            <Button iconOnly variant="ghost" aria-label="Odpowiedz" onClick={actions.onReply}>
              <Reply />
            </Button>
          </Tooltip>
          <Tooltip content="Odpowiedz wszystkim" shortcut="A">
            <Button iconOnly variant="ghost" aria-label="Odpowiedz wszystkim" onClick={actions.onReplyAll}>
              <ReplyAll />
            </Button>
          </Tooltip>
          <Tooltip content="Przekaż dalej" shortcut="F">
            <Button iconOnly variant="ghost" aria-label="Przekaż dalej" onClick={actions.onForward}>
              <Forward />
            </Button>
          </Tooltip>
          <Separator vertical />
          <Tooltip content={message.flagged ? "Usuń gwiazdkę" : "Oznacz gwiazdką"} shortcut="S">
            <Button
              iconOnly
              variant="ghost"
              aria-label={message.flagged ? "Usuń gwiazdkę" : "Oznacz gwiazdką"}
              aria-pressed={message.flagged}
              onClick={actions.onToggleFlag}
            >
              <Star className={message.flagged ? "fill-warning text-warning" : undefined} />
            </Button>
          </Tooltip>
          <Tooltip content="Oznacz jako nieprzeczytane" shortcut="U">
            <Button iconOnly variant="ghost" aria-label="Oznacz jako nieprzeczytane" onClick={actions.onMarkUnread}>
              <MailOpen />
            </Button>
          </Tooltip>
          <Tooltip content="Usuń" shortcut="#">
            <Button iconOnly variant="ghost" aria-label="Usuń" onClick={actions.onDelete}>
              <Trash2 />
            </Button>
          </Tooltip>
        </Toolbar>
      </CardHeader>
      <article className="mr-enter flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6" key={message.uid}>
        <h1 className="font-display text-xl font-semibold break-words">{message.subject || "(bez tematu)"}</h1>
        <div className="flex items-start gap-3">
          <Avatar name={displayName(message.from)} seed={message.from?.address ?? "?"} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{displayName(message.from)}</p>
            <p className="truncate text-xs text-text-tertiary">
              {message.from?.address} · do: {formatAddresses(message.to) || "—"}
              {message.cc.length ? ` · DW: ${formatAddresses(message.cc)}` : ""}
            </p>
          </div>
          <time className="shrink-0 text-xs text-text-tertiary" dateTime={message.date}>
            {readerDate(message.date)}
          </time>
        </div>
        {message.html ? (
          <HtmlBody html={message.html} />
        ) : (
          <div className="text-sm leading-relaxed whitespace-pre-wrap text-text-secondary">{message.text ?? ""}</div>
        )}
        {attachments.length ? (
          <ul className="flex flex-wrap gap-2" aria-label="Załączniki">
            {attachments.map((attachment, index) => (
              <li
                key={`${attachment.filename}-${index}`}
                className="mr-card mr-strong flex items-center gap-2 px-3 py-2 text-sm"
              >
                <Paperclip className="size-4 text-text-tertiary" aria-hidden />
                <span className="max-w-56 truncate">{attachment.filename ?? "załącznik"}</span>
                <span className="text-xs text-text-tertiary">{formatSize(attachment.size)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    </Card>
  );
}
