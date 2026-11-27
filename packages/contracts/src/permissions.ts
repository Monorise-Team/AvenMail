import { definePermissions, type PermissionKeyOf } from "@monorise-team/permissions";

/**
 * Uprawnienia AvenMail deklarowane w kodzie produktu (ADR-0036).
 * Manifest i gotowe role są rejestrowane w MonoriseCore poleceniem `pnpm permissions:register`.
 */
export const AVENMAIL_PERMISSIONS = definePermissions("avenmail", {
  "mail.read": "Odczyt folderów, wiadomości i zmiana ich stanu w podłączonych skrzynkach",
  "mail.send": "Wysyłanie, odpowiadanie i przekazywanie wiadomości e-mail",
  "mailboxes.manage": "Dodawanie, testowanie i usuwanie skrzynek pocztowych",
});

export const AVENMAIL_PERMISSION_MANIFEST = AVENMAIL_PERMISSIONS.manifest;

export type AvenmailPermissionKey = PermissionKeyOf<typeof AVENMAIL_PERMISSIONS>;

export interface AvenmailRoleTemplate {
  readonly key: `avenmail.${string}`;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly [AvenmailPermissionKey, ...AvenmailPermissionKey[]];
}

/**
 * Gotowe role (szablony) AvenMail wysyłane do MonoriseCore zaraz po manifeście uprawnień (ADR-0033, ADR-0036).
 */
export const AVENMAIL_ROLE_TEMPLATES = [
  {
    key: "avenmail.user",
    name: "Użytkownik AvenMail",
    description: "Odczytuje i wysyła wiadomości w podłączonych skrzynkach pocztowych",
    permissions: [AVENMAIL_PERMISSIONS.keys["mail.read"], AVENMAIL_PERMISSIONS.keys["mail.send"]],
  },
  {
    key: "avenmail.admin",
    name: "Administrator AvenMail",
    description: "Zarządza podłączonymi skrzynkami pocztowymi oraz odczytuje i wysyła wiadomości",
    permissions: [
      AVENMAIL_PERMISSIONS.keys["mail.read"],
      AVENMAIL_PERMISSIONS.keys["mail.send"],
      AVENMAIL_PERMISSIONS.keys["mailboxes.manage"],
    ],
  },
] as const satisfies readonly AvenmailRoleTemplate[];
