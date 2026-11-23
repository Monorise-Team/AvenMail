"use client";

import { ApiError, type AvenClient } from "@aven/client";
import type { Folder, FolderRole, MailAccount, MessageSummary } from "@aven/contracts";
import {
  AppShell,
  Avatar,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ListItem,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  ProgressBar,
  SidebarItem,
  SidebarNav,
  SidebarSection,
  Skeleton,
  TitleBar,
  TooltipProvider,
  useTheme,
} from "@monorise-team/ui";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Archive,
  ChevronDown,
  FileText,
  Folder as FolderIcon,
  Inbox,
  LogOut,
  Moon,
  PenSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Star,
  Sun,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MailContext, useMailClient, type Platform } from "../lib/context.js";
import { errorMessage } from "../lib/errors.js";
import { displayName, FOLDER_NAMES, listDate, prefixSubject, quoteForReply } from "../lib/format.js";
import { AccountDialog } from "./AccountDialog.js";
import { Composer, emptyDraft, type Draft } from "./Composer.js";
import { Reader } from "./Reader.js";
import { SignIn } from "./SignIn.js";

const ROLE_ICONS: Record<FolderRole, ReactNode> = {
  inbox: <Inbox />,
  flagged: <Star />,
  drafts: <FileText />,
  sent: <Send />,
  archive: <Archive />,
  junk: <ShieldAlert />,
  trash: <Trash2 />,
  all: <FolderIcon />,
};

const PAGE_SIZE = 50;

export interface MailAppProps {
  client: AvenClient;
  platform: Platform;
  /** Aplikacje na komputer i telefon zapisują token logowania (przeglądarka ma ciasteczko). */
  onToken?: (token: string | null) => void;
}

/** Cała poczta: logowanie, skrzynki, foldery, lista, czytanie i pisanie. Wspólna dla przeglądarki i komputera. */
export function MailApp({ client, platform, onToken }: MailAppProps) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } } }),
  );
  const context = useMemo(() => ({ client, platform }), [client, platform]);
  return (
    <MailContext value={context}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Session onToken={onToken} />
        </TooltipProvider>
      </QueryClientProvider>
    </MailContext>
  );
}

function Session({ onToken }: { onToken?: (token: string | null) => void }) {
  const { client } = useMailClient();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => client.session.me(), retry: false });

  if (me.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-10">
        <ProgressBar label="Ładowanie AvenMail" className="max-w-xs" />
      </div>
    );
  }
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return (
        <SignIn
          onSignedIn={(token) => {
            onToken?.(token);
            void queryClient.invalidateQueries();
          }}
        />
      );
    }
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState
          icon={<ShieldAlert />}
          title="Nie udało się połączyć z AvenMail"
          description={errorMessage(me.error)}
          action={
            <Button variant="outline" icon={<RefreshCw />} onClick={() => void me.refetch()}>
              Spróbuj ponownie
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <Mailbox
      userName={me.data.name}
      onSignOut={async () => {
        await client.session.signOut().catch(() => null);
        onToken?.(null);
        queryClient.clear();
        await me.refetch();
      }}
    />
  );
}

interface Selection {
  folder: string;
  uid: number | null;
}

