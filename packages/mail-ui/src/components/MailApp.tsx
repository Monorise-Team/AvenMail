"use client";

import { ApiError, type AvenClient } from "@aven/client";
import type { Folder, FolderRole, MailAccount, Me, MessageSummary } from "@aven/contracts";
import {
  AppearanceControls,
  AppShell,
  Avatar,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  ListItem,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
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
  Palette,
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
import {
  canManageMailboxes,
  canReadMail,
  canSendMail,
  readAccountParam,
  resolveAccessDenialMessage,
} from "../lib/access.js";
import { MailContext, useMailClient, type Platform } from "../lib/context.js";
import { errorMessage } from "../lib/errors.js";
import { displayName, FOLDER_NAMES, listDate, prefixSubject, quoteForReply } from "../lib/format.js";
import { AccountDialog } from "./AccountDialog.js";
import { Composer, emptyDraft, type Draft } from "./Composer.js";
import { Reader } from "./Reader.js";
import { LoadErrorView, LoadingView, NoAccessView, SignIn } from "./SignIn.js";

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
  /** Logowanie kontem Monorise w aplikacji na komputer (zob. MailContextValue.signIn). */
  signIn?: () => Promise<void>;
  /** Wylogowanie w aplikacji na komputer (zob. MailContextValue.signOut). */
  signOut?: () => Promise<void>;
}

/** Cała poczta: logowanie, skrzynki, foldery, lista, czytanie i pisanie. Wspólna dla przeglądarki i komputera. */
export function MailApp({ client, platform, signIn, signOut }: MailAppProps) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } } }),
  );
  const context = useMemo(() => ({ client, platform, signIn, signOut }), [client, platform, signIn, signOut]);
  return (
    <MailContext value={context}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Session />
        </TooltipProvider>
      </QueryClientProvider>
    </MailContext>
  );
}

function Session() {
  const { client, signOut } = useMailClient();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: () => client.session.me(), retry: false });

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    try {
      if (signOut) await signOut();
      else await client.session.signOut().catch(() => null);
      queryClient.clear();
      await me.refetch();
    } finally {
      setBusy(false);
    }
  }, [client, me, queryClient, signOut]);

  if (me.isPending) {
    return <LoadingView />;
  }
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return (
        <SignIn
          onSignedIn={() => {
            void queryClient.invalidateQueries();
          }}
        />
      );
    }
    return <LoadErrorView error={errorMessage(me.error)} onRetry={() => void me.refetch()} />;
  }

  const accessDenialMessage = resolveAccessDenialMessage(me.data.capabilities);
  if (accessDenialMessage) {
    return (
      <NoAccessView
        me={me.data}
        message={accessDenialMessage}
        busy={busy || me.isFetching}
        onRetry={() => void me.refetch()}
        onSignOut={() => void handleSignOut()}
      />
    );
  }

  return <Mailbox me={me.data} onSignOut={handleSignOut} />;
}

interface Selection {
  folder: string;
  uid: number | null;
}

