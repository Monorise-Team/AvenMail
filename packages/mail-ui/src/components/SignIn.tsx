"use client";

import { Button, Card } from "@monorise-team/ui";
import { useState } from "react";
import { useMailClient } from "../lib/context.js";
import { errorMessage } from "../lib/errors.js";

/** Powody nieudanego logowania, które serwer dopisuje do adresu (`?auth_error=`). */
const AUTH_ERRORS: Record<string, string> = {
  expired: "Logowanie trwało zbyt długo. Spróbuj jeszcze raz.",
  denied: "Logowanie zostało przerwane.",
  unavailable: "Logowanie Monorise jest chwilowo niedostępne. Spróbuj za chwilę.",
};

/**
 * Logowanie kontem Monorise (MonoriseCore, ADR-0095). W przeglądarce prowadzi je serwer AvenMail: ekran
 * logowania Core i powrót na tę samą stronę. W aplikacji na komputer robi to przeglądarka systemowa.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { platform, signIn } = useMailClient();
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const reason = new URLSearchParams(window.location.search).get("auth_error");
    return reason ? (AUTH_ERRORS[reason] ?? "Nie udało się zalogować. Spróbuj jeszcze raz.") : null;
  });
  const [busy, setBusy] = useState(false);
  const available = platform === "web" || signIn !== undefined;

  async function start() {
    setError(null);
    if (platform === "web") {
      const params = new URLSearchParams(window.location.search);
      params.delete("auth_error");
      const query = params.toString();
      const returnTo = `${window.location.pathname}${query ? `?${query}` : ""}`;
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
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card surface="float" className="mr-enter flex w-full max-w-sm flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-xl font-semibold">Zaloguj się do AvenMail</h1>
          <p className="text-sm text-text-tertiary">
            Logujesz się kontem Monorise, tym samym co w innych aplikacjach Monorise.
          </p>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {available ? null : (
          <p className="text-sm text-text-secondary">Logowanie w aplikacji na komputer pojawi się w kolejnej wersji.</p>
        )}
        <Button variant="primary" size="lg" disabled={busy || !available} onClick={() => void start()}>
          {busy ? "Logowanie…" : "Zaloguj się kontem Monorise"}
        </Button>
      </Card>
    </div>
  );
}
