import { describe, expect, it } from "vitest";

import { COMPANY_ALIASES, resolveAlias } from "./aliases.ts";
import {
  canonicalCompanyName,
  displayCompanyName,
  normalizeCompanyName,
} from "./normalize.ts";

describe("normalizeCompanyName", () => {
  it("folds case, punctuation and whitespace", () => {
    expect(normalizeCompanyName("Stripe")).toBe("stripe");
    expect(normalizeCompanyName("  STRIPE  ")).toBe("stripe");
    expect(normalizeCompanyName("Acme,  Inc.")).toBe("acme");
    expect(normalizeCompanyName("Acme Corp")).toBe("acme");
    expect(normalizeCompanyName("acme-widgets")).toBe("acme widgets");
  });

  it("strips diacritics", () => {
    expect(normalizeCompanyName("Zürich Insurance")).toBe("zurich insurance");
    expect(normalizeCompanyName("Nestlé")).toBe("nestle");
    expect(normalizeCompanyName("Société Générale")).toBe("societe generale");
  });

  it("strips incorporation suffixes, including several at once", () => {
    expect(normalizeCompanyName("Acme Inc")).toBe("acme");
    expect(normalizeCompanyName("Acme Ltd.")).toBe("acme");
    expect(normalizeCompanyName("Acme Pvt. Ltd.")).toBe("acme");
    expect(normalizeCompanyName("Acme Technologies Pvt Ltd")).toBe("acme technologies");
    expect(normalizeCompanyName("Acme GmbH")).toBe("acme");
    expect(normalizeCompanyName("Acme Holdings Limited")).toBe("acme");
  });

  it("drops the conjunction a stripped suffix leaves behind", () => {
    expect(normalizeCompanyName("Bain & Company")).toBe("bain");
    expect(normalizeCompanyName("Booz Allen Hamilton Inc.")).toBe("booz allen hamilton");
  });

  it("expands an ampersand into a word so both spellings agree", () => {
    expect(normalizeCompanyName("Johnson & Johnson")).toBe("johnson and johnson");
    expect(normalizeCompanyName("Johnson and Johnson")).toBe("johnson and johnson");
    expect(normalizeCompanyName("H&M")).toBe("h and m");
  });

  it("treats an apostrophe as part of the word, not a break", () => {
    expect(normalizeCompanyName("Moody's")).toBe("moodys");
    expect(normalizeCompanyName("Moody’s Analytics")).toBe("moodys analytics");
    expect(normalizeCompanyName("Macy's Inc.")).toBe("macys");
  });

  it("drops a leading article", () => {
    expect(normalizeCompanyName("The Home Depot")).toBe("home depot");
    expect(normalizeCompanyName("Home Depot")).toBe("home depot");
    // Only leading, and only as a whole word.
    expect(normalizeCompanyName("Theta Labs")).toBe("theta labs");
  });

  it("removes parenthetical asides and pipe taglines", () => {
    expect(normalizeCompanyName("Acme (formerly Widgets Co)")).toBe("acme");
    expect(normalizeCompanyName("Acme [Contract]")).toBe("acme");
    expect(normalizeCompanyName("Acme | Cloud Infrastructure")).toBe("acme");
  });

  it("keeps a name that is nothing but an aside or suffix", () => {
    // Reducing these to "" would silently discard the connection's company.
    expect(normalizeCompanyName("(Stealth)")).toBe("stealth");
    expect(normalizeCompanyName("The Co")).not.toBe("");
    expect(normalizeCompanyName("Group")).toBe("group");
    expect(normalizeCompanyName("| Acme")).toBe("acme");
  });

  it("returns empty only when there is nothing usable", () => {
    expect(normalizeCompanyName("")).toBe("");
    expect(normalizeCompanyName("   ")).toBe("");
    expect(normalizeCompanyName("--")).toBe("");
    expect(normalizeCompanyName("...")).toBe("");
  });

  it("preserves non-Latin scripts rather than emptying them", () => {
    expect(normalizeCompanyName("株式会社ソニー")).toBe("株式会社ソニー");
    expect(normalizeCompanyName("Яндекс")).toBe("яндекс");
    expect(normalizeCompanyName("इंफोसिस")).toBe("इंफोसिस");
  });

  it("is idempotent", () => {
    const samples = [
      "Acme, Inc.",
      "The Home Depot",
      "Bain & Company",
      "Zürich Insurance AG",
      "Acme (formerly Widgets Co)",
      "Moody's",
      "株式会社ソニー",
      "",
    ];

    for (const sample of samples) {
      const once = normalizeCompanyName(sample);
      expect(normalizeCompanyName(once)).toBe(once);
    }
  });

  it("does not merge companies that are genuinely different", () => {
    // Each pair below is two real, separate employers. Merging any of them
    // would claim a contact the user does not have.
    const distinct: [string, string][] = [
      ["Acme", "Acme Labs"],
      ["Acme", "Acme Health"],
      ["Apple", "Apple Bank"],
      ["Alphabet Solutions", "Alphabet Systems"],
      ["Delta Air Lines", "Delta Dental"],
      ["Nordstrom", "Nordstrom Rack"],
      ["Oracle", "Oracle Red Bull Racing"],
      ["Stripe", "Stripes"],
      ["Meta", "Metabase"],
      ["Square Enix", "Square"],
      ["General Motors", "General Mills"],
      ["First Republic Bank", "Republic Bank"],
    ];

    for (const [left, right] of distinct) {
      expect(normalizeCompanyName(left)).not.toBe(normalizeCompanyName(right));
    }
  });

  it("merges spellings of one employer", () => {
    const same: [string, string][] = [
      ["Stripe", "Stripe, Inc."],
      ["Acme Technologies Pvt. Ltd.", "Acme Technologies"],
      ["The Home Depot", "Home Depot Inc"],
      ["Ernst & Young", "Ernst and Young"],
      ["Zürich Insurance", "Zurich Insurance"],
      ["Moody's", "Moodys"],
      ["Deloitte LLP", "Deloitte"],
      ["Infosys Limited", "Infosys"],
      ["SAP SE", "SAP"],
    ];

    for (const [left, right] of same) {
      expect(normalizeCompanyName(left)).toBe(normalizeCompanyName(right));
    }
  });

  it("keeps a suffix word that is part of the name", () => {
    // "Group" and "Holdings" are only suffixes as separate trailing words.
    expect(normalizeCompanyName("Group Nine Media")).toBe("group nine media");
    expect(normalizeCompanyName("Citigroup")).toBe("citigroup");
    expect(normalizeCompanyName("Corporate Travel Management")).toBe(
      "corporate travel management",
    );
  });
});

