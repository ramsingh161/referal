import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { fetchJobs } from "@/lib/ats";
import { AtsError, isAtsProvider, isValidToken } from "@/lib/ats/types";

/**
 * Guards the seed registry against staleness — `npm run test:ats`.
 *
 * A registry entry claims "this company's board lives at (provider, token)". A
 * conclusive `not_found` falsifies that claim and fails the suite, because
 * seeding a dead token would tell users about roles that aren't there. An empty
 * board is fine (a company between hiring rounds), and SmartRecruiters can only
 * be checked for "does not throw" — it cannot be proven at all (NOTES-ATS quirk 1).
 */

type Entry = { name: string; provider: string; token: string; verified?: boolean };

const registry = JSON.parse(
  readFileSync(resolve(process.cwd(), "prisma/data/ats-registry.json"), "utf8"),
) as { companies: Entry[] };

describe("ats-registry.json", () => {
  it("has a known provider and a usable token on every entry", () => {
    for (const entry of registry.companies) {
      expect(isAtsProvider(entry.provider), `${entry.name}: provider`).toBe(true);
      expect(isValidToken(entry.token), `${entry.name}: token`).toBe(true);
    }
  });

  it.each(registry.companies.map((entry) => [entry.name, entry.provider, entry.token] as const))(
    "%s (%s:%s) points at a live board",
    async (_name, provider, token) => {
      if (!isAtsProvider(provider)) throw new Error(`bad provider in registry: ${provider}`);
      try {
        const jobs = await fetchJobs(provider, token);
        expect(Array.isArray(jobs)).toBe(true);
      } catch (error) {
        // not_found is the one outcome that condemns the entry; a transient
        // network error is not the registry's fault, so let it surface as-is.
        if (error instanceof AtsError && error.kind === "not_found") {
          throw new Error(`stale registry token: ${provider}:${token} is not a live board`);
        }
        throw error;
      }
    },
  );
});
