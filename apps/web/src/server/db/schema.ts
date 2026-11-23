import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Baza AvenMail (`avenmail_db`): tylko konta, sesje i konfiguracja skrzynek. Treści maili tu nie ma (ADR-0088).
 * Do czasu logowania przez Core użytkownicy to konta deweloperskie (ADR-0090).
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 tokenu; sam token zna tylko przeglądarka (ciasteczko) albo aplikacja (systemowy sejf). */
    tokenHash: text("token_hash").notNull().unique(),
    kind: text("kind", { enum: ["web", "app"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const mailAccounts = pgTable(
  "mail_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name"),
    username: text("username"),
    imapHost: text("imap_host").notNull(),
    imapPort: integer("imap_port").notNull(),
    imapSecurity: text("imap_security", { enum: ["ssl", "starttls", "none"] }).notNull(),
    smtpHost: text("smtp_host").notNull(),
    smtpPort: integer("smtp_port").notNull(),
    smtpSecurity: text("smtp_security", { enum: ["ssl", "starttls", "none"] }).notNull(),
    /** Hasło zaszyfrowane AES-256-GCM (crypto.ts), związane z id skrzynki i użytkownika. */
    passwordCiphertext: text("password_ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("mail_accounts_user_email_idx").on(table.userId, table.email)],
);