function Mailbox({ userName, onSignOut }: { userName: string; onSignOut: () => Promise<void> }) {
  const { client, platform } = useMailClient();
  const queryClient = useQueryClient();
  const { resolvedMode, setAppearance } = useTheme();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => client.accounts.list() });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ folder: "INBOX", uid: null });
  const [accountDialog, setAccountDialog] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const account: MailAccount | undefined = accounts.data?.find((a) => a.id === accountId) ?? accounts.data?.[0];
  const activeId = account?.id ?? null;

  const folders = useQuery({
    queryKey: ["folders", activeId],
    queryFn: () => client.mail.folders(activeId!),
    enabled: Boolean(activeId),
  });

  const messages = useInfiniteQuery({
    queryKey: ["messages", activeId, selection.folder],
    queryFn: ({ pageParam }) => client.mail.messages(activeId!, selection.folder, pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: Boolean(activeId),
  });
  const list: MessageSummary[] = useMemo(
    () => messages.data?.pages.flatMap((page) => page.messages) ?? [],
    [messages.data],
  );

  const message = useQuery({
    queryKey: ["message", activeId, selection.folder, selection.uid],
    queryFn: () => client.mail.message(activeId!, selection.folder, selection.uid!),
    enabled: Boolean(activeId && selection.uid),
    staleTime: 5 * 60_000,
  });

  const refreshLists = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["folders", activeId] });
    await queryClient.invalidateQueries({ queryKey: ["messages", activeId] });
  }, [activeId, queryClient]);

  const setFlags = useMutation({
    mutationFn: (flags: { uid: number; seen?: boolean; flagged?: boolean }) =>
      client.mail.setFlags(activeId!, selection.folder, flags.uid, { seen: flags.seen, flagged: flags.flagged }),
    onSettled: refreshLists,
  });
  const remove = useMutation({
    mutationFn: (uid: number) => client.mail.remove(activeId!, selection.folder, uid),
    onSuccess: async () => {
      setSelection((current) => ({ ...current, uid: null }));
      await refreshLists();
    },
  });

  // Otwarta wiadomość staje się przeczytana
  const opened = message.data;
  useEffect(() => {
    if (opened && !opened.seen && !setFlags.isPending) setFlags.mutate({ uid: opened.uid, seen: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tylko przy otwarciu nowej wiadomości
  }, [opened?.uid]);

  const reply = useCallback(
    (all: boolean) => {
      if (!opened || !account) return;
      const others = all
        ? [...opened.to, ...opened.cc].filter((a) => a.address.toLowerCase() !== account.email.toLowerCase())
        : [];
      const recipients = opened.replyTo.length ? opened.replyTo : opened.from ? [opened.from] : [];
      setDraft({
        to: recipients.map((a) => a.address).join(", "),
        cc: others.map((a) => a.address).join(", "),
        subject: prefixSubject("Re", opened.subject),
        text: quoteForReply(opened.text, opened.from, opened.date),
        inReplyTo: opened.messageId ?? undefined,
        references: [...opened.references, ...(opened.messageId ? [opened.messageId] : [])],
      });
    },
    [account, opened],
  );

  const forward = useCallback(() => {
    if (!opened) return;
    setDraft({
      ...emptyDraft,
      subject: prefixSubject("Fwd", opened.subject),
      text: quoteForReply(opened.text, opened.from, opened.date),
    });
  }, [opened]);

  // Skróty klawiszowe jak w desktopowym Aven
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || draft || accountDialog) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const index = list.findIndex((m) => m.uid === selection.uid);
      const go = (next: number) => {
        const item = list[Math.max(0, Math.min(list.length - 1, next))];
        if (item) setSelection((current) => ({ ...current, uid: item.uid }));
      };
      switch (event.key) {
        case "j":
          go(index + 1);
          break;
        case "k":
          go(index - 1);
          break;
        case "c":
          setDraft(emptyDraft);
          break;
        case "r":
          reply(false);
          break;
        case "a":
          reply(true);
          break;
        case "f":
          forward();
          break;
        case "s":
          if (opened) setFlags.mutate({ uid: opened.uid, flagged: !opened.flagged });
          break;
        case "u":
          if (opened) setFlags.mutate({ uid: opened.uid, seen: false });
          break;
        case "#":
        case "Delete":
          if (selection.uid) remove.mutate(selection.uid);
          break;
        case "Escape":
          setSelection((current) => ({ ...current, uid: null }));
          break;
        default:
          return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [accountDialog, draft, forward, list, opened, remove, reply, selection.uid, setFlags]);

  const titleBar =
    platform === "desktop" ? (
      <TitleBar insetStart={84} className="justify-center">
        <span className="uppercase">AvenMail</span>
        {account ? (
          <>
            <span aria-hidden>·</span>
            <span className="text-accent">{account.email}</span>
          </>
        ) : null}
      </TitleBar>
    ) : undefined;

  if (accounts.isPending) {
    return (
      <AppShell titleBar={titleBar}>
        <Card surface="side" className="w-64 p-3">
          <Skeleton className="h-9 w-full" />
        </Card>
        <Card surface="middle" className="w-96" />
        <Card surface="reading" className="flex-1" />
      </AppShell>
    );
  }

  if (!account) {
    return (
      <AppShell titleBar={titleBar}>
        <Card surface="reading" className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Inbox />}
            title={`Witaj, ${userName}`}
            description="Dodaj pierwszą skrzynkę: wystarczy adres i hasło. Serwery podpowiemy dla znanych dostawców."
            action={
              <Button variant="primary" size="lg" icon={<Plus />} onClick={() => setAccountDialog(true)}>
                Dodaj skrzynkę
              </Button>
            }
          />
        </Card>
        <AccountDialog open={accountDialog} onOpenChange={setAccountDialog} onCreated={setAccountId} />
      </AppShell>
    );
  }

  const folderList: Folder[] = folders.data ?? [];
  const currentFolder = folderList.find((f) => f.path === selection.folder);
  const folderLabel = (folder: Folder) => (folder.role ? FOLDER_NAMES[folder.role] : folder.name);

  return (
    <AppShell titleBar={titleBar}>
      <Card surface="side" className="flex w-64 shrink-0 flex-col gap-3 p-3">
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              className="mr-row mr-press flex items-center gap-2.5 px-1 py-1 text-left hover:bg-bg-hover"
              aria-label="Skrzynki i konto"
            >
              <Avatar name={account.displayName ?? account.email} seed={account.email} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{account.displayName ?? userName}</span>
                <span className="block truncate text-xs text-text-tertiary">{account.email}</span>
              </span>
              <ChevronDown className="size-4 text-text-tertiary" aria-hidden />
            </button>
          </MenuTrigger>
          <MenuContent align="start" className="w-60">
            <MenuLabel>Skrzynki</MenuLabel>
            {accounts.data?.map((item) => (
              <MenuItem
                key={item.id}
                onSelect={() => {
                  setAccountId(item.id);
                  setSelection({ folder: "INBOX", uid: null });
                }}
              >
                {item.email}
              </MenuItem>
            ))}
            <MenuItem icon={<Plus />} onSelect={() => setAccountDialog(true)}>
              Dodaj skrzynkę
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={resolvedMode === "dark" ? <Sun /> : <Moon />}
              onSelect={() => setAppearance({ mode: resolvedMode === "dark" ? "light" : "dark" })}
            >
              {resolvedMode === "dark" ? "Tryb jasny" : "Tryb ciemny"}
            </MenuItem>
            <MenuItem icon={<LogOut />} onSelect={() => void onSignOut()}>
              Wyloguj się
            </MenuItem>
          </MenuContent>
        </Menu>
        <Button
          variant="primary"
          size="lg"
          icon={<PenSquare />}
          className="w-full rounded-full"
          onClick={() => setDraft(emptyDraft)}
        >
          Napisz
        </Button>
        <SidebarNav aria-label="Foldery" className="min-h-0 flex-1 overflow-y-auto">
          {folders.isPending ? (
            <div className="flex flex-col gap-2 px-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : folders.error ? (
            <p className="px-2 text-sm text-danger">{errorMessage(folders.error)}</p>
          ) : (
            <>
              <SidebarSection>
                {folderList
                  .filter((folder) => folder.role)
                  .map((folder) => (
                    <SidebarItem
                      key={folder.path}
                      icon={ROLE_ICONS[folder.role!]}
                      label={folderLabel(folder)}
                      count={folder.role === "inbox" || folder.role === "drafts" ? folder.unread : undefined}
                      active={selection.folder === folder.path}
                      onClick={() => setSelection({ folder: folder.path, uid: null })}
                    />
                  ))}
              </SidebarSection>
              {folderList.some((folder) => !folder.role) ? (
                <SidebarSection title="Foldery">
                  {folderList
                    .filter((folder) => !folder.role)
                    .map((folder) => (
                      <SidebarItem
                        key={folder.path}
                        icon={<FolderIcon />}
                        label={folder.name}
                        count={folder.unread || undefined}
                        active={selection.folder === folder.path}
                        onClick={() => setSelection({ folder: folder.path, uid: null })}
                      />
                    ))}
                </SidebarSection>
              ) : null}
            </>
          )}
        </SidebarNav>
      </Card>

      <Card surface="middle" className="flex w-96 shrink-0 flex-col">
        <CardHeader className="justify-between">
          <span className="truncate text-sm font-semibold">
            {currentFolder ? folderLabel(currentFolder) : selection.folder}
          </span>
          <Button
            iconOnly
            variant="ghost"
            aria-label="Odśwież"
            onClick={() => void refreshLists()}
            disabled={messages.isFetching}
          >
            <RefreshCw className={messages.isFetching ? "animate-spin" : undefined} />
          </Button>
        </CardHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2" role="list" aria-label="Wiadomości">
          {messages.isPending ? (
            Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex gap-3 px-3 py-2.5">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3.5 w-5/6" />
                </div>
              </div>
            ))
          ) : messages.error ? (
            <EmptyState
              icon={<ShieldAlert />}
              title="Nie udało się pobrać wiadomości"
              description={errorMessage(messages.error)}
            />
          ) : list.length === 0 ? (
            <EmptyState icon={<Inbox />} title="Pusto" description="W tym folderze nie ma wiadomości." />
          ) : (
            <>
              {list.map((item) => (
                <div role="listitem" key={item.uid}>
                  <ListItem
                    leading={<Avatar name={displayName(item.from)} seed={item.from?.address ?? "?"} />}
                    title={displayName(item.from)}
                    meta={listDate(item.date)}
                    subtitle={item.subject || "(bez tematu)"}
                    preview={item.preview}
                    unread={!item.seen}
                    selected={selection.uid === item.uid}
                    onClick={() => setSelection((current) => ({ ...current, uid: item.uid }))}
                  />
                </div>
              ))}
              {messages.hasNextPage ? (
                <Button
                  variant="ghost"
                  className="mx-auto my-2"
                  onClick={() => void messages.fetchNextPage()}
                  disabled={messages.isFetchingNextPage}
                >
                  {messages.isFetchingNextPage ? "Ładowanie…" : "Pokaż starsze"}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </Card>

      <Reader
        message={selection.uid ? message.data : undefined}
        loading={Boolean(selection.uid) && message.isPending}
        error={message.error ? errorMessage(message.error) : null}
        actions={{
          onReply: () => reply(false),
          onReplyAll: () => reply(true),
          onForward: forward,
          onToggleFlag: () => opened && setFlags.mutate({ uid: opened.uid, flagged: !opened.flagged }),
          onMarkUnread: () => opened && setFlags.mutate({ uid: opened.uid, seen: false }),
          onDelete: () => selection.uid && remove.mutate(selection.uid),
        }}
      />

      <AccountDialog open={accountDialog} onOpenChange={setAccountDialog} onCreated={setAccountId} />
      {draft ? (
        <Composer
          accountId={account.id}
          from={account.displayName ? `${account.displayName} <${account.email}>` : account.email}
          draft={draft}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </AppShell>
  );
}
