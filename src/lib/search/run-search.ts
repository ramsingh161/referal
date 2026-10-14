import pLimit from "p-limit";

import type { Company } from "@/generated/prisma/client";
import { fetchJobs } from "@/lib/ats";
import { AtsError, isAtsProvider, type AtsProvider, type NormalizedJob } from "@/lib/ats/types";
import { displayCompanyName } from "@/lib/company/normalize";
import { resolveCompanies } from "@/lib/company/resolve";
import { assertUserId, prisma } from "@/lib/db";
import { parsePreferences, type JobPreferences } from "@/lib/prefs";

import { matchesPreferences, scoreJob } from "./rank";

/**
 * The search run: from "people I know" to "roles I should ask about".
 *
 *   connections -> distinct companies -> resolve to ATS boards -> fetch open
 *   roles (cached) -> filter by preferences -> rank -> Match rows
 *
 * Two properties shape the whole file:
 *
 *  1. **It is slow and visible.** Hundreds of companies, each possibly a network
 *     round trip. So the work is done in chunks and the SearchRun counters are
 *     flushed after each one, because the user is watching a progress line the
 *     entire time. Nothing here may block on the full set before reporting.
 *
 *  2. **One bad company must not cost the user the other 200.** Every per-company
 *     failure is caught, recorded on the run, and stepped over. Only a failure
 *     that makes the whole run meaningless marks it failed.
 */

/** How long a company's fetched job list is trusted before re-fetching. */
const JOB_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Companies resolved and fetched per progress flush. */
const COMPANY_CHUNK = 20;

/** Never fan out over a whole network at once (see NOTES-ATS.md, DNS note). */
const FETCH_CONCURRENCY = 5;

/**
 * A run that has not finished by now is abandoned. Without this a single
 * wedged connection would leave the row "running" forever and the client
 * polling forever.
 */
export const RUN_DEADLINE_MS = 10 * 60 * 1000;

/** Enough detail to explain a partial result; not an unbounded error log. */
const MAX_RECORDED_ERRORS = 50;

/**
 * Rows per `createMany`. SQLite allows 999 bound variables per statement and
 * JobPosting binds ~11 per row, so this stays well inside it.
 */
const CREATE_BATCH = 60;

/** Ids per `updateMany ... WHERE id IN (...)`, one variable each. */
const ID_BATCH = 200;

export type SearchRunError = {
  /** The company this failure belongs to, or null when the run itself failed. */
  company: string | null;
  reason: string;
};

export type SearchRunSummary = {
  runId: string;
  status: "done" | "failed";
  companiesTotal: number;
  companiesChecked: number;
  jobsFound: number;
  /** Matches this run produced -- created, refreshed, or confirmed still valid. */
  matchesCreated: number;
  errors: SearchRunError[];
};

type MatchDraft = { jobPostingId: string; score: number; connectionCount: number };

export type ConnectionRow = {
  id: string;
  companyId: string | null;
  companyNorm: string;
  companyRaw: string;
  position: string | null;
};

export type CompanyGroup = {
  nameNorm: string;
  displayName: string;
  connections: ConnectionRow[];
};

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

/**
 * Open a run row and return its id, without doing any work.
 *
 * Split from {@link executeSearchRun} so a server action can hand the client
 * something to poll immediately and let the search itself continue after the
 * response has been sent.
 */
export async function createSearchRun(userId: string): Promise<string> {
  const id = assertUserId(userId);
  const run = await prisma.searchRun.create({ data: { userId: id }, select: { id: true } });
  return run.id;
}

/** A run still marked "running" long after any real run would have finished. */
export function isRunStalled(
  run: { status: string; startedAt: Date },
  now: number = Date.now(),
): boolean {
  return run.status === "running" && now - run.startedAt.getTime() > RUN_DEADLINE_MS;
}

