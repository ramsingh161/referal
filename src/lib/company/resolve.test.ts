import { describe, expect, it } from "vitest";

import { isNegativeCacheFresh, slugCandidates } from "./resolve";

// Pure helpers only — the DB-backed resolution paths are exercised end-to-end by
// the seed and (for the registry data) registry.live.test.ts.

describe("slugCandidates", () => {
  it("offers the collapsed and hyphenated forms of a multi-word name", () => {
    expect(slugCandidates("acme corp")).toEqual(["acmecorp", "acme-corp"]);
  });

  it("collapses to a single candidate for a one-word name", () => {
    expect(slugCandidates("stripe")).toEqual(["stripe"]);
  });

  it("strips punctuation the way ATS tokens require", () => {
    expect(slugCandidates("ben & jerry's")).toEqual(["benjerrys", "ben-jerry-s"]);
  });

  it("returns nothing usable for an empty name", () => {
    expect(slugCandidates("")).toEqual([]);
  });
});

describe("isNegativeCacheFresh", () => {
  const now = Date.parse("2026-09-15T00:00:00Z");

  it("is true for a recent no_board", () => {
    const company = { resolveStatus: "no_board", lastProbedAt: new Date(now - 1000) };
    expect(isNegativeCacheFresh(company, now)).toBe(true);
  });

  it("is false once the 30-day TTL has passed", () => {
    const company = {
      resolveStatus: "no_board",
      lastProbedAt: new Date(now - 31 * 24 * 60 * 60 * 1000),
    };
    expect(isNegativeCacheFresh(company, now)).toBe(false);
  });

  it("never treats a resolved or never-probed row as a fresh negative", () => {
    expect(isNegativeCacheFresh({ resolveStatus: "resolved", lastProbedAt: new Date(now) }, now)).toBe(false);
    expect(isNegativeCacheFresh({ resolveStatus: "no_board", lastProbedAt: null }, now)).toBe(false);
  });
});
