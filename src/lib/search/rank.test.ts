import { describe, expect, it } from "vitest";

import type { JobPreferences } from "@/lib/prefs";

import {
  bestReferrer,
  inferSeniority,
  matchesPreferences,
  RECENCY_HALF_LIFE_DAYS,
  referrerPower,
  scoreJob,
  type RankJob,
} from "./rank";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function job(overrides: Partial<RankJob> = {}): RankJob {
  return {
    title: "Software Engineer",
    location: "London, United Kingdom",
    remote: false,
    department: null,
    postedAt: null,
    ...overrides,
  };
}

function prefs(overrides: Partial<JobPreferences> = {}): JobPreferences {
  return {
    titleKeywords: [],
    locations: [],
    seniority: [],
    remoteOnly: false,
    ...overrides,
  };
}

/** N interchangeable contacts, none of them notably well-placed. */
function peers(count: number) {
  return Array.from({ length: count }, () => ({ position: "Software Engineer" }));
}

function daysAgo(days: number): Date {
  return new Date(NOW - days * DAY_MS);
}

describe("inferSeniority", () => {
  it("prefers the more senior reading when a title carries two signals", () => {
    expect(inferSeniority("Senior Staff Engineer")).toBe("staff");
    expect(inferSeniority("Senior Director, Platform")).toBe("director");
    expect(inferSeniority("Associate Director")).toBe("director");
  });

  it("reads the common level words", () => {
    expect(inferSeniority("VP of Engineering")).toBe("executive");
    expect(inferSeniority("Head of Design")).toBe("director");
    expect(inferSeniority("Engineering Manager")).toBe("lead");
    expect(inferSeniority("Senior Backend Engineer")).toBe("senior");
    expect(inferSeniority("Junior Analyst")).toBe("entry");
    expect(inferSeniority("Software Engineering Intern")).toBe("internship");
  });

  it("returns null for a title with no level signal, rather than guessing", () => {
    expect(inferSeniority("Software Engineer")).toBeNull();
    expect(inferSeniority("Product Designer")).toBeNull();
  });

  it("is word-bounded, so lookalike words do not imply a level", () => {
    // "Staffing" is not "Staff"; a substring test would call this a staff role.
    expect(inferSeniority("Staffing Coordinator")).toBeNull();
  });

  it("does not read sales jargon as seniority, but still sees a real manager", () => {
    expect(inferSeniority("Lead Generation Specialist")).toBeNull();
    expect(inferSeniority("Lead Generation Manager")).toBe("lead");
  });
});

describe("matchesPreferences", () => {
  it("keeps everything when the user has stated no preference", () => {
    expect(matchesPreferences(job(), prefs())).toBe(true);
  });

  it("drops onsite roles for a remote-only user", () => {
    expect(matchesPreferences(job({ remote: false }), prefs({ remoteOnly: true }))).toBe(false);
    expect(matchesPreferences(job({ remote: true }), prefs({ remoteOnly: true }))).toBe(true);
  });

  it("treats a location that says remote as remote, even with no provider flag", () => {
    const posting = job({ remote: false, location: "Remote - EMEA" });
    expect(matchesPreferences(posting, prefs({ remoteOnly: true }))).toBe(true);
  });

  it("filters on title keywords, word-bounded", () => {
    const keywords = prefs({ titleKeywords: ["backend"] });
    expect(matchesPreferences(job({ title: "Senior Backend Engineer" }), keywords)).toBe(true);
    expect(matchesPreferences(job({ title: "Frontend Engineer" }), keywords)).toBe(false);

    // "data" must not match "Database" -- a substring test would let this through.
    expect(
      matchesPreferences(job({ title: "Database Administrator" }), prefs({ titleKeywords: ["data"] })),
    ).toBe(false);
  });

  it("keeps a remote role under a location filter, since it is available anywhere", () => {
    const berlin = prefs({ locations: ["Berlin"] });
    expect(matchesPreferences(job({ location: "Berlin, Germany" }), berlin)).toBe(true);
    expect(matchesPreferences(job({ location: "Austin, TX" }), berlin)).toBe(false);
    expect(matchesPreferences(job({ location: "Austin, TX", remote: true }), berlin)).toBe(true);
  });

  it("keeps a role whose level cannot be read, rather than dropping it on a guess", () => {
    const senior = prefs({ seniority: ["senior"] });
    expect(matchesPreferences(job({ title: "Software Engineer" }), senior)).toBe(true);
    expect(matchesPreferences(job({ title: "Senior Engineer" }), senior)).toBe(true);
    expect(matchesPreferences(job({ title: "Junior Engineer" }), senior)).toBe(false);
  });
});

describe("referrerPower", () => {
  it("ranks a recruiter above a leader, a leader above a manager, a manager above a peer", () => {
    const posting = job({ title: "Account Executive" });
    const recruiter = referrerPower({ position: "Technical Recruiter" }, posting);
    const leader = referrerPower({ position: "VP of Sales" }, posting);
    const manager = referrerPower({ position: "Regional Manager" }, posting);
    const peer = referrerPower({ position: "Office Administrator" }, posting);

    expect(recruiter).toBeGreaterThan(leader);
    expect(leader).toBeGreaterThan(manager);
    expect(manager).toBeGreaterThan(peer);
  });

  it("credits a contact who works in the role's discipline", () => {
    const posting = job({ title: "Staff Backend Engineer" });
    const engineer = referrerPower({ position: "Backend Engineer" }, posting);
    const accountant = referrerPower({ position: "Accounts Payable Clerk" }, posting);

    expect(engineer).toBeGreaterThan(accountant);
  });

  it("falls back to the job title when the provider gave no department", () => {
    // Greenhouse never supplies a department, so this path carries most matches.
    const posting = job({ title: "Product Designer", department: null });
    expect(referrerPower({ position: "Senior Product Designer" }, posting)).toBeGreaterThan(
      referrerPower({ position: "Warehouse Operative" }, posting),
    );
  });

  it("survives a contact with no title at all", () => {
    expect(referrerPower({ position: null }, job())).toBeGreaterThan(0);
  });
});

