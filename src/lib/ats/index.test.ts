import { describe, expect, it } from "vitest";

import {
  ATS_PROVIDERS,
  allAdapters,
  getAdapter,
  getAdapterOrNull,
  parseBoardUrl,
} from "./index";
import type { AtsProvider } from "./types";

// Pure tests — no network. The live shape checks live in adapters.live.test.ts.

describe("registry", () => {
  it("has one adapter per provider, each self-consistent", () => {
    for (const provider of ATS_PROVIDERS) {
      const adapter = getAdapter(provider);
      expect(adapter.provider).toBe(provider);
      expect(adapter.label.length).toBeGreaterThan(0);
    }
    expect(allAdapters()).toHaveLength(ATS_PROVIDERS.length);
  });

  it("only SmartRecruiters cannot be proven by an empty board", () => {
    // The load-bearing flag: an empty 200 proves the token everywhere but here.
    for (const adapter of allAdapters()) {
      expect(adapter.emptyBoardProvesToken).toBe(adapter.provider !== "smartrecruiters");
    }
  });

  it("rejects an unknown provider string", () => {
    expect(getAdapterOrNull("workday")).toBeNull();
  });
});

describe("parseBoardUrl", () => {
  it("round-trips every adapter's own board URL", () => {
    for (const adapter of allAdapters()) {
      const parsed = parseBoardUrl(adapter.boardUrl("acme-co"));
      expect(parsed).toEqual({ provider: adapter.provider, token: "acme-co" });
    }
  });

  it.each<[string, string, AtsProvider, string]>([
    ["greenhouse API", "https://boards-api.greenhouse.io/v1/boards/stripe/jobs", "greenhouse", "stripe"],
    ["greenhouse board", "https://job-boards.greenhouse.io/stripe", "greenhouse", "stripe"],
    ["lever API", "https://api.lever.co/v0/postings/spotify?mode=json", "lever", "spotify"],
    ["lever board", "https://jobs.lever.co/spotify/abc-123", "lever", "spotify"],
    ["ashby API", "https://api.ashbyhq.com/posting-api/job-board/ashby", "ashby", "ashby"],
    ["ashby board", "https://jobs.ashbyhq.com/ashby", "ashby", "ashby"],
    ["workable API", "https://apply.workable.com/api/v1/widget/accounts/zego", "workable", "zego"],
    ["workable board", "https://apply.workable.com/zego/", "workable", "zego"],
    ["smartrecruiters API", "https://api.smartrecruiters.com/v1/companies/Fiverr/postings", "smartrecruiters", "Fiverr"],
    ["smartrecruiters board", "https://jobs.smartrecruiters.com/Fiverr/743", "smartrecruiters", "Fiverr"],
  ])("parses a %s URL", (_label, url, provider, token) => {
    expect(parseBoardUrl(url)).toEqual({ provider, token });
  });

  it("does not read a Workable posting URL as a board token", () => {
    // apply.workable.com/j/{shortcode} is a single posting, not an account.
    expect(parseBoardUrl("https://apply.workable.com/j/B76C11B977")).toBeNull();
  });

  it("returns null for unknown hosts and non-URLs", () => {
    expect(parseBoardUrl("https://careers.google.com/jobs/results")).toBeNull();
    expect(parseBoardUrl("not a url")).toBeNull();
    expect(parseBoardUrl("ftp://boards.greenhouse.io/stripe")).toBeNull();
  });
});
