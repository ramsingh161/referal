import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 moved the connection URL out of schema.prisma's datasource block
 * and into this file. The schema now declares only the `provider`; the runtime
 * client gets its connection via a driver adapter (see src/lib/db.ts).
 *
 * Note that `.env` is NOT loaded implicitly by the Prisma CLI in v7 — hence the
 * `dotenv/config` import above.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
    // Node 24 strips TypeScript types natively, so the seed needs no loader.
    seed: "node prisma/seed.ts",
  },

  datasource: {
    // Read process.env directly rather than Prisma's env() helper: env() throws
    // when the variable is absent, and EVERY CLI command loads this file —
    // including `prisma generate`, which runs during CI builds where no
    // database URL is configured. A fallback keeps those builds working.
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  },
});
