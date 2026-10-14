import { fetchJson } from "./fetch-with-retry";
import {
  type AtsAdapter,
  type FetchJobsOptions,
  type NormalizedJob,
  assertValidToken,
  collectJobs,
  dateOrNull,
  isValidToken,
  looksRemote,
  textOrNull,
} from "./types";

/**
 * Ashby — `api.ashbyhq.com/posting-api/job-board/{token}`.
 *
 * The cleanest of the five: real field names, an explicit `isRemote`, and an ISO
 * `publishedAt`. The one trap is `isListed` — a board can contain postings it
 * does not publish, and showing a user a role that isn't on the public board
 * would send them to a dead link.
 */

type AshbyJob = {
  id?: unknown;
  title?: unknown;
  department?: unknown;
  team?: unknown;
  location?: unknown;
  publishedAt?: unknown;
  isListed?: unknown;
  isRemote?: unknown;
  jobUrl?: unknown;
  applyUrl?: unknown;
};

type AshbyResponse = {
  jobs?: unknown;
};

export const ashbyAdapter: AtsAdapter = {
  provider: "ashby",
  label: "Ashby",
  emptyBoardProvesToken: true,

  boardUrl(token) {
    return `https://jobs.ashbyhq.com/${token}`;
  },

  parseBoardUrl(url) {
    if (!/(^|\.)ashbyhq\.com$/i.test(url.hostname)) return null;

    const segments = url.pathname.split("/").filter(Boolean);

    // API form: /posting-api/job-board/{token}
    if (segments[0] === "posting-api" && segments[1] === "job-board" && segments[2]) {
      return isValidToken(segments[2]) ? segments[2] : null;
    }

    const token = segments[0];
    if (!token || !isValidToken(token)) return null;
    return token;
  },

  async fetchJobs(token, options: FetchJobsOptions = {}): Promise<NormalizedJob[]> {
    assertValidToken(token);

    const data = await fetchJson<AshbyResponse>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
      { signal: options.signal },
    );

    const jobs = Array.isArray(data?.jobs) ? (data.jobs as AshbyJob[]) : [];

    return collectJobs(`ashby/${token}`, jobs, (job) => {
      // Only `false` excludes it. An absent flag means an older board shape, and
      // dropping those postings would be worse than trusting them.
      if (job.isListed === false) return null;

      const title = textOrNull(job.title);
      const id = textOrNull(job.id);
      const url = textOrNull(job.jobUrl) ?? textOrNull(job.applyUrl);
      if (!title || !id || !url) return null;

      const location = textOrNull(job.location);

      return {
        source: "ashby",
        externalId: `${token}:${id}`,
        title,
        location,
        remote: job.isRemote === true || looksRemote(location),
        department: textOrNull(job.department) ?? textOrNull(job.team),
        url,
        postedAt: dateOrNull(job.publishedAt),
      };
    });
  },
};
