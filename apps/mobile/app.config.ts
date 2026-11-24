import type { ExpoConfig } from "expo/config";
import pkg from "./package.json";

/**
 * Wersja aplikacji to wersja AvenMail z package.json (ADR-0087: jedna wersja wszystkich części). Numer
 * kompilacji dla App Store i Google Play wyliczamy z niej: 1.2.3 → 10203, więc zawsze rośnie razem z wersją.
 */
const [major = 0, minor = 0, patch = 0] = pkg.version.split(/[.-]/).map(Number);
const build = major * 10_000 + minor * 100 + patch;

const config: ExpoConfig = {
  name: "AvenMail",
  slug: "avenmail",
  scheme: "avenmail",
  version: pkg.version,
  orientation: "portrait",
  icon: "../desktop/src-tauri/icons/app-icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "studio.monorise.avenmail",
    buildNumber: String(build),
    supportsTablet: true,
  },
  android: {
    package: "studio.monorise.avenmail",
    versionCode: build,
  },
  extra: {
    /** Adres serwera AvenMail, z którym łączy się telefon (symulator iOS: 127.0.0.1). */
    apiUrl: process.env.EXPO_PUBLIC_AVEN_API ?? "http://127.0.0.1:3000",
    /** Identyfikator API AvenMail w Core (odbiorca tokenów); na produkcji równy adresowi API. */
    apiResource: process.env.EXPO_PUBLIC_AVEN_API_RESOURCE ?? "http://aven.localhost:3000",
    /** Serwer logowania MonoriseCore. */
    coreAuthUrl: process.env.EXPO_PUBLIC_CORE_AUTH_URL ?? "http://localhost:3100",
  },
};

export default config;
