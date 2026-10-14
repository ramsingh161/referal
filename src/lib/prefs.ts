import { z } from "zod";

/**
 * What the user is looking for. Stored as JSON in `User.prefsJson` rather than
 * columns, because these are filter knobs that will change shape as the product
 * learns what matters — and a migration per knob is not worth it.
 *
 * Every field is optional in spirit: an empty preference set means "show me
 * everything", which is the honest default for someone who has just signed up
 * and does not yet know what the app will find.
 */

export const SENIORITY_LEVELS = [
  "internship",
  "entry",
  "mid",
  "senior",
  "staff",
  "lead",
  "director",
  "executive",
] as const;

export type Seniority = (typeof SENIORITY_LEVELS)[number];

/** Labels for the UI. Kept beside the values so they cannot drift apart. */
export const SENIORITY_LABELS: Readonly<Record<Seniority, string>> = {
  internship: "Internship",
  entry: "Entry level",
  mid: "Mid level",
  senior: "Senior",
  staff: "Staff / Principal",
  lead: "Lead",
  director: "Director",
  executive: "Executive",
};

const trimmedList = (max: number) =>
  z
    .array(z.string())
    .default([])
    .transform((values) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const value of values) {
        const trimmed = value.trim();
        if (trimmed === "") continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
      }
      return out.slice(0, max);
    });

export const jobPreferencesSchema = z.object({
  /** Words that should appear in a role title: "backend", "data", "design". */
  titleKeywords: trimmedList(20),
  /** Free-text places, matched loosely against a posting's location. */
  locations: trimmedList(20),
  seniority: z.array(z.enum(SENIORITY_LEVELS)).default([]),
  remoteOnly: z.boolean().default(false),
});

export type JobPreferences = z.infer<typeof jobPreferencesSchema>;

/** Match everything. What a brand-new account gets. */
export const DEFAULT_PREFERENCES: JobPreferences = {
  titleKeywords: [],
  locations: [],
  seniority: [],
  remoteOnly: false,
};

/**
 * Read `User.prefsJson`. Falls back to the permissive default on anything
 * unreadable — stale or corrupt preferences should never block a search, and
 * showing too many roles is a far smaller failure than showing none.
 */
export function parsePreferences(prefsJson: string | null | undefined): JobPreferences {
  if (!prefsJson) return DEFAULT_PREFERENCES;

  try {
    const result = jobPreferencesSchema.safeParse(JSON.parse(prefsJson));
    return result.success ? result.data : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function serializePreferences(preferences: JobPreferences): string {
  return JSON.stringify(preferences);
}

/** True when the user has narrowed anything at all. */
export function hasAnyPreference(preferences: JobPreferences): boolean {
  return (
    preferences.titleKeywords.length > 0 ||
    preferences.locations.length > 0 ||
    preferences.seniority.length > 0 ||
    preferences.remoteOnly
  );
}

/**
 * Split a comma-or-newline separated text input into a list. Used by the
 * preferences form, where typing "backend, platform, infra" is faster than
 * managing chips.
 */
export function splitKeywordInput(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}
