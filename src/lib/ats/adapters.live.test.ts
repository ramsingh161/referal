import { describe, expect, it } from "vitest";

import { fetchJobs } from "./index";
import { AtsError, type AtsProvider, type NormalizedJob } from "./types";

/**
 * Live smoke tests — `npm run test:ats`.
 *
 * These hit real boards to catch a provider silently changing its response
 * shape, which no fixture can. Tokens are the ones verified in NOTES-ATS.md; if
 * one starts failing, check whether the company simply closed its roles before
 * assuming the adapter broke.
 */

// [provider, token] verified to return live postings on 2026-08-25.
const LIVE: [AtsProvider, string][] = [
  ["greenhouse", "stripe"],
  ["lever", "spotify"],
  ["ashby", "ashby"],
  ["workable", "zego"],
  ["smartrecruiters", "Fiverr"],
];

// Passes assertValidToken but resolves to no board on any provider.
const BOGUS = "zzqxnotarealcompany9184";

function assertWellFormed(job: NormalizedJob, provider: AtsProvider, token: string): void {
  expect(job.source).toBe(provider);
  expect(job.externalId.startsWith(`${token}:`)).toBe(true);
  expect(typeof job.title).toBe("string");
  expect(job.title.length).toBeGreaterThan(0);
  expect(job.url).toMatch(/^https:\/\//);
  expect(typeof job.remote).toBe("boolean");
  expect(job.location === null || typeof job.location === "string").toBe(true);
  expect(job.department === null || typeof job.department === "string").toBe(true);
  expect(job.postedAt === null || job.postedAt instanceof Date).toBe(true);
}

describe.each(LIVE)("%s adapter (live: %s)", (provider, token) => {
  it("returns a non-empty, well-formed NormalizedJob[]", async () => {
    const jobs = await fetchJobs(provider, token);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) assertWellFormed(job, provider, token);
  });

  it("issues stable, unique externalIds", async () => {
    // Guards collectJobs's dedup: a board can list one posting twice (zego does).
    const jobs = await fetchJobs(provider, token);
    const ids = new Set(jobs.map((job) => job.externalId));
    expect(ids.size).toBe(jobs.length);
  });
});

describe("bogus token", () => {
  it.each<[AtsProvider]>([["greenhouse"], ["lever"], ["ashby"], ["workable"]])(
    "%s rejects an unknown token as not_found",
    async (provider) => {
      // These four 404 on an unknown board, so the resolver may cache a negative.
      await expect(fetchJobs(provider, BOGUS)).rejects.toMatchObject({
        name: "AtsError",
        kind: "not_found",
      });
    },
  );

  it("smartrecruiters returns empty rather than throwing", async () => {
    // The quirk that forbids slug-probing it: 200 + empty for any token at all.
    const jobs = await fetchJobs("smartrecruiters", BOGUS);
    expect(jobs).toEqual([]);
  });

  it("exposes AtsError so callers can branch on kind", async () => {
    const error = await fetchJobs("greenhouse", BOGUS).catch((e) => e);
    expect(error).toBeInstanceOf(AtsError);
    expect(error.isConclusive).toBe(true);
  });
});
