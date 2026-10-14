/**
 * The shape every ATS adapter conforms to.
 *
 * Five providers, five different JSON dialects: Lever calls the title `text`,
 * SmartRecruiters calls it `name`, and only two of them tell you whether a role
 * is remote. Everything downstream — caching, filtering, ranking — works on
 * `NormalizedJob` and never sees a provider's own vocabulary.
 *
 * Every field here was verified against a live board (see *.live.test.ts), not
 * from documentation.
 */

export const ATS_PROVIDERS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
] as const;

export type AtsProvider = (typeof ATS_PROVIDERS)[number];

export function isAtsProvider(value: unknown): value is AtsProvider {
  return (
    typeof value === "string" && (ATS_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * One open role, in the app's own vocabulary. Maps 1:1 onto the JobPosting
 * model minus the fields the database owns (`id`, `companyId`, `fetchedAt`).
 */
export type NormalizedJob = {
  source: AtsProvider;

  /**
   * `{token}:{provider's own id}`.
   *
   * The token prefix is not decoration. JobPosting is unique on
   * `[source, externalId]`, so if two boards on the same provider ever issued
   * the same posting id, one company's role would silently overwrite the
   * other's — a job the user should have seen would just be missing. Scoping by
   * token makes that impossible rather than unlikely.
   */
  externalId: string;

  title: string;
  location: string | null;
  remote: boolean;
  department: string | null;

  /** Human-facing posting page, never an API URL. */
  url: string;

  postedAt: Date | null;
};

/**
 * Why a board fetch failed. The distinction between `not_found` and everything
 * else is load-bearing: `not_found` means this token is genuinely not a board
 * on this provider and may be cached as a negative, while a timeout or a 500
 * means we learned nothing and must not be written down as an answer.
 */
export type AtsErrorKind =
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "bad_response"
  | "bad_token";

export class AtsError extends Error {
  override name = "AtsError";
  readonly kind: AtsErrorKind;
  readonly status?: number;

  constructor(kind: AtsErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }

  /** True when the outcome is a fact about the token rather than the network. */
  get isConclusive(): boolean {
    return this.kind === "not_found" || this.kind === "bad_token";
  }
}

export type FetchJobsOptions = {
  signal?: AbortSignal;
};

export type AtsAdapter = {
  provider: AtsProvider;

  /** Human-readable, used in UI copy such as "hiring through Greenhouse". */
  label: string;

  /**
   * Whether HTTP 200 with zero postings proves the token exists.
   *
   * True for four of the five providers, which 404 on an unknown board.
   * SmartRecruiters instead answers `{"totalFound":0,"content":[]}` for any
   * string at all — byte-identical to a real company between hiring rounds —
   * so on that provider only a non-empty board is evidence of anything, and the
   * slug probe must never record a negative from it.
   */
  emptyBoardProvesToken: boolean;

  /** The board a human can open. */
  boardUrl(token: string): string;

  /**
   * Extract a board token from a URL the user pasted, or null if the URL does
   * not belong to this provider.
   */
  parseBoardUrl(url: URL): string | null;

  fetchJobs(token: string, options?: FetchJobsOptions): Promise<NormalizedJob[]>;
};

/**
 * Tokens are interpolated straight into a URL path, so they are validated
 * first. Deliberately case-sensitive-agnostic in the pattern but never
 * lower-cased by callers: SmartRecruiters tokens are CamelCase
 * (`PublicisGroupe`) and 404 if you fold the case.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function assertValidToken(token: string): void {
  if (!TOKEN_PATTERN.test(token)) {
    throw new AtsError("bad_token", `Not a usable board token: "${token}"`);
  }
}

export function isValidToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** Trim to null, so "" and "   " never reach the database as a location. */
export function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse whatever a provider calls a date. Handles ISO strings, `YYYY-MM-DD`,
 * and epoch milliseconds (Lever), and returns null rather than an Invalid Date
 * — a bad timestamp should cost the posting its recency score, not exclude it.
 */
export function dateOrNull(value: unknown): Date | null {
  if (value == null) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const fromEpoch = new Date(value);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Last-resort remote detection, for the providers that ship no flag.
 *
 * Word-bounded on purpose: a substring test matches "Remote" inside
 * "Remotely-operated Vehicle Technician" and, worse, inside place names.
 */
const REMOTE_PATTERN = /\b(remote|work from home|wfh|anywhere|distributed)\b/i;

export function looksRemote(...values: (string | null | undefined)[]): boolean {
  return values.some((value) => (value ? REMOTE_PATTERN.test(value) : false));
}

/**
 * Map a provider's array into `NormalizedJob`s, dropping items that cannot be
 * read and collapsing duplicate `externalId`s.
 *
 * One posting with a missing title must not cost the user the other 582 — but a
 * provider quietly changing its field names would look exactly like a board full
 * of malformed postings, so skips are counted and reported rather than swallowed.
 *
 * Dedup is not defensive tidiness: a board can list one posting twice (Workable
 * cross-posts a job across departments), and `JobPosting` is unique on
 * `[source, externalId]`, so a later upsert of the twin would clobber the first.
 * Collapsing here keeps adapter output honest to the DB's own uniqueness.
 */
export function collectJobs<T>(
  label: string,
  items: readonly T[],
  map: (item: T) => NormalizedJob | null,
): NormalizedJob[] {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let duplicates = 0;

  for (const item of items) {
    let job: NormalizedJob | null = null;
    try {
      job = map(item);
    } catch {
      job = null;
    }
    if (!job) {
      skipped++;
      continue;
    }
    if (seen.has(job.externalId)) {
      duplicates++;
      continue;
    }
    seen.add(job.externalId);
    jobs.push(job);
  }

  if (skipped > 0) {
    console.warn(
      `[ats] ${label}: skipped ${skipped} of ${items.length} postings it could not read`,
    );
  }
  if (duplicates > 0) {
    console.warn(`[ats] ${label}: collapsed ${duplicates} duplicate postings`);
  }

  return jobs;
}

/**
 * Join the pieces a provider gives us into one location string. Accepts
 * `unknown` because providers hand back raw JSON fields; each part is run
 * through {@link textOrNull}, so anything non-string is simply dropped.
 */
export function joinLocation(...parts: unknown[]): string | null {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const part of parts) {
    const text = textOrNull(part);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(text);
  }

  return kept.length > 0 ? kept.join(", ") : null;
}
