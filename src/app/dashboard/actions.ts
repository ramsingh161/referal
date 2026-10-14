"use server";

import { after } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  createSearchRun,
  decodeErrors,
  executeSearchRun,
  isRunStalled,
  type SearchRunError,
} from "@/lib/search/run-search";

/**
 * Search actions: start a run, then report on it.
 *
 * The run itself takes minutes -- hundreds of companies, most of them a network
 * round trip -- so `startSearch` only opens the row and returns its id, and the
 * work continues in `after()` once the response has been sent. The client then
 * polls {@link getSearchProgress}.
 *
 * Polling rather than streaming is deliberate: SSE connections are unreliable
 * behind the proxies and function timeouts of serverless hosts, and a dropped
 * stream would leave the user staring at a progress bar that has silently
 * stopped moving. A poll that fails simply retries.
 */

export type SearchProgress = {
  runId: string;
  status: "running" | "done" | "failed";
  companiesTotal: number;
  companiesChecked: number;
  jobsFound: number;
  matchesCreated: number;
  errors: SearchRunError[];
};

export type StartSearchResult =
  | { status: "started" | "already-running"; runId: string }
  | { status: "error"; message: string };

export async function startSearch(): Promise<StartSearchResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { status: "error", message: "Your session expired. Sign in again." };

  const connectionCount = await prisma.connection.count({
    where: { userId, companyNorm: { not: "" } },
  });
  if (connectionCount === 0) {
    return {
      status: "error",
      message: "Import your connections first -- there is nobody to look for yet.",
    };
  }

  // Two concurrent runs for one user would do the same work twice and fight
  // over the same Match rows, so an existing run is adopted instead of started.
  const existing = await prisma.searchRun.findFirst({
    where: { userId, status: "running" },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, startedAt: true },
  });

  if (existing) {
    if (!isRunStalled(existing)) return { status: "already-running", runId: existing.id };

    // Past the deadline and still "running": the process that owned it is gone
    // (a deploy, a cold start, a crash). Close it so it stops being polled.
    await prisma.searchRun.update({
      where: { id: existing.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorsJson: JSON.stringify([
          { company: null, reason: "The search stopped unexpectedly and was restarted." },
        ]),
      },
    });
  }

  const runId = await createSearchRun(userId);

  // Runs after the response is sent. Errors are recorded on the run row by
  // executeSearchRun itself, which is the only place the user could see them.
  after(async () => {
    await executeSearchRun(runId, userId);
  });

  return { status: "started", runId };
}

/** One poll. Returns null when the run does not exist or is not this user's. */
export async function getSearchProgress(runId: string): Promise<SearchProgress | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const run = await prisma.searchRun.findFirst({
    // userId in the filter, not just the id: a run id must not reveal another
    // user's search.
    where: { id: runId, userId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      companiesTotal: true,
      companiesChecked: true,
      jobsFound: true,
      matchesCreated: true,
      errorsJson: true,
    },
  });

  if (!run) return null;

  const status = isRunStalled(run)
    ? "failed"
    : (run.status as SearchProgress["status"]);

  const errors = decodeErrors(run.errorsJson);
  if (status === "failed" && errors.length === 0) {
    errors.push({ company: null, reason: "The search stopped unexpectedly. Try again." });
  }

  return {
    runId: run.id,
    status,
    companiesTotal: run.companiesTotal,
    companiesChecked: run.companiesChecked,
    jobsFound: run.jobsFound,
    matchesCreated: run.matchesCreated,
    errors,
  };
}
