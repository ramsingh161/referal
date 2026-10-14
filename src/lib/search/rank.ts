import { looksRemote } from "@/lib/ats/types";
import type { JobPreferences, Seniority } from "@/lib/prefs";

/**
 * Filtering and ranking: which open roles a user should see, and in what order.
 *
 * Everything here is pure. It takes plain objects (a `JobPosting` row and the
 * user's `Connection` rows both satisfy the input types structurally) and
 * returns numbers, so the whole policy is testable without a database or a
 * network — see rank.test.ts.
 *
 * The one idea the score encodes: **who you know dominates**. An ordinary job
 * board can already tell you a role is open. The only thing this app knows that
 * they don't is that you have a named contact there who could put your CV in
 * front of a human, so that signal carries more weight than every other
 * component combined.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** What ranking needs from a connection. A `Connection` row satisfies this. */
export type RankConnection = {
  /** The contact's own job title, from the export. Null when the CSV had none. */
  position: string | null;
};

/** What ranking needs from a role. `JobPosting` and `NormalizedJob` both satisfy this. */
export type RankJob = {
  title: string;
  location: string | null;
  remote: boolean;
  department: string | null;
  postedAt: Date | null;
};

export type ScoreBreakdown = {
  /** Weighted sum of the components below, 0-100, rounded to 2dp. */
  total: number;
  /** Each component is 0-1 before weighting, so they can be compared directly. */
  connectionStrength: number;
  titleRelevance: number;
  seniorityFit: number;
  locationFit: number;
  recency: number;
};

/**
 * Component weights, summing to 100.
 *
 * `connectionStrength` is deliberately larger than everything else put
 * together. A perfectly-matching role with one contact can still beat a poorly
 * matching role with three -- which is right, since the preference filter has
 * already discarded roles the user said they don't want -- but no combination of
 * the softer signals can overturn a real difference in who you know.
 */
export const WEIGHTS = {
  connectionStrength: 55,
  titleRelevance: 18,
  seniorityFit: 12,
  locationFit: 8,
  recency: 7,
} as const;

/** Used for a component the user has expressed no opinion about. */
const NEUTRAL = 0.5;

// ---------------------------------------------------------------------------
// Text matching
//
// One shared representation: lowercased, every non-alphanumeric run collapsed
// to a single space, and padded with a space at each end. Testing for
// ` ${phrase} ` inside it is then a word-bounded phrase match, with no regex
// construction (and so no escaping bugs) at the call site.
// ---------------------------------------------------------------------------

