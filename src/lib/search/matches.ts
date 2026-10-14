import { assertUserId, prisma } from "@/lib/db";

import { bestReferrer } from "./rank";

/**
 * The read side of search: turning stored Match rows back into something the
 * results UI can render.
 *
 * Kept apart from run-search.ts so a page that only displays results does not
 * pull in the ATS adapters, p-limit and the whole fetch stack.
 */

export type MatchReferrer = {
  id: string;
  firstName: string;
  lastName: string;
  position: string | null;
  profileUrl: string | null;
};

export type MatchView = {
  id: string;
  score: number;
  connectionCount: number;
  state: string;
  job: {
    id: string;
    title: string;
    location: string | null;
    remote: boolean;
    department: string | null;
    url: string;
    postedAt: Date | null;
  };
  company: { id: string; displayName: string };
  /** The contact most worth asking, or null if their company link was lost. */
  referrer: MatchReferrer | null;
};

const DEFAULT_TAKE = 50;

/**
 * A user's best open matches, highest score first.
 *
 * Dismissed matches are excluded and closed postings are hidden: a role that
 * left the board is kept in the database for the sake of any referral already
 * asked about it, but showing it here would send the user after a vacancy that
 * no longer exists.
 */
export async function listTopMatches(
  userId: string,
  opts: { take?: number; states?: readonly string[] } = {},
): Promise<MatchView[]> {
  const id = assertUserId(userId);
  const states = opts.states ?? ["new", "saved", "asked"];

  const matches = await prisma.match.findMany({
    where: { userId: id, state: { in: [...states] }, job: { isOpen: true } },
    orderBy: { score: "desc" },
    take: opts.take ?? DEFAULT_TAKE,
    select: {
      id: true,
      score: true,
      connectionCount: true,
      state: true,
      job: {
        select: {
          id: true,
          title: true,
          location: true,
          remote: true,
          department: true,
          url: true,
          postedAt: true,
          company: { select: { id: true, displayName: true } },
        },
      },
    },
  });

  if (matches.length === 0) return [];

  // One query for every contact behind this page of results, rather than one
  // per row. Scoped by userId on the query itself -- connection rows are PII
  // about third parties (see src/lib/db.ts).
  const companyIds = [...new Set(matches.map((match) => match.job.company.id))];
  const connections = await prisma.connection.findMany({
    where: { userId: id, companyId: { in: companyIds } },
    select: {
      id: true,
      companyId: true,
      firstName: true,
      lastName: true,
      position: true,
      profileUrl: true,
    },
  });

  const byCompany = new Map<string, MatchReferrer[]>();
  for (const connection of connections) {
    if (!connection.companyId) continue;
    const list = byCompany.get(connection.companyId);
    if (list) list.push(connection);
    else byCompany.set(connection.companyId, [connection]);
  }

  return matches.map(({ job, ...match }) => {
    const { company, ...posting } = job;
    return {
      ...match,
      job: posting,
      company,
      // Same function the score used, so the person shown is the person the
      // ranking actually credited.
      referrer: bestReferrer(byCompany.get(company.id) ?? [], posting),
    };
  });
}

/** How many open, undismissed matches this user has in total. */
export function countOpenMatches(userId: string): Promise<number> {
  const id = assertUserId(userId);
  return prisma.match.count({
    where: { userId: id, state: { not: "dismissed" }, job: { isOpen: true } },
  });
}
