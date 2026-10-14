import { resolveAlias } from "./aliases.ts";

/**
 * Company-name normalisation.
 *
 * A CSV says `Acme Technologies Pvt. Ltd.` and a job board says `Acme`. Both
 * must reduce to the same key, or the user's contact there is invisible.
 *
 * The counter-pressure matters more than the merging: a *wrong* merge tells
 * someone they have a contact at a company where they don't, and one bad
 * referral ask costs more trust than ten missed matches. So this only removes
 * things that carry no identity — case, punctuation, incorporation suffixes —
 * and deliberately keeps words that distinguish real companies. `Acme Labs`
 * stays distinct from `Acme`; where a specific pair should merge, it goes in
 * `aliases.ts` where the decision is visible and reviewable.
 */

/**
 * Incorporation suffixes, as they appear after punctuation has been stripped.
 * Only stripped as whole trailing words, so `Citigroup` keeps its `group` while
 * `Adecco Group` loses it.
 *
 * Notably absent:
 *   - `spa` — real spas are named "… Spa" far more often than Italian S.p.A.
 *     entities appear in a connections export.
 *   - `as` — an ordinary English word.
 *   - `technologies`, `labs`, `solutions`, `systems` — not incorporation
 *     suffixes. Removing them merges genuinely different companies.
 */
const LEGAL_SUFFIXES: readonly string[] = [
  "incorporated",
  "inc",
  "llc",
  "ltd",
  "limited",
  "corporation",
  "corp",
  "company",
  "co",
  "gmbh",
  "ag",
  "bv",
  "nv",
  "plc",
  "se", // Societas Europaea: SAP SE, Airbus SE, Allianz SE.
  "pvt",
  "private",
  "pte",
  "llp",
  "lp",
  "sa",
  "sas",
  "srl",
  "ab",
  "oy",
  "bhd",
  "pty",
  "group",
  "holdings",
  "holding",
];

/** Strip a bracketed aside, but only when something is left outside it. */
function removeAsides(value: string): string {
  const stripped = value.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  return stripped.trim() === "" ? value : stripped;
}

/**
 * Drop a trailing tagline after a pipe: `Acme | Cloud Infrastructure`. Only the
 * pipe, because `/` and `-` appear inside real company names.
 */
function removeTagline(value: string): string {
  const [head] = value.split("|");
  if (head === undefined) return value;
  return head.trim() === "" ? value : head;
}

/**
 * Repeatedly remove trailing legal suffixes and the dangling conjunction they
 * can leave behind, so `Bain & Company` reduces to `bain` and
 * `Acme Systems Pvt Ltd` to `acme systems`.
 */
function stripLegalSuffixes(value: string): string {
  let out = value;

  for (let guard = 0; guard < 8; guard += 1) {
    const before = out;

    for (const suffix of LEGAL_SUFFIXES) {
      if (!out.endsWith(` ${suffix}`)) continue;
      const candidate = out.slice(0, out.length - suffix.length - 1).trim();
      // Never strip a company down to nothing: something named "The Co" keeps
      // the only word it has.
      if (candidate !== "") out = candidate;
      break;
    }

    if (out.endsWith(" and")) {
      const candidate = out.slice(0, -4).trim();
      if (candidate !== "") out = candidate;
    }

    if (out === before) break;
  }

  return out;
}

/**
 * Reduce a raw company string to a stable matching key.
 *
 * Idempotent: `normalizeCompanyName(normalizeCompanyName(x))` always equals
 * `normalizeCompanyName(x)`. Non-Latin scripts survive intact — a company
 * written in Devanagari normalises to itself rather than to an empty string.
 *
 * Returns `""` for input that contains nothing usable, which callers must treat
 * as "no company" rather than as a key.
 */
export function normalizeCompanyName(raw: string): string {
  let value = raw.trim();
  if (value === "") return "";

  value = removeTagline(value);
  value = removeAsides(value);

  // Apostrophes are deleted, not spaced: "Moody's" is one word, not two.
  value = value.replace(/['’ʼ]/g, "");
  // Periods likewise, so dotted acronyms survive: "L.L.C." -> "llc".
  value = value.replace(/\./g, "");
  value = value.replace(/&/g, " and ");

  value = value
    .normalize("NFKD")
    // Only marks with Script=Inherited — the Latin/Greek/Cyrillic combining
    // accents that decomposition just produced, so "Zürich" -> "zurich".
    // Deliberately not \p{M}: that also removes Indic vowel signs and Arabic
    // harakat, which carry meaning rather than decorating a base letter, and
    // stripping them would collapse genuinely different names onto one key.
    .replace(/\p{Script=Inherited}/gu, "")
    .toLowerCase()
    // Anything that isn't a letter or digit becomes a gap.
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();

  if (value === "") return "";

  const beforeSuffixes = value;
  value = stripLegalSuffixes(value);

  // "The Home Depot" and "Home Depot" are the same employer.
  if (value.startsWith("the ")) {
    const candidate = value.slice(4).trim();
    if (candidate !== "") value = candidate;
  }

  return value === "" ? beforeSuffixes : value;
}

/**
 * The key a company is stored and looked up under: normalised text, then the
 * alias table. This is what belongs in `Company.nameNorm`.
 */
export function canonicalCompanyName(raw: string): string {
  const normalized = normalizeCompanyName(raw);
  return normalized === "" ? "" : resolveAlias(normalized);
}

/**
 * A company name fit to show a person. Keeps the user's own capitalisation and
 * punctuation — they recognise "Acme, Inc." from their export, not "acme" — and
 * only tidies whitespace.
 */
export function displayCompanyName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