function Mailbox({ me, onSignOut }: { me: Me; onSignOut: () => Promise<void> }) {
  const { client, platform } = useMailClient();
  const queryClient = useQueryClient();
  const { resolvedMode, setAppearance } = useTheme();
  const userName = me.employee.fullName || me.account.email || "Konto Monorise";
  const allowRead = canReadMail(me.capabilities);
  const allowSend = canSendMail(me.capabilities);
  const allowManageMailboxes = canManageMailboxes(me.capabilities);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => client.accounts.list() });
  const [accountId, setAccountId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readAccountParam(window.location.search),
  );
  const [selection, setSelection] = useState<Selection>({ folder: "INBOX", uid: null });
  const [accountDialog, setAccountDialog] = useState(false);
  const [appearanceDialog, setAppearanceDialog] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const account: MailAccount | undefined = accounts.data?.find((a) => a.id === accountId) ?? accounts.data?.[0];
  const activeId = account?.id ?? null;

  const folders = useQuery({
    queryKey: ["folders", activeId],
    queryFn: () => client.mail.folders(activeId!),
    enabled: Boolean(activeId && allowRead),
  });

  const messages = useInfiniteQuery({
    queryKey: ["messages", activeId, selection.folder],
    queryFn: ({ pageParam }) => client.mail.messages(activeId!, selection.folder, pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: Boolean(activeId && allowRead),
  });
  const list: MessageSummary[] = useMemo(
    () => messages.data?.pages.flatMap((page) => page.messages) ?? [],
    [messages.data],
  );

  const message = useQuery({
    queryKey: ["message", activeId, selection.folder, selection.uid],
    queryFn: () => client.mail.message(activeId!, selection.folder, selection.uid!),
    enabled: Boolean(activeId && selection.uid && allowRead),
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
      if (!allowSend || !opened || !account) return;
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
    [account, allowSend, opened],
  );

  const forward = useCallback(() => {
    if (!allowSend || !opened) return;
    setDraft({
      ...emptyDraft,
      subject: prefixSubject("Fwd", opened.subject),
      text: quoteForReply(opened.text, opened.from, opened.date),
    });
  }, [allowSend, opened]);

  // Skróty klawiszowe jak w desktopowym Aven
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || draft || accountDialog || appearanceDialog) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const index = list.findIndex((m) => m.uid === selection.uid);
      const go = (next: number) => {
        const item = list[Math.max(0, Math.min(list.length - 1, next))];
        if (item) setSelection((current) => ({ ...current, uid: item.uid }));
      };
      switch (event.key) {
        case "j":
          if (allowRead) go(index + 1);
          else return;
          break;
        case "k":
          if (allowRead) go(index - 1);
          else return;
          break;
        case "c":
          if (allowSend) setDraft(emptyDraft);
          else return;
          break;
        case "r":
          if (allowSend) reply(false);
          else return;
          break;
        case "a":
          if (allowSend) reply(true);
          else return;
          break;
        case "f":
          if (allowSend) forward();
          else return;
          break;
        case "s":
          if (allowRead && opened) setFlags.mutate({ uid: opened.uid, flagged: !opened.flagged });
          else return;
          break;
        case "u":
          if (allowRead && opened) setFlags.mutate({ uid: opened.uid, seen: false });
          else return;
          break;
        case "#":
        case "Delete":
          if (allowRead && selection.uid) remove.mutate(selection.uid);
          else return;
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
  }, [
    accountDialog,
    allowRead,
    allowSend,
    appearanceDialog,
    draft,
    forward,
    list,
    opened,
    remove,
    reply,
    selection.uid,
    setFlags,
  ]);

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

  if (accounts.error) {
    return (
      <AppShell titleBar={titleBar}>
        <Card surface="reading" className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<ShieldAlert />}
            title="Nie udało się pobrać skrzynek"
            description={errorMessage(accounts.error)}
            action={
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={<RefreshCw />} onClick={() => void accounts.refetch()}>
                  Spróbuj ponownie
                </Button>
                <Button variant="secondary" icon={<LogOut />} onClick={() => void onSignOut()}>
                  Wyloguj się
                </Button>
              </div>
            }
          />
        </Card>
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
            description={
              allowManageMailboxes
                ? "Dodaj pierwszą skrzynkę: wystarczy adres i hasło. Serwery podpowiemy dla znanych dostawców."
                : "Nie masz jeszcze podłączonej skrzynki pocztowej. Poproś administratora firmy o uprawnienie zarządzania skrzynkami."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {allowManageMailboxes ? (
                  <Button variant="primary" size="lg" icon={<Plus />} onClick={() => setAccountDialog(true)}>
                    Dodaj skrzynkę
                  </Button>
                ) : null}
                <Button variant="secondary" size="lg" icon={<LogOut />} onClick={() => void onSignOut()}>
                  Wyloguj się
                </Button>
              </div>
            }
          />
        </Card>
        {allowManageMailboxes ? (
          <AccountDialog open={accountDialog} onOpenChange={setAccountDialog} onCreated={setAccountId} />
        ) : null}
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
            <MenuLabel>
              {userName} · {me.organization.name}
            </MenuLabel>
            <MenuSeparator />
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
            {allowManageMailboxes ? (
              <MenuItem icon={<Plus />} onSelect={() => setAccountDialog(true)}>
                Dodaj skrzynkę
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem
              icon={resolvedMode === "dark" ? <Sun /> : <Moon />}
              onSelect={() => setAppearance({ mode: resolvedMode === "dark" ? "light" : "dark" })}
            >
              {resolvedMode === "dark" ? "Tryb jasny" : "Tryb ciemny"}
            </MenuItem>
            <MenuItem icon={<Palette />} onSelect={() => setAppearanceDialog(true)}>
              Wygląd
            </MenuItem>
            <MenuItem icon={<LogOut />} onSelect={() => void onSignOut()}>
              Wyloguj się
            </MenuItem>
          </MenuContent>
        </Menu>
        {allowSend ? (
          <Button
            variant="primary"
            size="lg"
            icon={<PenSquare />}
            className="w-full rounded-full"
            onClick={() => setDraft(emptyDraft)}
          >
            Napisz
          </Button>
        ) : null}
        <SidebarNav aria-label="Foldery" className="min-h-0 flex-1 overflow-y-auto">
          {!allowRead ? (
            <p className="px-2 text-xs text-text-tertiary">Brak uprawnienia do odczytu poczty.</p>
          ) : folders.isPending ? (
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
          {allowRead ? (
            <Button
              iconOnly
              variant="ghost"
              aria-label="Odśwież"
              onClick={() => void refreshLists()}
              disabled={messages.isFetching}
            >
              <RefreshCw className={messages.isFetching ? "animate-spin" : undefined} />
            </Button>
          ) : null}
        </CardHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2" role="list" aria-label="Wiadomości">
          {!allowRead ? (
            <EmptyState
              icon={<ShieldAlert />}
              title="Brak uprawnienia do odczytu"
              description="Twoja rola nie pozwala na przeglądanie wiadomości."
            />
          ) : messages.isPending ? (
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

      {allowManageMailboxes ? (
        <AccountDialog open={accountDialog} onOpenChange={setAccountDialog} onCreated={setAccountId} />
      ) : null}
      <Dialog
        open={appearanceDialog}
        onOpenChange={setAppearanceDialog}
        title="Wygląd"
        description="Ustawienia zapisują się w tej przeglądarce i działają od razu w całej aplikacji."
        className="max-w-xl"
      >
        <AppearanceControls />
      </Dialog>
      {draft && allowSend ? (
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
