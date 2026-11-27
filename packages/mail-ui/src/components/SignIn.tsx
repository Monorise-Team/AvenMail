"use client";

import type { Me } from "@aven/contracts";
import { AppBackdrop, Banner, Button, Card, Skeleton } from "@monorise-team/ui";
import { LogOut, Mail, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AUTH_ERROR_MESSAGES, sanitizeReturnTo } from "../lib/access.js";
import { useMailClient } from "../lib/context.js";
import { errorMessage } from "../lib/errors.js";

function CenteredCardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppBackdrop />
      <main className="flex min-h-dvh items-center justify-center p-6">
        <Card surface="float" className="mr-enter flex w-full max-w-md flex-col gap-4 p-8">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-text-secondary uppercase">
            <Mail className="size-4 text-accent" aria-hidden />
            AvenMail
          </div>
          {children}
        </Card>
      </main>
    </>
  );
}

/** Stan początkowego ładowania sesji i danych aplikacji. */
export function LoadingView() {
  return (
    <CenteredCardLayout>
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Wczytywanie AvenMail">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="mt-2 h-10 w-full" />
      </div>
    </CenteredCardLayout>
  );
}

/**
 * Logowanie kontem Monorise (MonoriseCore, ADR-0095). W przeglądarce prowadzi je serwer AvenMail: ekran
 * logowania Core i powrót na tę samą stronę. W aplikacji na komputer robi to przeglądarka systemowa.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { platform, signIn } = useMailClient();
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const reason = new URLSearchParams(window.location.search).get("auth_error");
    return reason ? (AUTH_ERROR_MESSAGES[reason] ?? AUTH_ERROR_MESSAGES.failed ?? "Nie udało się zalogować.") : null;
  });
  const [busy, setBusy] = useState(false);
  const available = platform === "web" || signIn !== undefined;

  async function start() {
    setError(null);
    if (platform === "web") {
      const returnTo = sanitizeReturnTo(window.location.pathname, window.location.search);
      window.location.assign(`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    if (!signIn) return;
    setBusy(true);
    try {
      await signIn();
      onSignedIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredCardLayout>
      <h1 className="font-display text-2xl font-semibold">Zaloguj się do AvenMail</h1>
      <p className="text-sm leading-relaxed text-text-secondary">
        Poczta korzysta z konta Monorise, tego samego co w innych aplikacjach Monorise. Po zalogowaniu zobaczysz swoje
        podłączone skrzynki.
      </p>
      {error ? <Banner tone="danger" message={error} /> : null}
      {available ? null : (
        <p className="text-sm text-text-secondary">Logowanie w aplikacji na komputer pojawi się w kolejnej wersji.</p>
      )}
      <Button variant="primary" size="lg" className="w-full" disabled={busy || !available} onClick={() => void start()}>
        {busy ? "Logowanie…" : "Zaloguj się kontem Monorise"}
      </Button>
    </CenteredCardLayout>
  );
}

/** Błąd połączenia albo wczytania aplikacji przed wyświetleniem widoku głównego. */
export function LoadErrorView({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <CenteredCardLayout>
      <h1 className="font-display text-xl font-semibold">Nie udało się wczytać AvenMail</h1>
      <Banner tone="danger" message={error ?? "Wystąpił nieoczekiwany błąd."} />
      <Button variant="primary" size="md" icon={<RefreshCw aria-hidden />} onClick={onRetry}>
        Spróbuj ponownie
      </Button>
    </CenteredCardLayout>
  );
}

/** Stan zalogowanej osoby bez dostępu do produktu albo bez przypisanej roli w AvenMail. */
export function NoAccessView({
  me,
  message,
  busy,
  onRetry,
  onSignOut,
}: {
  me: Me;
  message: string;
  busy: boolean;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <CenteredCardLayout>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-semibold">Brak dostępu do AvenMail</h1>
        <p className="text-xs text-text-secondary">
          {me.employee.fullName} · {me.organization.name}
        </p>
      </div>
      <Banner tone="warning" message={message} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="md" icon={<RefreshCw aria-hidden />} onClick={onRetry} disabled={busy}>
          Odśwież
        </Button>
        <Button variant="secondary" size="md" icon={<LogOut aria-hidden />} onClick={onSignOut} disabled={busy}>
          Wyloguj
        </Button>
      </div>
    </CenteredCardLayout>
  );
}
