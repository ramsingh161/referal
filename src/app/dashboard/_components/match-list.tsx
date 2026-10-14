import type { MatchView } from "@/lib/search/matches";

/**
 * The results list: open roles, best-connected first.
 *
 * Read-only for now -- saving, dismissing and the ask flow land with the results
 * grid. What matters here is that every row answers the question the app exists
 * to answer, so the contact is on the same line as the role, never a click away.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function postedLabel(postedAt: Date | null): string | null {
  if (!postedAt) return null;

  const days = Math.floor((Date.now() - postedAt.getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? "a month ago" : `${months} months ago`;
}

function fullName(referrer: NonNullable<MatchView["referrer"]>): string {
  return `${referrer.firstName} ${referrer.lastName}`.trim();
}

export function MatchList({ matches }: { matches: readonly MatchView[] }) {
  return (
    <ul className="divide-y divide-hairline border-y border-hairline">
      {matches.map((match) => (
        <MatchRow key={match.id} match={match} />
      ))}
    </ul>
  );
}

function MatchRow({ match }: { match: MatchView }) {
  const { job, company, referrer, connectionCount } = match;
  const posted = postedLabel(job.postedAt);
  const place = job.remote ? (job.location ?? "Remote") : job.location;

  return (
    <li className="flex flex-wrap items-baseline gap-x-6 gap-y-2 py-5">
      <div className="min-w-64 flex-1">
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-heading text-base font-bold tracking-[-0.01em] text-ink underline-offset-2 hover:underline"
        >
          {job.title}
        </a>
        <p className="mt-1 text-sm text-muted">
          {company.displayName}
          {place && <> &middot; {place}</>}
          {job.remote && !/remote/i.test(place ?? "") && <> &middot; Remote</>}
          {posted && <> &middot; {posted}</>}
        </p>
      </div>

      <div className="min-w-56 text-sm">
        <p className="text-ink-soft">
          You know {connectionCount.toLocaleString()}{" "}
          {connectionCount === 1 ? "person" : "people"} here
        </p>
        {referrer && (
          <p className="mt-1 text-muted">
            Ask{" "}
            {referrer.profileUrl ? (
              <a
                href={referrer.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-signal underline underline-offset-2"
              >
                {fullName(referrer)}
              </a>
            ) : (
              <span className="text-ink-soft">{fullName(referrer)}</span>
            )}
            {referrer.position && <> &mdash; {referrer.position}</>}
          </p>
        )}
      </div>
    </li>
  );
}