function searchable(value: string | null | undefined): string {
  if (!value) return " ";
  return ` ${value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const needle = searchable(phrase);
  return needle.trim() !== "" && haystack.includes(needle);
}

function containsAny(haystack: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsPhrase(haystack, phrase));
}

// ---------------------------------------------------------------------------
// Seniority
// ---------------------------------------------------------------------------

/**
 * Phrases that contain a seniority word but do not describe seniority.
 * "Lead Generation Specialist" is not a lead. Removed from the title before
 * inference rather than used to veto a level, so that "Lead Generation Manager"
 * still reads as a manager.
 */
const FALSE_SENIORITY_PHRASES: readonly string[] = [
  "lead generation",
  "lead gen",
  "demand generation",
];

/**
 * Checked in order, most senior first, so "Senior Director" is a director and
 * "Senior Staff Engineer" is staff. The first level whose phrases appear wins.
 */
const SENIORITY_PATTERNS: readonly { level: Seniority; phrases: readonly string[] }[] = [
  {
    level: "internship",
    phrases: [
      "intern",
      "interns",
      "internship",
      "trainee",
      "co op",
      "apprentice",
      "apprenticeship",
      "working student",
      "student worker",
      "placement",
      "praktikum",
    ],
  },
  {
    level: "executive",
    phrases: [
      "chief",
      "ceo",
      "cto",
      "cfo",
      "coo",
      "cmo",
      "cio",
      "ciso",
      "chro",
      "cpo",
      "president",
      "vice president",
      "vp",
      "svp",
      "evp",
      "managing director",
    ],
  },
  { level: "director", phrases: ["director", "head"] },
  { level: "staff", phrases: ["staff", "principal", "distinguished", "fellow"] },
  { level: "lead", phrases: ["lead", "leader", "manager", "mgr", "supervisor"] },
  { level: "senior", phrases: ["senior", "sr", "snr"] },
  {
    level: "entry",
    phrases: [
      "junior",
      "jr",
      "entry level",
      "entry",
      "graduate",
      "grad",
      "new grad",
      "associate",
    ],
  },
];

/**
 * Read a seniority level off a job title, or null when the title carries no
 * signal at all ("Software Engineer").
 *
 * Null is a real answer, not a failure: the filter keeps unknown-level roles
 * rather than dropping them on a guess, because a role posted without a level
 * word is exactly as likely to be the one the user wants as not.
 */
export function inferSeniority(title: string): Seniority | null {
  let haystack = searchable(title);

  for (const phrase of FALSE_SENIORITY_PHRASES) {
    const padded = searchable(phrase);
    while (haystack.includes(padded)) haystack = haystack.replace(padded, " ");
  }

  for (const { level, phrases } of SENIORITY_PATTERNS) {
    if (containsAny(haystack, phrases)) return level;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Preference filtering
// ---------------------------------------------------------------------------

/** Remote per the provider's own flag, or per a location that says so. */
export function isRemoteJob(job: RankJob): boolean {
  return job.remote || looksRemote(job.location);
}

/**
 * Does this role survive the user's filters?
 *
 * Each rule only bites when the user actually set it, and every ambiguous case
 * is kept rather than dropped -- showing one role too many costs a glance,
 * while dropping the right one costs the whole point of the product.
 */
export function matchesPreferences(job: RankJob, preferences: JobPreferences): boolean {
  if (preferences.remoteOnly && !isRemoteJob(job)) return false;

  if (
    preferences.titleKeywords.length > 0 &&
    !containsAny(searchable(job.title), preferences.titleKeywords)
  ) {
    return false;
  }

  // A remote role passes any location filter: it is available wherever the user
  // happens to be, which is the point of it being remote.
  if (
    preferences.locations.length > 0 &&
    !isRemoteJob(job) &&
    !containsAny(searchable(job.location), preferences.locations)
  ) {
    return false;
  }

  if (preferences.seniority.length > 0) {
    const level = inferSeniority(job.title);
    if (level !== null && !preferences.seniority.includes(level)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Connection strength -- the component that matters
// ---------------------------------------------------------------------------

/**
 * Titles that mean this contact can act on a referral rather than just pass it
 * along. Checked in order; the first group that matches sets the base power.
 */
const RECRUITING_TITLES: readonly string[] = [
  "recruiter",
  "recruiting",
  "recruitment",
  "talent acquisition",
  "talent partner",
  "sourcer",
  "hiring",
];

const LEADERSHIP_TITLES: readonly string[] = [
  "chief",
  "ceo",
  "cto",
  "cfo",
  "coo",
  "founder",
  "co founder",
  "president",
  "vp",
  "svp",
  "evp",
  "head",
  "director",
];

const MANAGEMENT_TITLES: readonly string[] = [
  "manager",
  "mgr",
  "lead",
  "principal",
  "staff",
  "supervisor",
  "architect",
];

/** Anyone at the company can submit a referral, so the floor is not zero. */
const ANY_CONTACT_POWER = 0.25;

/** Added when the contact works in the same discipline as the role. */
const DISCIPLINE_BONUS = 0.25;

/**
 * Words that appear in job titles everywhere and so prove nothing about which
 * discipline someone works in.
 */
const DISCIPLINE_STOP_TOKENS: ReadonlySet<string> = new Set([
  "senior",
  "junior",
  "staff",
  "principal",
  "lead",
  "head",
  "chief",
  "director",
  "manager",
  "associate",
  "assistant",
  "intern",
  "executive",
  "president",
  "vice",
  "global",
  "team",
  "department",
  "group",
  "remote",
  "hybrid",
  "onsite",
  "full",
  "time",
  "part",
  "contract",
  "level",
  "grade",
  "with",
  "and",
  "the",
  "for",
]);

function meaningfulTokens(padded: string): string[] {
  const out: string[] = [];
  for (const token of padded.trim().split(" ")) {
    if (token.length < 4) continue;
    if (DISCIPLINE_STOP_TOKENS.has(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * Crude stemming by prefix, which is enough to align the pairs that actually
 * occur: engineer/engineering, design/designer, market/marketing. The 5-char
 * floor keeps short prefixes from swallowing unrelated words.
 */
function tokensAlign(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short);
}

/**
 * Does this contact work in the role's discipline?
 *
 * Compared against the job's department when there is one, and its title
 * otherwise. The fallback is not a nicety: Greenhouse never supplies a
 * department (see NOTES-ATS.md), and it is the most common provider, so a
 * department-only rule would be dead weight for most matches.
 */
function sharesDiscipline(position: string, job: RankJob): boolean {
  const theirs = meaningfulTokens(position);
  if (theirs.length === 0) return false;

  const ours = meaningfulTokens(searchable(job.department ?? job.title));
  return theirs.some((a) => ours.some((b) => tokensAlign(a, b)));
}

/**
 * How well-placed one contact is to refer someone into this role, 0-1.
 *
 * Exported because the results UI asks the same question when it suggests who
 * to approach -- the person shown should be the person the score credited.
 */
export function referrerPower(connection: RankConnection, job: RankJob): number {
  const position = searchable(connection.position);

  let power = ANY_CONTACT_POWER;
  if (containsAny(position, RECRUITING_TITLES)) power = 1;
  else if (containsAny(position, LEADERSHIP_TITLES)) power = 0.8;
  else if (containsAny(position, MANAGEMENT_TITLES)) power = 0.6;

  if (sharesDiscipline(position, job)) power = Math.min(1, power + DISCIPLINE_BONUS);

  return power;
}

/** The contact most worth asking about this role, or null if there are none. */
export function bestReferrer<T extends RankConnection>(
  connections: readonly T[],
  job: RankJob,
): T | null {
  let best: T | null = null;
  let bestPower = -1;

  for (const connection of connections) {
    const power = referrerPower(connection, job);
    if (power > bestPower) {
      best = connection;
      bestPower = power;
    }
  }

  return best;
}

/**
 * Where extra contacts stop helping. The eighth person you know somewhere is
 * not meaningfully more useful than the seventh, so the count is log-scaled and
 * saturates here.
 */
const CONNECTION_COUNT_CAP = 8;

function countScore(count: number): number {
  if (count <= 0) return 0;
  return Math.min(1, Math.log2(1 + count) / Math.log2(1 + CONNECTION_COUNT_CAP));
}

function connectionStrength(connections: readonly RankConnection[], job: RankJob): number {
  if (connections.length === 0) return 0;

  const best = connections.reduce(
    (max, connection) => Math.max(max, referrerPower(connection, job)),
    0,
  );

  // How many people you know, and how useful the most useful one is. Both
  // matter; neither alone is the answer.
  return 0.7 * countScore(connections.length) + 0.3 * best;
}

// ---------------------------------------------------------------------------
// Softer components
// ---------------------------------------------------------------------------

function titleRelevance(job: RankJob, preferences: JobPreferences): number {
  const keywords = preferences.titleKeywords;
  if (keywords.length === 0) return NEUTRAL;

  const haystack = searchable(job.title);
  const matched = keywords.filter((keyword) => containsPhrase(haystack, keyword)).length;
  if (matched === 0) return 0;

  // Matching one of three interests is a hit, not a third of a hit -- so most of
  // the credit is for matching at all, and breadth only tops it up.
  return 0.7 + 0.3 * (matched / keywords.length);
}

function seniorityFit(job: RankJob, preferences: JobPreferences): number {
  if (preferences.seniority.length === 0) return NEUTRAL;

  const level = inferSeniority(job.title);
  if (level === null) return NEUTRAL;
  return preferences.seniority.includes(level) ? 1 : 0;
}

/** A remote role is a good-but-not-exact answer to "I want to work in X". */
const REMOTE_LOCATION_FIT = 0.75;

function locationFit(job: RankJob, preferences: JobPreferences): number {
  if (preferences.locations.length === 0) return NEUTRAL;
  if (containsAny(searchable(job.location), preferences.locations)) return 1;
  return isRemoteJob(job) ? REMOTE_LOCATION_FIT : 0;
}

export const RECENCY_HALF_LIFE_DAYS = 30;

/**
 * All five providers expose a posting date, so a null here means the posting's
 * own timestamp was unreadable rather than absent. It costs the role most of
 * the recency weight without pretending to know it is stale.
 */
const RECENCY_WHEN_UNDATED = 0.35;

const DAY_MS = 24 * 60 * 60 * 1000;

function recency(job: RankJob, now: number): number {
  if (!job.postedAt) return RECENCY_WHEN_UNDATED;

  const ageDays = (now - job.postedAt.getTime()) / DAY_MS;
  if (ageDays <= 0) return 1; // posted now or clock skew; treat as brand new
  return Math.pow(2, -ageDays / RECENCY_HALF_LIFE_DAYS);
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

/**
 * Score one role for one user, given every connection they have at that
 * company.
 *
 * Assumes the role already passed {@link matchesPreferences}; scoring a
 * filtered-out role is harmless but meaningless.
 */
export function scoreJob(
  job: RankJob,
  connections: readonly RankConnection[],
  preferences: JobPreferences,
  now: number = Date.now(),
): ScoreBreakdown {
  const components = {
    connectionStrength: connectionStrength(connections, job),
    titleRelevance: titleRelevance(job, preferences),
    seniorityFit: seniorityFit(job, preferences),
    locationFit: locationFit(job, preferences),
    recency: recency(job, now),
  };

  const total =
    components.connectionStrength * WEIGHTS.connectionStrength +
    components.titleRelevance * WEIGHTS.titleRelevance +
    components.seniorityFit * WEIGHTS.seniorityFit +
    components.locationFit * WEIGHTS.locationFit +
    components.recency * WEIGHTS.recency;

  return { ...components, total: Math.round(total * 100) / 100 };
}
