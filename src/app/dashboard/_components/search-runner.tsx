"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { getSearchProgress, startSearch, type SearchProgress } from "../actions";

/**
 * The Find-referrals button, and the progress line under it.
 *
 * A run takes minutes, so the button hands back a run id and this component
 * polls it every POLL_MS. Polling rather than a stream: an SSE connection dies
 * quietly behind a serverless proxy, and a progress bar that has silently
 * stopped is worse than one that updates a second late. A failed poll here just
 * gets retried on the next tick.
 *
 * When the run finishes it calls `router.refresh()`, which re-renders the server
 * page and brings the new matches down with it.
 */

const POLL_MS = 1500;

/** Consecutive failed polls tolerated before giving up on the run. */
const MAX_POLL_FAILURES = 8;

type Props = {
  /** A run already in flight when the page rendered, to resume watching. */
  initialRunId?: string | null;
  /** Whether the user already has results, which changes the button's wording. */
  hasResults: boolean;
  companyCount: number;
};

export function SearchRunner({ initialRunId, hasResults, companyCount }: Props) {
  const router = useRouter();
  const [isStarting, startTransition] = useTransition();

  const [runId, setRunId] = useState<string | null>(initialRunId ?? null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Read inside the polling effect without making it a dependency, so a tick
  // never restarts the loop it is running in.
  const failures = useRef(0);

  const finish = useCallback(
    (final: SearchProgress | null) => {
      setRunId(null);
      setProgress(final);
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    failures.current = 0;

    const tick = async () => {
      try {
        const next = await getSearchProgress(runId);
        if (cancelled) return;

        if (!next) {
          // The run is gone -- signed out, or a row that no longer exists.
          setRunId(null);
          setMessage("That search is no longer available. Start a new one.");
          return;
        }

        failures.current = 0;
        setProgress(next);

        if (next.status === "running") {
          timer = setTimeout(tick, POLL_MS);
        } else {
          finish(next);
        }
      } catch {
        if (cancelled) return;
        failures.current += 1;
        if (failures.current >= MAX_POLL_FAILURES) {
          setRunId(null);
          setMessage("Lost track of the search. Reload the page to see where it got to.");
          return;
        }
        timer = setTimeout(tick, POLL_MS);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, finish]);

  const isRunning = runId !== null;

  const begin = () => {
    setMessage(null);
    setProgress(null);
    startTransition(async () => {
      const result = await startSearch();
      if (result.status === "error") {
        setMessage(result.message);
        return;
      }
      setRunId(result.runId);
      if (result.status === "already-running") {
        setMessage("A search was already running. Watching that one.");
      }
    });
  };

  return (
    <div className="mt-9">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="signal"
          size="lg"
          onClick={begin}
          disabled={isStarting || isRunning}
        >
          {isRunning
            ? "Searching..."
            : hasResults
              ? "Search again"
              : "Find referrals"}
        </Button>

        {isRunning ? (
          <ProgressLine progress={progress} companyCount={companyCount} />
        ) : (
          <Summary progress={progress} />
        )}
      </div>

      {message && <p className="mt-3 text-sm text-signal">{message}</p>}

      {progress && progress.errors.length > 0 && !isRunning && (
        <ErrorNote errors={progress.errors} />
      )}
    </div>
  );
}

function ProgressLine({
  progress,
  companyCount,
}: {
  progress: SearchProgress | null;
  companyCount: number;
}) {
  // Before the first poll lands, the count the page already knew is a better
  // placeholder than a zero.
  const total = progress?.companiesTotal || companyCount;
  const checked = progress?.companiesChecked ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((checked / total) * 100)) : 0;

  return (
    <div className="min-w-56 flex-1">
      <p className="text-sm text-ink-soft">
        Checked {checked.toLocaleString()}/{total.toLocaleString()} companies
        {progress && progress.jobsFound > 0
          ? ` - ${progress.jobsFound.toLocaleString()} open roles so far`
          : "..."}
      </p>
      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-[2px] bg-black/[0.08]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Search progress"
      >
        <div
          className="h-full bg-signal transition-[width] duration-300"
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      </div>
    </div>
  );
}

function Summary({ progress }: { progress: SearchProgress | null }) {
  if (!progress) return null;

  if (progress.status === "failed") {
    return <p className="text-sm text-signal">The search did not finish. Try again.</p>;
  }

  if (progress.matchesCreated === 0) {
    return (
      <p className="text-sm text-muted">
        Checked {progress.companiesTotal.toLocaleString()} companies, no roles matched
        what you are looking for.
      </p>
    );
  }

  return (
    <p className="text-sm text-ink-soft">
      {progress.matchesCreated.toLocaleString()} matching{" "}
      {progress.matchesCreated === 1 ? "role" : "roles"} across{" "}
      {progress.jobsFound.toLocaleString()} open{" "}
      {progress.jobsFound === 1 ? "posting" : "postings"}.
    </p>
  );
}

/**
 * Failures are shown, not swallowed: a company whose board could not be read
 * has no results, and the user should know that is why rather than concluding
 * nobody there is hiring.
 */
function ErrorNote({ errors }: { errors: SearchProgress["errors"] }) {
  const [expanded, setExpanded] = useState(false);
  const named = errors.filter((error) => error.company !== null);
  const runLevel = errors.filter((error) => error.company === null);

  return (
    <div className="mt-4 border-l-2 border-hairline pl-4 text-sm">
      {runLevel.map((error, index) => (
        <p key={`run-${index}`} className="text-ink-soft">
          {error.reason}
        </p>
      ))}

      {named.length > 0 && (
        <>
          <p className="text-muted">
            {named.length.toLocaleString()}{" "}
            {named.length === 1 ? "company" : "companies"} could not be checked.{" "}
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="text-signal underline underline-offset-2"
            >
              {expanded ? "Hide" : "Show"}
            </button>
          </p>
          {expanded && (
            <ul className="mt-2 space-y-1 text-muted">
              {named.map((error, index) => (
                <li key={`${error.company}-${index}`}>
                  <span className="text-ink-soft">{error.company}</span> - {error.reason}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
