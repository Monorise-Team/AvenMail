import {
  ApiError,
  createAppSession,
  createClient,
  type Folder,
  type MailAccount,
  type Message,
  type MessageSummary,
} from "@aven/client";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { mobileSignIn } from "./auth";
import { secureStore } from "./session";
import { colors, gap, radius } from "./theme";

const apiUrl = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://127.0.0.1:3000";

type Screen =
  | { name: "accounts" }
  | { name: "folders"; account: MailAccount }
  | { name: "messages"; account: MailAccount; folder: Folder }
  | { name: "message"; account: MailAccount; folder: Folder; uid: number };

const FOLDER_NAMES: Record<string, string> = {
  inbox: "Odebrane",
  flagged: "Oznaczone",
  drafts: "Wersje robocze",
  sent: "Wysłane",
  archive: "Archiwum",
  junk: "Spam",
  trash: "Kosz",
  all: "Cała poczta",
};

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : "Brak połączenia z serwerem AvenMail. Sprawdź adres i sieć.";

/**
 * AvenMail na telefonie: logowanie, skrzynki, foldery, lista i czytanie wiadomości. Ten sam serwer i klient API
 * co przeglądarka i komputer; własne ekrany na wspólnych tokenach wyglądu (ADR-0089).
 */
export function App() {
  const session = useMemo(() => createAppSession(mobileSignIn, secureStore), []);
  const client = useMemo(() => createClient({ baseUrl: apiUrl, getToken: () => session.accessToken() }), [session]);
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void session.isSignedIn().then(setSignedIn);
    return session.subscribe(setSignedIn);
  }, [session]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.root}>
        {signedIn === undefined ? (
          <Centered>
            <ActivityIndicator color={colors.accent} />
          </Centered>
        ) : signedIn ? (
          <Mailbox client={client} onSignOut={() => void session.signOut()} />
        ) : (
          <SignIn onSignIn={session.signIn} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

/** Logowanie kontem Monorise: ekran logowania Core w przeglądarce systemowej i powrót do aplikacji. */
function SignIn({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await onSignIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się zalogować.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, styles.signIn]}>
      <Text style={styles.title}>Zaloguj się do AvenMail</Text>
      <Text style={styles.muted}>Logujesz się kontem Monorise, tym samym co w innych aplikacjach Monorise.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[styles.primary, busy ? styles.disabled : null]}
        onPress={() => void start()}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>{busy ? "Logowanie…" : "Zaloguj się kontem Monorise"}</Text>
      </Pressable>
    </View>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => !cancelled && setState({ data, loading: false }),
      (error: unknown) => !cancelled && setState({ error: message(error), loading: false }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ładowanie zależy od podanych wartości
  }, deps);
  return state;
}

function Mailbox({ client, onSignOut }: { client: ReturnType<typeof createClient>; onSignOut: () => void }) {
  const [screen, setScreen] = useState<Screen>({ name: "accounts" });
  const back = () => {
    if (screen.name === "folders") setScreen({ name: "accounts" });
    if (screen.name === "messages") setScreen({ name: "folders", account: screen.account });
    if (screen.name === "message") setScreen({ name: "messages", account: screen.account, folder: screen.folder });
  };

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        {screen.name === "accounts" ? (
          <Text style={styles.brand}>AVENMAIL</Text>
        ) : (
          <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Wstecz">
            <Text style={styles.link}>‹ Wstecz</Text>
          </Pressable>
        )}
        <Pressable onPress={onSignOut} accessibilityRole="button">
          <Text style={styles.muted}>Wyloguj</Text>
        </Pressable>
      </View>
      {screen.name === "accounts" ? (
        <Accounts client={client} onOpen={(account) => setScreen({ name: "folders", account })} />
      ) : screen.name === "folders" ? (
        <Folders
          client={client}
          account={screen.account}
          onOpen={(folder) => setScreen({ name: "messages", account: screen.account, folder })}
        />
      ) : screen.name === "messages" ? (
        <Messages
          client={client}
          account={screen.account}
          folder={screen.folder}
          onOpen={(uid) => setScreen({ name: "message", account: screen.account, folder: screen.folder, uid })}
        />
      ) : (
        <Reader client={client} account={screen.account} folder={screen.folder} uid={screen.uid} />
      )}
    </View>
  );
}

function Accounts({ client, onOpen }: { client: ReturnType<typeof createClient>; onOpen: (a: MailAccount) => void }) {
  const accounts = useLoad(() => client.accounts.list(), [client]);
  if (accounts.loading)
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  if (accounts.error)
    return (
      <Centered>
        <Text style={styles.error}>{accounts.error}</Text>
      </Centered>
    );
  if (!accounts.data?.length) {
    return (
      <Centered>
        <Text style={styles.title}>Brak skrzynek</Text>
        <Text style={styles.muted}>Dodaj skrzynkę w przeglądarce albo na komputerze; pojawi się tutaj.</Text>
      </Centered>
    );
  }
  return (
    <FlatList
      data={accounts.data}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => onOpen(item)} accessibilityRole="button">
          <Text style={styles.rowTitle}>{item.displayName ?? item.email}</Text>
          <Text style={styles.muted}>{item.email}</Text>
        </Pressable>
      )}
    />
  );
}

