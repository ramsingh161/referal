import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppNav } from "@/components/app-nav";
import { Panel, PanelLabel, PanelTitle } from "@/components/ui/panel";
import { prisma } from "@/lib/db";
import { displayCompanyName } from "@/lib/company/normalize";

export const metadata = { title: "Your network — Referral Finder" };

/** How many companies to list. Enough to recognise the shape of your network. */
const TOP_COMPANIES = 40;

/**
 * The network the user imported, from the app's point of view.
 *
 * The job here is to make the matching legible *before* any search runs: if the
 * app has grouped a company wrongly, this is where it shows, and a user who can
 * see the grouping can trust the results that come out of it.
 */
export default async function ConnectionsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const [total, withoutCompany, grouped] = await Promise.all([
    prisma.connection.count({ where: { userId } }),
    prisma.connection.count({ where: { userId, companyNorm: "" } }),
    prisma.connection.groupBy({
      by: ["companyNorm"],
      where: { userId, companyNorm: { not: "" } },
      _count: { _all: true },
      orderBy: { _count: { companyNorm: "desc" } },
      take: TOP_COMPANIES,
    }),
  ]);

  if (total === 0) redirect("/onboarding");

  const distinctCompanies = await prisma.connection.findMany({
    where: { userId, companyNorm: { not: "" } },
    select: { companyNorm: true },
    distinct: ["companyNorm"],
  });

  // A readable name per group. The stored `companyNorm` is a lowercase key, so
  // show the user's own spelling from one of the rows instead.
  const samples = await prisma.connection.findMany({
    where: { userId, companyNorm: { in: grouped.map((row) => row.companyNorm) } },
    select: { companyNorm: true, companyRaw: true },
    distinct: ["companyNorm"],
  });

  const displayNames = new Map(
    samples.map((row) => [row.companyNorm, displayCompanyName(row.companyRaw)]),
  );

  const stats: [string, string][] = [
    ["Connections", total.toLocaleString()],
    ["Companies", distinctCompanies.length.toLocaleString()],
    ["No company listed", withoutCompany.toLocaleString()],
  ];

  return (
    <div className="min-h-dvh">
      <AppNav current="/connections" />

      <main className="mx-auto w-full max-w-6xl px-5 py-14">
        <p className="label text-signal">Your network</p>
        <h1 className="mt-4 font-heading text-3xl leading-tight font-extrabold tracking-[-0.02em] text-ink">
          Where your connections work
        </h1>

        <dl className="mt-10 grid max-w-2xl grid-cols-3 gap-6 border-y border-hairline py-7">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dd className="font-heading text-3xl font-bold tracking-tight text-ink">
                {value}
              </dd>
              <dt className="mt-1 text-xs text-muted">{label}</dt>
            </div>
          ))}
        </dl>

        <section className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <PanelTitle>
              {distinctCompanies.length > TOP_COMPANIES
                ? `Your ${TOP_COMPANIES} biggest companies`
                : "Companies"}
            </PanelTitle>
            <p className="text-sm text-muted">
              Grouped by company, most connections first.
            </p>
          </div>

          <ul className="mt-6 border-t border-hairline">
            {grouped.map((row) => {
              const count = row._count._all;
              return (
                <li
                  key={row.companyNorm}
                  className="flex items-center gap-4 border-b border-hairline py-3"
                >
                  {/* A stop marker, sized by how many people you know there —
                      the same signal the ranking will use. */}
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full border-[3px] border-signal bg-surface"
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {displayNames.get(row.companyNorm) ?? row.companyNorm}
                  </span>
                  <span className="font-mono text-sm text-muted">
                    {count.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {withoutCompany > 0 && (
          <Panel className="mt-12 max-w-2xl">
            <PanelLabel>Not matchable</PanelLabel>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              {withoutCompany.toLocaleString()} of your connections have no company in
              the export. LinkedIn leaves it blank when someone hasn't filled in their
              current role, so there's no board for us to check. They stay in your
              network in case that changes.
            </p>
          </Panel>
        )}

        <Panel className="mt-6 max-w-2xl">
          <PanelLabel>Keeping it current</PanelLabel>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            People change jobs. Request a fresh export from LinkedIn every few months
            and{" "}
            <Link href="/onboarding" className="text-signal underline underline-offset-2">
              upload it again
            </Link>
            — new job titles get picked up and nobody already here is removed.
          </p>
        </Panel>
      </main>
    </div>
  );
}
