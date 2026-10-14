import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppNav } from "@/components/app-nav";
import { Panel, PanelTitle } from "@/components/ui/panel";
import { prisma } from "@/lib/db";
import { hasAnyPreference, parsePreferences } from "@/lib/prefs";
import { listTopMatches } from "@/lib/search/matches";
import { isRunStalled } from "@/lib/search/run-search";

import { MatchList } from "./_components/match-list";
import { SearchRunner } from "./_components/search-runner";

export const metadata = { title: "Referrals — Referral Finder" };

/** Results shown before the list is truncated. */
const MATCH_LIMIT = 50;

/**
 * The dashboard: one button, and what it found.
 */
export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const [user, connectionCount, companies, matches, activeRun] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { prefsJson: true, onboardedAt: true, name: true },
    }),
    prisma.connection.count({ where: { userId } }),
    prisma.connection.findMany({
      where: { userId, companyNorm: { not: "" } },
      select: { companyNorm: true },
      distinct: ["companyNorm"],
    }),
    listTopMatches(userId, { take: MATCH_LIMIT }),
    // A run still going from a previous visit: the button resumes watching it
    // rather than offering to start a second one.
    prisma.searchRun.findFirst({
      where: { userId, status: "running" },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, startedAt: true },
    }),
  ]);

  // Nothing to search means nothing to show. Send them to the one screen that
  // can change that.
  if (connectionCount === 0) redirect("/onboarding");

  const preferences = parsePreferences(user?.prefsJson);
  const firstName = user?.name?.split(" ")[0];
  const resumableRunId = activeRun && !isRunStalled(activeRun) ? activeRun.id : null;

  return (
    <div className="min-h-dvh">
      <AppNav current="/dashboard" />

      <main className="mx-auto w-full max-w-6xl px-5 py-14">
        <p className="label text-signal">Your network</p>
        <h1 className="mt-4 font-heading text-3xl leading-tight font-extrabold tracking-[-0.02em] text-ink">
          {firstName ? `${firstName}, you know people at` : "You know people at"}{" "}
          {companies.length.toLocaleString()}{" "}
          {companies.length === 1 ? "company" : "companies"}
        </h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          {connectionCount.toLocaleString()} connections imported. Press the button
          and we'll check every one of those companies for open roles.
        </p>

        <SearchRunner
          initialRunId={resumableRunId}
          hasResults={matches.length > 0}
          companyCount={companies.length}
        />

        {matches.length > 0 ? (
          <section className="mt-14">
            <div className="flex items-baseline justify-between gap-4">
              <PanelTitle>
                {matches.length >= MATCH_LIMIT
                  ? `Top ${MATCH_LIMIT} roles you have a warm path into`
                  : `${matches.length} ${matches.length === 1 ? "role" : "roles"} you have a warm path into`}
              </PanelTitle>
              <Link
                href="/onboarding"
                className="text-sm text-muted underline underline-offset-2 hover:text-ink"
              >
                {hasAnyPreference(preferences) ? "Adjust filters" : "Narrow these down"}
              </Link>
            </div>
            <div className="mt-5">
              <MatchList matches={matches} />
            </div>
          </section>
        ) : (
          <Panel className="mt-14">
            <PanelTitle>What happens when you press it</PanelTitle>
            <ol className="mt-5 space-y-3 text-sm leading-relaxed text-ink-soft">
              <li>
                We look up each of your {companies.length.toLocaleString()} companies on
                the public job boards they hire through.
              </li>
              <li>
                Every open role comes back with the people you already know there,
                ranked by how well-placed they are to refer you.
              </li>
              <li>You pick who to ask. We draft the message; you send it.</li>
            </ol>

            <div className="mt-6 flex flex-wrap items-center gap-5 border-t border-hairline pt-5">
              <Link
                href="/connections"
                className="text-sm text-signal underline underline-offset-2"
              >
                Review your network
              </Link>
              <Link
                href="/onboarding"
                className="text-sm text-muted underline underline-offset-2 hover:text-ink"
              >
                {hasAnyPreference(preferences)
                  ? "Change what you're looking for"
                  : "Narrow what you're looking for"}
              </Link>
            </div>
          </Panel>
        )}
      </main>
    </div>
  );
}
