import { defineConfig } from "drizzle-kit";

/** `pnpm db:generate` pisze migracje SQL do drizzle/ po zmianie src/server/db/schema.ts. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
});
