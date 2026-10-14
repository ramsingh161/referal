/**
 * Known variants that text normalisation alone cannot reconcile.
 *
 * `normalize.ts` handles mechanical differences — case, punctuation, legal
 * suffixes. This file handles the ones that need knowledge: that Alphabet hires
 * as Google, that AWS postings live on Amazon's board, that TCS is Tata
 * Consultancy Services.
 *
 * Two rules keep this table safe, both enforced by `aliases.test.ts`:
 *
 *   1. Every key and every value must already be in normalised form, so a
 *      lookup after `normalizeCompanyName` always hits.
 *   2. No value may also be a key. Aliases resolve in one step, never a chain,
 *      so the table cannot develop a cycle or a surprising two-hop merge.
 *
 * Entries are added only where the merge is unambiguous. A wrong entry here
 * tells a user they know someone at a company where they don't, which is the
 * one failure that would make the product untrustworthy — so when in doubt the
 * entry is left out and the two companies stay separate.
 */
export const COMPANY_ALIASES: Readonly<Record<string, string>> = {
  // Parent and operating names.
  alphabet: "google",
  "meta platforms": "meta",
  facebook: "meta",
  x: "twitter", // Canonical side is "twitter": a one-letter key is too weak to
  // be a stable registry key, and the display name is set separately.
  aws: "amazon",
  "amazon web services": "amazon",
  square: "block",
  "uber technologies": "uber",
  "coinbase global": "coinbase",
  "walmart labs": "walmart",
  "walmart global tech": "walmart",
  "dell technologies": "dell",
  "adobe systems": "adobe",
  "samsung electronics": "samsung",
  "lg electronics": "lg",
  "robert bosch": "bosch",
  "general electric": "ge",
  "advanced micro devices": "amd",
  "international business machines": "ibm",
  "snowflake computing": "snowflake",
  elasticsearch: "elastic",
  "10gen": "mongodb",
  freshdesk: "freshworks",
  "cognizant technology solutions": "cognizant",
  "one97 communications": "paytm",
  hcltech: "hcl technologies",

  // Periods are deleted rather than spaced during normalisation, which handles
  // dotted acronyms (L.L.C. -> llc) but fuses dot-com names.
  salesforcecom: "salesforce",
  bookingcom: "booking",

  // Initialisms in common use.
  tcs: "tata consultancy services",
  ey: "ernst and young",
  pwc: "pricewaterhousecoopers",
  bcg: "boston consulting",
  amex: "american express",
  bofa: "bank of america",
  goldman: "goldman sachs",
  jpmorgan: "jpmorgan chase",
  "jp morgan": "jpmorgan chase",
  chase: "jpmorgan chase",
  citigroup: "citi",
  citibank: "citi",

  // Ampersands normalise to " and ", so "P&G" arrives here as "p and g".
  "p and g": "procter and gamble",
  "j and j": "johnson and johnson",
};

/**
 * Map a normalised company name onto its canonical form.
 *
 * Expects input that has already been through `normalizeCompanyName`. Unknown
 * names pass through unchanged — the absence of an alias is the common case,
 * not an error.
 */
export function resolveAlias(nameNorm: string): string {
  return COMPANY_ALIASES[nameNorm] ?? nameNorm;
}
