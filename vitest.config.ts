import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Unit suite. Deliberately excludes `*.live.test.ts` — those hit real ATS
 * boards over the network and belong to `vitest.live.config.ts`, so a flaky
 * connection can never fail `npm test`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.live.test.ts", "node_modules/**"],
    // A throwaway in-memory URL: some modules (resolve.ts → db.ts) build the
    // Prisma client at import time. Unit tests never query, so this only lets
    // the client construct — it never opens a real database.
    env: { DATABASE_URL: ":memory:" },
  },
});
