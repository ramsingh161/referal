import { describe, expect, it } from "vitest";

import type { NormalizedJob } from "@/lib/ats/types";

import {
  decodeErrors,
  groupByCompany,
  hasChanged,
  isJobCacheStale,
  isRunStalled,
  RUN_DEADLINE_MS,
  type ConnectionRow,
} from "./run-search";

// Pure helpers only -- the orchestration itself is DB- and network-bound and is
// exercised by the seed, in keeping with the rest of this suite.

const NOW = Date.parse("2026-09-28T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

function connection(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: "c1",
    companyId: null,
    companyNorm: "acme",
    companyRaw: "Acme Corp",
    position: "Software Engineer",
    ...overrides,
  };
}

describe("isJobCacheStale", () => {
  it("is fresh inside the 6h TTL", () => {
    expect(isJobCacheStale({ lastFetchedAt: new Date(NOW - 5 * HOUR_MS) }, NOW)).toBe(false);
  });

  it("is stale once the TTL has passed", () => {
    expect(isJobCacheStale({ lastFetchedAt: new Date(NOW - 7 * HOUR_MS) }, NOW)).toBe(true);
  });

  it("treats a company we have never fetched as stale", () => {
    expect(isJobCacheStale({ lastFetchedAt: null }, NOW)).toBe(true);
  });
});

describe("isRunStalled", () => {
  it("leaves a run that is merely slow alone", () => {
    const run = { status: "running", startedAt: new Date(NOW - RUN_DEADLINE_MS / 2) };
    expect(isRunStalled(run, NOW)).toBe(false);
  });

  it("calls a run past the deadline stalled, so it stops being polled forever", () => {
    const run = { status: "running", startedAt: new Date(NOW - RUN_DEADLINE_MS - 1) };
    expect(isRunStalled(run, NOW)).toBe(true);
  });

  it("never calls a finished run stalled, however old", () => {
    const run = { status: "done", startedAt: new Date(NOW - 30 * 24 * HOUR_MS) };
    expect(isRunStalled(run, NOW)).toBe(false);
  });
});

describe("groupByCompany", () => {
  it("collapses connections onto one company per normalised key", () => {
    const [acme, stripe] = groupByCompany([
      connection({ id: "a", companyNorm: "acme", companyRaw: "Acme Corp" }),
      connection({ id: "b", companyNorm: "acme", companyRaw: "ACME CORP." }),
      connection({ id: "c", companyNorm: "stripe", companyRaw: "Stripe" }),
    ]);

    expect(acme?.nameNorm).toBe("acme");
    expect(acme?.connections.map((row) => row.id)).toEqual(["a", "b"]);
    expect(stripe?.nameNorm).toBe("stripe");
    expect(stripe?.connections).toHaveLength(1);
  });

  it("carries a display name a human would recognise, not the normalised key", () => {
    const [group] = groupByCompany([connection({ companyRaw: "ACME CORP" })]);
    expect(group?.displayName).not.toBe("acme");
    expect(group?.displayName.toLowerCase()).toContain("acme");
  });

  it("falls back to the key when the raw name is nothing but whitespace", () => {
    const [group] = groupByCompany([connection({ companyNorm: "acme", companyRaw: "  \t " })]);
    expect(group?.displayName).toBe("acme");
  });
});

describe("hasChanged", () => {
  const stored = {
    title: "Backend Engineer",
    location: "London",
    remote: false,
    department: null,
    url: "https://boards.example.com/1",
    postedAt: new Date("2026-09-01T00:00:00Z"),
    isOpen: true,
  };
  const fetched: NormalizedJob = {
    source: "greenhouse",
    externalId: "1",
    title: "Backend Engineer",
    location: "London",
    remote: false,
    department: null,
    url: "https://boards.example.com/1",
    postedAt: new Date("2026-09-01T00:00:00Z"),
  };

  it("sees no change when the board returned exactly what we hold", () => {
    expect(hasChanged(stored, fetched)).toBe(false);
  });

  it("compares dates by instant, not by identity", () => {
    const sameInstant = { ...fetched, postedAt: new Date("2026-09-01T00:00:00Z") };
    expect(hasChanged(stored, sameInstant)).toBe(false);
    expect(hasChanged(stored, { ...fetched, postedAt: new Date("2026-09-02T00:00:00Z") })).toBe(
      true,
    );
  });

  it("notices a date appearing or disappearing", () => {
    expect(hasChanged({ ...stored, postedAt: null }, fetched)).toBe(true);
    expect(hasChanged(stored, { ...fetched, postedAt: null })).toBe(true);
  });

  it("notices the fields a user would actually see move", () => {
    expect(hasChanged(stored, { ...fetched, title: "Senior Backend Engineer" })).toBe(true);
    expect(hasChanged(stored, { ...fetched, location: "Remote" })).toBe(true);
    expect(hasChanged(stored, { ...fetched, remote: true })).toBe(true);
    expect(hasChanged(stored, { ...fetched, department: "Engineering" })).toBe(true);
    expect(hasChanged(stored, { ...fetched, url: "https://boards.example.com/2" })).toBe(true);
  });

  it("counts a closed posting reappearing as a change, so it is reopened", () => {
    expect(hasChanged({ ...stored, isOpen: false }, fetched)).toBe(true);
  });
});

describe("decodeErrors", () => {
  it("round-trips what a run recorded", () => {
    const errors = [{ company: "Acme", reason: "rate limited" }];
    expect(decodeErrors(JSON.stringify(errors))).toEqual(errors);
  });

  it("treats a run with no errors as having none", () => {
    expect(decodeErrors(null)).toEqual([]);
    expect(decodeErrors("")).toEqual([]);
  });

  it("never throws on a corrupt or unexpected payload", () => {
    expect(decodeErrors("{not json")).toEqual([]);
    expect(decodeErrors('{"company":"Acme"}')).toEqual([]);
    expect(decodeErrors('[{"nope":1},{"company":null,"reason":"ok"}]')).toEqual([
      { company: null, reason: "ok" },
    ]);
  });
});
