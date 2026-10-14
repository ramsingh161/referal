import type { Company } from "@/generated/prisma/client";
import { fetchJobs, getAdapter, parseBoardUrl, PROBE_ORDER } from "@/lib/ats";
import { AtsError, isValidToken, type AtsProvider } from "@/lib/ats/types";
import { prisma } from "@/lib/db";
import pLimit from "p-limit";

import { bestFuzzyMatch, type FuzzyCandidate } from "./similarity";

/**
 * Company resolution: turn a normalised company name into a Company row bound to
 * an ATS board — or a cached "no board" negative — in three layers:
 *
 *   1. exact lookup  (registry seed + everything already resolved by any user)
 *   2. slug probe    (derive candidate board tokens, ask each provider)
 *   3. manual URL    (the user pastes a board link; see applyBoardUrl)
 *
 * All three write to the shared, global Company table, so one user's resolution
 * is cached for everyone: positives are kept permanently, negatives for 30 days.
 *
 * The join key is Company.nameNorm, which is exactly what import-connections
 * writes into Connection.companyNorm (`canonicalCompanyName` — normalisation and
 * the alias map already applied). So the exact match here is plain equality, and
 * fuzzy matching only has to catch typos and spacing the normaliser cannot.
 */

/** After this long a `no_board` negative is re-probed, in case a board appeared. */
const NEGATIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Never fan probes out over a whole network at once (see NOTES-ATS DNS note). */
const PROBE_CONCURRENCY = 5;

/** Punishingly high on purpose — a wrong merge is the product's worst failure. */
const FUZZY_THRESHOLD = 0.97;

/**
 * Providers a slug probe can actually prove. SmartRecruiters is excluded: it
 * answers 200 + empty for ANY token (NOTES-ATS quirk 1), so a probe there can
 * neither confirm nor deny, and those companies must arrive via the seed
 * registry or a pasted URL. Reading each adapter's own `emptyBoardProvesToken`
 * flag keeps this list from ever drifting out of sync with the adapters.
 */
const PROBE_PROVIDERS: readonly AtsProvider[] = PROBE_ORDER.filter(
  (provider) => getAdapter(provider).emptyBoardProvesToken,
);

export type ResolveInput = {
  /** `canonicalCompanyName(...)` — the same key as Connection.companyNorm. */
  nameNorm: string;
  /** Human-facing name for a newly created row; falls back to nameNorm. */
  displayName: string;
};