function Folders({
  client,
  account,
  onOpen,
}: {
  client: ReturnType<typeof createClient>;
  account: MailAccount;
  onOpen: (folder: Folder) => void;
}) {
  const folders = useLoad(() => client.mail.folders(account.id), [client, account.id]);
  if (folders.loading)
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  if (folders.error)
    return (
      <Centered>
        <Text style={styles.error}>{folders.error}</Text>
      </Centered>
    );
  return (
    <FlatList
      data={folders.data}
      keyExtractor={(item) => item.path}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable style={[styles.row, styles.rowInline]} onPress={() => onOpen(item)} accessibilityRole="button">
          <Text style={styles.rowTitle}>{item.role ? FOLDER_NAMES[item.role] : item.name}</Text>
          {item.unread ? <Text style={styles.badge}>{item.unread}</Text> : null}
        </Pressable>
      )}
    />
  );
}

function Messages({
  client,
  account,
  folder,
  onOpen,
}: {
  client: ReturnType<typeof createClient>;
  account: MailAccount;
  folder: Folder;
  onOpen: (uid: number) => void;
}) {
  const page = useLoad(() => client.mail.messages(account.id, folder.path), [client, account.id, folder.path]);
  if (page.loading)
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  if (page.error)
    return (
      <Centered>
        <Text style={styles.error}>{page.error}</Text>
      </Centered>
    );
  if (!page.data?.messages.length)
    return (
      <Centered>
        <Text style={styles.muted}>W tym folderze nie ma wiadomości.</Text>
      </Centered>
    );
  return (
    <FlatList
      data={page.data.messages}
      keyExtractor={(item: MessageSummary) => String(item.uid)}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => onOpen(item.uid)} accessibilityRole="button">
          <Text style={[styles.rowTitle, !item.seen && styles.unread]} numberOfLines={1}>
            {item.from?.name || item.from?.address || "(bez nadawcy)"}
          </Text>
          <Text style={[styles.subject, !item.seen && styles.unread]} numberOfLines={1}>
            {item.subject || "(bez tematu)"}
          </Text>
          {item.preview ? (
            <Text style={styles.muted} numberOfLines={2}>
              {item.preview}
            </Text>
          ) : null}
        </Pressable>
      )}
    />
  );
}

const stripHtml = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();

function Reader({
  client,
  account,
  folder,
  uid,
}: {
  client: ReturnType<typeof createClient>;
  account: MailAccount;
  folder: Folder;
  uid: number;
}) {
  const loaded = useLoad<Message>(async () => {
    const message = await client.mail.message(account.id, folder.path, uid);
    if (!message.seen) void client.mail.setFlags(account.id, folder.path, uid, { seen: true }).catch(() => null);
    return message;
  }, [client, account.id, folder.path, uid]);
  if (loaded.loading)
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  if (loaded.error || !loaded.data)
    return (
      <Centered>
        <Text style={styles.error}>{loaded.error}</Text>
      </Centered>
    );
  const mail = loaded.data;
  return (
    <ScrollView contentContainerStyle={[styles.card, styles.reader]}>
      <Text style={styles.title}>{mail.subject || "(bez tematu)"}</Text>
      <Text style={styles.muted}>
        {mail.from?.name ? `${mail.from.name} · ` : ""}
        {mail.from?.address}
      </Text>
      <Text style={styles.body}>{mail.text ?? (mail.html ? stripHtml(mail.html) : "")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#09090b" },
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  brand: { color: colors["text-secondary"], fontSize: 12, fontWeight: "600", letterSpacing: 1.5 },
  card: {
    backgroundColor: colors["bg-secondary"],
    borderColor: colors["card-border"],
    borderWidth: 1,
    borderRadius: radius.card,
  },
  signIn: { margin: 16, marginTop: 80, padding: 20, gap: 12 },
  disabled: { opacity: 0.5 },
  reader: { margin: gap, padding: 20, gap: 12 },
  list: { padding: gap, gap: 6 },
  row: {
    backgroundColor: colors["bg-secondary"],
    borderRadius: radius.row,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
  },
  rowInline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowTitle: { color: colors["text-primary"], fontSize: 15 },
  subject: { color: colors["text-secondary"], fontSize: 14 },
  unread: { fontWeight: "700", color: colors["text-primary"] },
  title: { color: colors["text-primary"], fontSize: 20, fontWeight: "600" },
  muted: { color: colors["text-tertiary"], fontSize: 13 },
  body: { color: colors["text-secondary"], fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 14, textAlign: "center" },
  link: { color: colors.accent, fontSize: 15 },
  badge: {
    color: colors["accent-fg"],
    backgroundColor: colors.accent,
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: "600",
  },
  primary: { backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  primaryText: { color: colors["accent-fg"], fontSize: 15, fontWeight: "600" },
});
