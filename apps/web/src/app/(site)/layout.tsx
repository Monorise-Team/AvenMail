import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AVEN_SITE_URL ?? "https://aven.monorise.studio"),
  title: "AvenMail: firmowa poczta w przeglądarce, na komputerze i telefonie",
  description:
    "AvenMail łączy się z pocztą, którą firma już ma, przez IMAP i SMTP. Jeden wygląd w przeglądarce, na komputerze i na telefonie, bez przenoszenia skrzynek.",
  alternates: { canonical: "/" },
};

export const viewport: Viewport = { themeColor: "#071826", colorScheme: "dark" };

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" className="dark" data-theme="moonlight">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