describe("bestReferrer", () => {
  it("picks the contact the score credited", () => {
    const posting = job({ title: "Backend Engineer" });
    const contacts = [
      { position: "Office Administrator" },
      { position: "Technical Recruiter" },
      { position: "Backend Engineer" },
    ];

    expect(bestReferrer(contacts, posting)).toEqual({ position: "Technical Recruiter" });
  });

  it("returns null when there is nobody to ask", () => {
    expect(bestReferrer([], job())).toBeNull();
  });
});

describe("scoreJob", () => {
  it("ranks a job with 3 connections above an otherwise-identical job with 1", () => {
    const posting = job({ postedAt: daysAgo(5) });

    const three = scoreJob(posting, peers(3), prefs(), NOW);
    const one = scoreJob(posting, peers(1), prefs(), NOW);

    expect(three.total).toBeGreaterThan(one.total);
  });

  it("scores a job with no connections at all lowest", () => {
    const posting = job({ postedAt: daysAgo(5) });

    expect(scoreJob(posting, [], prefs(), NOW).connectionStrength).toBe(0);
    expect(scoreJob(posting, [], prefs(), NOW).total).toBeLessThan(
      scoreJob(posting, peers(1), prefs(), NOW).total,
    );
  });

  it("saturates: the 8th contact adds less than the 2nd", () => {
    const posting = job({ postedAt: daysAgo(5) });
    const at = (n: number) => scoreJob(posting, peers(n), prefs(), NOW).connectionStrength;

    expect(at(2) - at(1)).toBeGreaterThan(at(8) - at(7));
  });

  it("prefers one well-placed contact to one poorly-placed one", () => {
    const posting = job({ title: "Backend Engineer", postedAt: daysAgo(5) });

    const recruiter = scoreJob(posting, [{ position: "Technical Recruiter" }], prefs(), NOW);
    const stranger = scoreJob(posting, [{ position: "Warehouse Operative" }], prefs(), NOW);

    expect(recruiter.total).toBeGreaterThan(stranger.total);
  });

  it("decays recency with a 30-day half-life", () => {
    const fresh = scoreJob(job({ postedAt: daysAgo(0) }), peers(1), prefs(), NOW);
    const half = scoreJob(
      job({ postedAt: daysAgo(RECENCY_HALF_LIFE_DAYS) }),
      peers(1),
      prefs(),
      NOW,
    );
    const quarter = scoreJob(
      job({ postedAt: daysAgo(RECENCY_HALF_LIFE_DAYS * 2) }),
      peers(1),
      prefs(),
      NOW,
    );

    expect(fresh.recency).toBeCloseTo(1, 5);
    expect(half.recency).toBeCloseTo(0.5, 5);
    expect(quarter.recency).toBeCloseTo(0.25, 5);
    expect(fresh.total).toBeGreaterThan(half.total);
    expect(half.total).toBeGreaterThan(quarter.total);
  });

  it("does not let an unreadable posting date exclude a role", () => {
    const undated = scoreJob(job({ postedAt: null }), peers(1), prefs(), NOW);

    expect(undated.recency).toBeGreaterThan(0);
    expect(undated.recency).toBeLessThan(1);
  });

  it("treats a future posting date as brand new rather than as a negative age", () => {
    const future = scoreJob(job({ postedAt: new Date(NOW + DAY_MS) }), peers(1), prefs(), NOW);
    expect(future.recency).toBe(1);
  });

  it("rewards a title that matches more of what the user asked for", () => {
    const preferences = prefs({ titleKeywords: ["backend", "platform"] });
    const both = scoreJob(job({ title: "Backend Platform Engineer" }), peers(1), preferences, NOW);
    const one = scoreJob(job({ title: "Backend Engineer" }), peers(1), preferences, NOW);

    expect(both.titleRelevance).toBeGreaterThan(one.titleRelevance);
    // ...but matching one interest is still most of the credit, not a third of it.
    expect(one.titleRelevance).toBeGreaterThan(0.5);
  });

  it("keeps every component within 0-1 so the weights mean what they say", () => {
    const preferences = prefs({
      titleKeywords: ["backend"],
      locations: ["London"],
      seniority: ["senior"],
    });
    const breakdown = scoreJob(
      job({ title: "Senior Backend Engineer", postedAt: daysAgo(1) }),
      peers(12),
      preferences,
      NOW,
    );

    for (const [name, value] of Object.entries(breakdown)) {
      if (name === "total") continue;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(breakdown.total).toBeLessThanOrEqual(100);
  });

  it("lets connection strength outweigh every softer signal combined", () => {
    // A perfect fit nobody can refer you into, versus a role you match on
    // nothing but where you know eight people. The second is the one this app
    // exists to surface.
    const preferences = prefs({ titleKeywords: ["backend"], locations: ["London"] });

    const perfectFitAlone = scoreJob(
      job({ title: "Backend Engineer", location: "London", postedAt: daysAgo(0) }),
      [],
      preferences,
      NOW,
    );
    const poorFitWellConnected = scoreJob(
      job({ title: "Backend Engineer", location: "Austin, TX", postedAt: daysAgo(120) }),
      peers(8),
      preferences,
      NOW,
    );

    expect(poorFitWellConnected.total).toBeGreaterThan(perfectFitAlone.total);
  });
});