describe("resolveAlias", () => {
  it("maps known variants onto one canonical name", () => {
    expect(resolveAlias("alphabet")).toBe("google");
    expect(resolveAlias("facebook")).toBe("meta");
    expect(resolveAlias("aws")).toBe("amazon");
    expect(resolveAlias("tcs")).toBe("tata consultancy services");
  });

  it("passes unknown names through untouched", () => {
    expect(resolveAlias("stripe")).toBe("stripe");
    expect(resolveAlias("")).toBe("");
  });

  it("has keys and values that are already normalised", () => {
    // If an entry were not normalised, no real lookup could ever hit it.
    for (const [key, value] of Object.entries(COMPANY_ALIASES)) {
      expect(normalizeCompanyName(key), `alias key "${key}"`).toBe(key);
      expect(normalizeCompanyName(value), `alias value "${value}"`).toBe(value);
    }
  });

  it("resolves in a single step, with no chains or cycles", () => {
    for (const [key, value] of Object.entries(COMPANY_ALIASES)) {
      expect(value, `alias "${key}" points at itself`).not.toBe(key);
      expect(
        Object.hasOwn(COMPANY_ALIASES, value),
        `alias "${key}" -> "${value}", but "${value}" is itself an alias key`,
      ).toBe(false);
    }
  });
});

describe("canonicalCompanyName", () => {
  it("normalises and then resolves the alias", () => {
    expect(canonicalCompanyName("Alphabet Inc.")).toBe("google");
    expect(canonicalCompanyName("Amazon Web Services")).toBe("amazon");
    expect(canonicalCompanyName("AWS")).toBe("amazon");
    expect(canonicalCompanyName("Meta Platforms, Inc.")).toBe("meta");
    expect(canonicalCompanyName("Salesforce.com")).toBe("salesforce");
    expect(canonicalCompanyName("P&G")).toBe("procter and gamble");
  });

  it("leaves a company with no alias as its normalised form", () => {
    expect(canonicalCompanyName("Stripe, Inc.")).toBe("stripe");
  });

  it("catches variants that survive normalisation intact", () => {
    // "Citigroup" has no word boundary before "group", so normalisation leaves
    // it alone and the alias table is what merges it with Citi.
    expect(canonicalCompanyName("Citigroup")).toBe("citi");
    expect(canonicalCompanyName("Citibank")).toBe("citi");
    expect(canonicalCompanyName("Uber Technologies")).toBe("uber");
    expect(canonicalCompanyName("HCLTech")).toBe("hcl technologies");
  });

  it("returns empty for input with no company in it", () => {
    expect(canonicalCompanyName("")).toBe("");
    expect(canonicalCompanyName("   ")).toBe("");
  });

  it("is idempotent", () => {
    for (const sample of ["Alphabet Inc.", "AWS", "Stripe", "P&G"]) {
      const once = canonicalCompanyName(sample);
      expect(canonicalCompanyName(once)).toBe(once);
    }
  });
});

describe("displayCompanyName", () => {
  it("keeps the user's own spelling and only tidies whitespace", () => {
    expect(displayCompanyName("Acme, Inc.")).toBe("Acme, Inc.");
    expect(displayCompanyName("  Acme,   Inc.  ")).toBe("Acme, Inc.");
    expect(displayCompanyName("Acme\nInc")).toBe("Acme Inc");
  });
});
