import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Live ATS suite — `npm run test:ats`.
 *
 * These tests fetch real job boards to catch the failure the unit suite cannot:
 * a provider silently changing its response shape. They are network-dependent
 * by design, so they are kept out of `npm test` and given generous timeouts.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    retry: 1,
  },
});