/** Create and execute in one call -- for tests, scripts, and any caller that can wait. */
export async function runSearch(
  userId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchRunSummary> {
  const runId = await createSearchRun(userId);
  return executeSearchRun(runId, userId, opts);
}

/**
 * Do the work for an already-open run.
 *
 * Never throws: a fatal error is recorded on the run and returned as
 * `status: "failed"`, because the caller is usually a fire-and-forget
 * continuation whose exception nobody would ever see.
 */
export async function executeSearchRun(
  runId: string,
  userId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchRunSummary> {
  const id = assertUserId(userId);
  const now = Date.now();

  const deadline = AbortSignal.timeout(RUN_DEADLINE_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;

  const progress = {
    companiesTotal: 0,
    companiesChecked: 0,
    jobsFound: 0,
    matchesCreated: 0,
  };
  const errors: SearchRunError[] = [];

  const flush = async () => {
    // A failed progress write must never take the run down with it.
    await prisma.searchRun
      .update({ where: { id: runId }, data: { ...progress } })
      .catch(() => undefined);
  };

  try {
    const [user, connections] = await Promise.all([
      prisma.user.findUnique({ where: { id }, select: { prefsJson: true } }),
      prisma.connection.findMany({
        where: { userId: id, companyNorm: { not: "" } },
        select: {
          id: true,
          companyId: true,
          companyNorm: true,
          companyRaw: true,
          position: true,
        },
      }),
    ]);

    const preferences = parsePreferences(user?.prefsJson);
    const groups = groupByCompany(connections);

    progress.companiesTotal = groups.length;
    await flush();

    // Loaded once: every match this user already has, so the write phase can
    // tell a new match from one that merely needs its score refreshed.
    const existingMatches = new Map<string, { id: string; score: number; connectionCount: number }>();
    for (const match of await prisma.match.findMany({
      where: { userId: id },
      select: { id: true, jobPostingId: true, score: true, connectionCount: true },
    })) {
      existingMatches.set(match.jobPostingId, match);
    }

    const limit = pLimit(FETCH_CONCURRENCY);

    for (const chunk of chunked(groups, COMPANY_CHUNK)) {
      if (signal.aborted) break;

      // Resolution is itself concurrency-capped and caches globally, so most
      // chunks after the first few settle from the database without a probe.
      const resolved = await resolveCompanies(
        chunk.map((group) => ({ nameNorm: group.nameNorm, displayName: group.displayName })),
        { signal },
      );

      const drafts: MatchDraft[] = [];

      await Promise.all(
        chunk.map((group) =>
          limit(async () => {
            try {
              const outcome = await processCompany({
                userId: id,
                group,
                company: resolved.get(group.nameNorm) ?? null,
                preferences,
                now,
                signal,
              });
              progress.jobsFound += outcome.jobsFound;
              drafts.push(...outcome.drafts);
              if (outcome.error) record(errors, outcome.error);
            } catch (error) {
              record(errors, { company: group.displayName, reason: describeError(error) });
            } finally {
              progress.companiesChecked += 1;
            }
          }),
        ),
      );

      progress.matchesCreated += await writeMatches(id, drafts, existingMatches);
      await flush();
    }

    if (signal.aborted && progress.companiesChecked < progress.companiesTotal) {
      record(errors, {
        company: null,
        reason: "The search ran out of time before checking every company. Run it again to finish.",
      });
    }

    await prisma.searchRun.update({
      where: { id: runId },
      data: {
        ...progress,
        status: "done",
        finishedAt: new Date(),
        errorsJson: encodeErrors(errors),
      },
    });

    return { runId, status: "done", ...progress, errors };
  } catch (error) {
    console.error("[search] run failed", error);
    record(errors, { company: null, reason: describeError(error) });

    await prisma.searchRun
      .update({
        where: { id: runId },
        data: {
          ...progress,
          status: "failed",
          finishedAt: new Date(),
          errorsJson: encodeErrors(errors),
        },
      })
      .catch(() => undefined);

    return { runId, status: "failed", ...progress, errors };
  }
}

// ---------------------------------------------------------------------------
// Per company
// ---------------------------------------------------------------------------

async function processCompany(args: {
  userId: string;
  group: CompanyGroup;
  company: Company | null;
  preferences: JobPreferences;
  now: number;
  signal: AbortSignal;
}): Promise<{ jobsFound: number; drafts: MatchDraft[]; error: SearchRunError | null }> {
  const { userId, group, company, preferences, now, signal } = args;

  // Unresolved, or a cached "no public board". Nothing to look at, and the
  // resolver has already recorded why.
  if (!company) return { jobsFound: 0, drafts: [], error: null };

  await linkConnections(userId, group, company.id);

  let error: SearchRunError | null = null;
  const binding = boardBinding(company);

  if (binding && isJobCacheStale(company, now)) {
    try {
      const fresh = await fetchJobs(binding.provider, binding.token, { signal });
      await syncPostings(company.id, fresh);
      // Only on success: a failed fetch must leave the TTL expired so the next
      // run tries again rather than trusting a list we never received.
      await prisma.company.update({
        where: { id: company.id },
        data: { lastFetchedAt: new Date() },
      });
    } catch (cause) {
      // Whatever we already had cached is still shown; the run just says so.
      error = { company: company.displayName, reason: describeError(cause) };
    }
  }

  const jobs = await prisma.jobPosting.findMany({
    where: { companyId: company.id, isOpen: true },
  });

  const drafts: MatchDraft[] = [];
  for (const job of jobs) {
    if (!matchesPreferences(job, preferences)) continue;
    const { total } = scoreJob(job, group.connections, preferences, now);
    drafts.push({
      jobPostingId: job.id,
      score: total,
      connectionCount: group.connections.length,
    });
  }

  return { jobsFound: jobs.length, drafts, error };
}

/**
 * Point this user's connections at the company they resolved to.
 *
 * Scoped by userId on the write itself, not just by the ids -- connection rows
 * describe third parties and every statement that touches them says whose they
 * are (see the privacy note in src/lib/db.ts).
 */
async function linkConnections(
  userId: string,
  group: CompanyGroup,
  companyId: string,
): Promise<void> {
  const stale = group.connections
    .filter((connection) => connection.companyId !== companyId)
    .map((connection) => connection.id);

  for (const batch of chunked(stale, ID_BATCH)) {
    await prisma.connection.updateMany({
      where: { id: { in: batch }, userId },
      data: { companyId },
    });
  }
}

function boardBinding(company: Company): { provider: AtsProvider; token: string } | null {
  if (company.resolveStatus !== "resolved" && company.resolveStatus !== "manual") return null;
  if (!isAtsProvider(company.atsProvider) || !company.atsToken) return null;
  return { provider: company.atsProvider, token: company.atsToken };
}

export function isJobCacheStale(
  company: Pick<Company, "lastFetchedAt">,
  now: number = Date.now(),
): boolean {
  return (
    company.lastFetchedAt == null || now - company.lastFetchedAt.getTime() >= JOB_CACHE_TTL_MS
  );
}

// ---------------------------------------------------------------------------
// Posting sync
// ---------------------------------------------------------------------------

/**
 * Reconcile a company's stored postings against what its board just returned.
 *
 * Deliberately a diff rather than a per-row upsert: a single Greenhouse board
 * can carry 583 postings, and upserting each one would mean 583 statements per
 * company per refresh. Instead one read, then writes proportional to what
 * actually changed.
 *
 * Postings that vanished are closed, never deleted -- a Match or ReferralAsk
 * pointing at a role the user already asked about must keep its referent.
 */
async function syncPostings(companyId: string, fresh: readonly NormalizedJob[]): Promise<void> {
  const existing = await prisma.jobPosting.findMany({
    where: { companyId },
    select: {
      id: true,
      source: true,
      externalId: true,
      title: true,
      location: true,
      remote: true,
      department: true,
      url: true,
      postedAt: true,
      isOpen: true,
    },
  });

  const byKey = new Map(existing.map((row) => [`${row.source}:${row.externalId}`, row]));
  const now = new Date();
  const seen = new Set<string>();

  const creates: PostingRow[] = [];
  const unchanged: string[] = [];

  for (const job of fresh) {
    const key = `${job.source}:${job.externalId}`;
    seen.add(key);

    const row = byKey.get(key);
    if (!row) {
      creates.push({
        companyId,
        source: job.source,
        externalId: job.externalId,
        title: job.title,
        location: job.location,
        remote: job.remote,
        department: job.department,
        url: job.url,
        postedAt: job.postedAt,
        fetchedAt: now,
      });
      continue;
    }

    if (hasChanged(row, job)) {
      await prisma.jobPosting.update({
        where: { id: row.id },
        data: {
          title: job.title,
          location: job.location,
          remote: job.remote,
          department: job.department,
          url: job.url,
          postedAt: job.postedAt,
          isOpen: true, // a posting that came back is open again
          fetchedAt: now,
        },
      });
    } else {
      unchanged.push(row.id);
    }
  }

  await createPostings(creates);

  // Touched in bulk so `fetchedAt` still means "when we last saw this on the
  // board", without paying a statement per unchanged posting.
  for (const batch of chunked(unchanged, ID_BATCH)) {
    await prisma.jobPosting.updateMany({
      where: { id: { in: batch } },
      data: { fetchedAt: now },
    });
  }

  const vanished = existing
    .filter((row) => row.isOpen && !seen.has(`${row.source}:${row.externalId}`))
    .map((row) => row.id);

  for (const batch of chunked(vanished, ID_BATCH)) {
    await prisma.jobPosting.updateMany({
      where: { id: { in: batch } },
      data: { isOpen: false },
    });
  }
}

type PostingRow = {
  companyId: string;
  source: string;
  externalId: string;
  title: string;
  location: string | null;
  remote: boolean;
  department: string | null;
  url: string;
  postedAt: Date | null;
  fetchedAt: Date;
};

/**
 * JobPosting is unique on `[source, externalId]` globally, not per company, so
 * a posting can in principle already belong to another company row -- if a board
 * token was rebound, say. That is rare enough to handle by falling back to
 * per-row upserts for the offending batch rather than by slowing the common path.
 */
async function createPostings(rows: readonly PostingRow[]): Promise<void> {
  for (const batch of chunked(rows, CREATE_BATCH)) {
    try {
      await prisma.jobPosting.createMany({ data: batch });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      for (const row of batch) {
        const { source, externalId, ...rest } = row;
        await prisma.jobPosting.upsert({
          where: { source_externalId: { source, externalId } },
          create: { source, externalId, ...rest },
          update: { ...rest, isOpen: true },
        });
      }
    }
  }
}

export function hasChanged(
  row: {
    title: string;
    location: string | null;
    remote: boolean;
    department: string | null;
    url: string;
    postedAt: Date | null;
    isOpen: boolean;
  },
  job: NormalizedJob,
): boolean {
  return (
    row.title !== job.title ||
    row.location !== job.location ||
    row.remote !== job.remote ||
    row.department !== job.department ||
    row.url !== job.url ||
    sameInstant(row.postedAt, job.postedAt) === false ||
    row.isOpen === false
  );
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

// ---------------------------------------------------------------------------
// Match writing
// ---------------------------------------------------------------------------

/**
 * Write this chunk's matches, and return how many the user now has from it.
 *
 * `state` is never touched on an existing row: a match the user dismissed must
 * stay dismissed when the next run finds the same role still open.
 */
async function writeMatches(
  userId: string,
  drafts: readonly MatchDraft[],
  existing: Map<string, { id: string; score: number; connectionCount: number }>,
): Promise<number> {
  const creates: MatchDraft[] = [];

  for (const draft of drafts) {
    const prior = existing.get(draft.jobPostingId);

    if (!prior) {
      creates.push(draft);
      continue;
    }

    if (prior.score === draft.score && prior.connectionCount === draft.connectionCount) continue;

    await prisma.match.update({
      where: { id: prior.id },
      data: { score: draft.score, connectionCount: draft.connectionCount },
    });
    prior.score = draft.score;
    prior.connectionCount = draft.connectionCount;
  }

  for (const batch of chunked(creates, CREATE_BATCH)) {
    const data = batch.map((draft) => ({ userId, ...draft }));
    try {
      await prisma.match.createMany({ data });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent run for the same user got here first; adopt its row.
      for (const draft of batch) {
        await prisma.match.upsert({
          where: { userId_jobPostingId: { userId, jobPostingId: draft.jobPostingId } },
          create: { userId, ...draft },
          update: { score: draft.score, connectionCount: draft.connectionCount },
        });
      }
    }
  }

  return drafts.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function groupByCompany(connections: readonly ConnectionRow[]): CompanyGroup[] {
  const groups = new Map<string, CompanyGroup>();

  for (const connection of connections) {
    let group = groups.get(connection.companyNorm);
    if (!group) {
      group = {
        nameNorm: connection.companyNorm,
        displayName: displayCompanyName(connection.companyRaw) || connection.companyNorm,
        connections: [],
      };
      groups.set(connection.companyNorm, group);
    }
    group.connections.push(connection);
  }

  return [...groups.values()];
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function record(errors: SearchRunError[], error: SearchRunError): void {
  if (errors.length < MAX_RECORDED_ERRORS) errors.push(error);
}

function encodeErrors(errors: readonly SearchRunError[]): string | null {
  return errors.length === 0 ? null : JSON.stringify(errors);
}

export function decodeErrors(errorsJson: string | null | undefined): SearchRunError[] {
  if (!errorsJson) return [];
  try {
    const parsed: unknown = JSON.parse(errorsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SearchRunError =>
        typeof item === "object" && item !== null && typeof (item as SearchRunError).reason === "string",
    );
  } catch {
    return [];
  }
}

function describeError(error: unknown): string {
  if (error instanceof AtsError) return `${error.kind}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