/** Board slugs to try for a normalised name: "acme corp" → ["acmecorp", "acme-corp"]. */
export function slugCandidates(nameNorm: string): string[] {
  const collapsed = nameNorm.replace(/[^a-z0-9]+/g, "");
  const hyphenated = nameNorm.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const out: string[] = [];
  for (const slug of [collapsed, hyphenated]) {
    if (slug && isValidToken(slug) && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/** Whether a negative-cache row is still within its TTL. */
export function isNegativeCacheFresh(
  company: Pick<Company, "resolveStatus" | "lastProbedAt">,
  now: number = Date.now(),
): boolean {
  return (
    company.resolveStatus === "no_board" &&
    company.lastProbedAt != null &&
    now - company.lastProbedAt.getTime() < NEGATIVE_TTL_MS
  );
}

/** Resolve one company name — a thin wrapper over the batch path. */
export async function resolveCompany(
  input: ResolveInput,
  opts: { signal?: AbortSignal } = {},
): Promise<Company> {
  const resolved = await resolveCompanies([input], opts);
  const company = resolved.get(input.nameNorm);
  if (!company) throw new Error(`resolveCompanies dropped input: ${input.nameNorm}`);
  return company;
}

/**
 * Resolve many names at once, keyed by nameNorm. Exact matches and fresh caches
 * are settled from a single query; only genuine unknowns are probed, and those
 * are concurrency-capped.
 */
export async function resolveCompanies(
  inputs: readonly ResolveInput[],
  opts: { signal?: AbortSignal } = {},
): Promise<Map<string, Company>> {
  const unique = new Map<string, ResolveInput>();
  for (const input of inputs) {
    if (input.nameNorm && !unique.has(input.nameNorm)) unique.set(input.nameNorm, input);
  }

  const result = new Map<string, Company>();
  if (unique.size === 0) return result;

  const now = Date.now();
  const existing = await prisma.company.findMany({
    where: { nameNorm: { in: [...unique.keys()] } },
  });
  const existingByName = new Map(existing.map((company) => [company.nameNorm, company]));

  const toProbe: ResolveInput[] = [];
  for (const [name, input] of unique) {
    const company = existingByName.get(name);
    if (company && (company.resolveStatus === "resolved" || company.resolveStatus === "manual")) {
      result.set(name, company);
    } else if (company && isNegativeCacheFresh(company, now)) {
      result.set(name, company);
    } else {
      toProbe.push(input);
    }
  }
  if (toProbe.length === 0) return result;

  // Fuzzy-adopt reference set, loaded once for the whole batch. (A future scaling
  // step would block this by first letter or length rather than scan them all.)
  const fuzzyCandidates: FuzzyCandidate[] = await prisma.company.findMany({
    where: { resolveStatus: { in: ["resolved", "manual"] } },
    select: { id: true, nameNorm: true },
  });

  const limit = pLimit(PROBE_CONCURRENCY);
  await Promise.all(
    toProbe.map((input) =>
      limit(async () => {
        const company = await resolveOne(
          input,
          existingByName.get(input.nameNorm) ?? null,
          fuzzyCandidates,
          opts.signal,
        );
        result.set(input.nameNorm, company);
      }),
    ),
  );

  return result;
}

async function resolveOne(
  input: ResolveInput,
  existing: Company | null,
  fuzzyCandidates: readonly FuzzyCandidate[],
  signal: AbortSignal | undefined,
): Promise<Company> {
  // Fuzzy-adopt only a brand-new name: an existing row, even an unresolved one,
  // is a stronger statement about this exact spelling than a near-match to some
  // other name would be.
  if (!existing) {
    const match = bestFuzzyMatch(input.nameNorm, fuzzyCandidates, FUZZY_THRESHOLD);
    if (match) {
      const adopted = await prisma.company.findUnique({ where: { id: match.id } });
      if (adopted) return adopted;
    }
  }

  const company =
    existing ??
    (await prisma.company.upsert({
      where: { nameNorm: input.nameNorm },
      create: {
        nameNorm: input.nameNorm,
        displayName: input.displayName || input.nameNorm,
        resolveStatus: "unresolved",
      },
      update: {}, // a concurrent create just yields the existing row
    }));

  const candidates = slugCandidates(input.nameNorm);
  let inconclusive = false;

  for (const provider of PROBE_PROVIDERS) {
    for (const token of candidates) {
      if (signal?.aborted) return company;
      try {
        // A non-throwing fetch proves the board exists — on these four providers
        // even an empty one does. The jobs are discarded; run-search fetches them
        // again under its own cache. (Handing them back is a future optimisation.)
        await fetchJobs(provider, token, { signal });
        return await bindResolved(company, provider, token);
      } catch (error) {
        if (error instanceof AtsError && error.isConclusive) continue; // not this board
        // Timeout / 429 / 5xx / network: nothing was learned. This must never
        // become a negative, or the global cache is poisoned for 30 days.
        inconclusive = true;
      }
    }
  }

  if (inconclusive) return company; // stays unresolved; retried on the next run
  return markNoBoard(company);
}

/**
 * Bind a company to the board it probed to. If another company already owns that
 * exact (provider, token) the two names are the same company: adopt the owner
 * and drop our freshly made placeholder rather than duplicate the binding, which
 * the DB forbids via @@unique([atsProvider, atsToken]) anyway.
 */
async function bindResolved(
  company: Company,
  provider: AtsProvider,
  token: string,
): Promise<Company> {
  try {
    return await prisma.company.update({
      where: { id: company.id },
      data: {
        atsProvider: provider,
        atsToken: token,
        resolveStatus: "resolved",
        lastProbedAt: new Date(),
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const owner = await prisma.company.findUnique({
      where: { atsProvider_atsToken: { atsProvider: provider, atsToken: token } },
    });
    if (!owner) throw error;
    // Remove the placeholder only if nothing points at it yet, so we never orphan.
    await prisma.company.deleteMany({
      where: {
        id: company.id,
        resolveStatus: "unresolved",
        connections: { none: {} },
        jobs: { none: {} },
      },
    });
    return owner;
  }
}

async function markNoBoard(company: Company): Promise<Company> {
  return prisma.company.update({
    where: { id: company.id },
    data: { resolveStatus: "no_board", lastProbedAt: new Date() },
  });
}

/**
 * Manual override: the user pastes a board URL for a company we could not
 * resolve. It is parsed to (provider, token) and written as `manual`, which
 * never expires. If that board already belongs to another name, return its owner.
 */
export async function applyBoardUrl(input: ResolveInput, boardUrl: string): Promise<Company> {
  const parsed = parseBoardUrl(boardUrl);
  if (!parsed) {
    throw new AtsError("bad_token", `Not a recognised ATS board URL: ${boardUrl}`);
  }

  const data = {
    atsProvider: parsed.provider,
    atsToken: parsed.token,
    resolveStatus: "manual",
    lastProbedAt: new Date(),
  };

  try {
    return await prisma.company.upsert({
      where: { nameNorm: input.nameNorm },
      create: {
        nameNorm: input.nameNorm,
        displayName: input.displayName || input.nameNorm,
        ...data,
      },
      update: data,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const owner = await prisma.company.findUnique({
      where: { atsProvider_atsToken: { atsProvider: parsed.provider, atsToken: parsed.token } },
    });
    if (owner) return owner;
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
