import { describe, expect, it } from "vitest";

import { bestFuzzyMatch, jaroWinkler } from "./similarity";

describe("jaroWinkler", () => {
  it("is 1 for identical strings and 0 for a disjoint pair", () => {
    expect(jaroWinkler("stripe", "stripe")).toBe(1);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });

  it("scores a single-character typo very high but not perfect", () => {
    const score = jaroWinkler("cloudflare", "cloudflaer");
    expect(score).toBeGreaterThan(0.97);
    expect(score).toBeLessThan(1);
  });

  it("keeps genuinely different companies below the merge threshold", () => {
    // The same failure mode normalize.test.ts guards: never merge these.
    expect(jaroWinkler("delta", "deloitte")).toBeLessThan(0.97);
    expect(jaroWinkler("square", "squarespace")).toBeLessThan(0.97);
    expect(jaroWinkler("stripe", "shopify")).toBeLessThan(0.97);
  });
});

describe("bestFuzzyMatch", () => {
  const candidates = [
    { id: "1", nameNorm: "cloudflare" },
    { id: "2", nameNorm: "databricks" },
    { id: "3", nameNorm: "snowflake" },
  ];

  it("adopts a near-identical name", () => {
    expect(bestFuzzyMatch("cloudflaer", candidates)?.id).toBe("1");
  });

  it("returns null when nothing clears the threshold", () => {
    expect(bestFuzzyMatch("stripe", candidates)).toBeNull();
  });

  it("refuses an ambiguous match rather than guessing", () => {
    const ambiguous = [
      { id: "a", nameNorm: "acme" },
      { id: "b", nameNorm: "acme" },
    ];
    expect(bestFuzzyMatch("acme", ambiguous)).toBeNull();
  });
});
