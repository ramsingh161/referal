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
 * Greenhouse — `boards-api.greenhouse.io`.
 *
 * Returns every posting in one response, so no pagination.
 *
 * Deliberately fetched WITHOUT `?content=true`. That parameter is the only way
 * to get each job's `departments`, but it also inlines the full HTML job
 * description: Stripe's board is 364 KB plain and 4.4 MB with content, and a
 * search fans out over a user's whole network. The department would be a weak
 * signal anyway — Greenhouse departments are internal cost centres, and
 * Stripe's read `1130 Global Sales Development Mgrs`, which matches nothing in
 * a connection's job title. Expensive and near-useless, so `department` is null
 * here and the ranker leans on the other signals for Greenhouse boards.
 */

type GreenhouseJob = {
  id?: unknown;
  title?: unknown;
  absolute_url?: unknown;
  location?: { name?: unknown } | null;
  first_published?: unknown;
  updated_at?: unknown;
};

type GreenhouseResponse = {
  jobs?: unknown;
};

export const greenhouseAdapter: AtsAdapter = {
  provider: "greenhouse",
  label: "Greenhouse",
  emptyBoardProvesToken: true,

  boardUrl(token) {
    return `https://job-boards.greenhouse.io/${token}`;
  },

  parseBoardUrl(url) {
    if (!/(^|\.)greenhouse\.io$/i.test(url.hostname)) return null;

    const segments = url.pathname.split("/").filter(Boolean);

    // API form: /v1/boards/{token}/jobs
    if (segments[0] === "v1" && segments[1] === "boards" && segments[2]) {
      return isValidToken(segments[2]) ? segments[2] : null;
    }

    // Board form: job-boards.greenhouse.io/{token} or boards.greenhouse.io/{token}
    const token = segments[0];
    if (!token || token === "embed" || !isValidToken(token)) return null;
    return token;
  },

  async fetchJobs(token, options: FetchJobsOptions = {}): Promise<NormalizedJob[]> {
    assertValidToken(token);

    const data = await fetchJson<GreenhouseResponse>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
      { signal: options.signal },
    );

    const jobs = Array.isArray(data?.jobs) ? (data.jobs as GreenhouseJob[]) : [];

    return collectJobs(`greenhouse/${token}`, jobs, (job) => {
      const title = textOrNull(job.title);
      const url = textOrNull(job.absolute_url);
      const id = job.id;
      if (!title || !url || (typeof id !== "number" && typeof id !== "string")) return null;

      const location = textOrNull(job.location?.name);

      return {
        source: "greenhouse",
        externalId: `${token}:${id}`,
        title,
        location,
        // Greenhouse ships no remote flag, so the location string is all there is.
        remote: looksRemote(location),
        department: null,
        url,
        postedAt: dateOrNull(job.first_published) ?? dateOrNull(job.updated_at),
      };
    });
  },
};
