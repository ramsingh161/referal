import { fetchJson } from "./fetch-with-retry";
import {
  type AtsAdapter,
  type FetchJobsOptions,
  type NormalizedJob,
  assertValidToken,
  collectJobs,
  dateOrNull,
  isValidToken,
  joinLocation,
  looksRemote,
  textOrNull,
} from "./types";

/**
 * Workable — `apply.workable.com/api/v1/widget/accounts/{token}`.
 *
 * Postings are keyed by `shortcode`, not an id, and the remote flag is called
 * `telecommuting`. Location arrives as separate city / state / country fields
 * rather than one string.
 *
 * An unknown account 404s while a real account with nothing open returns
 * `{"name":…,"jobs":[]}`, so a 200 here is proof the token is real — which is
 * what lets the slug probe trust this provider.
 */

type WorkableJob = {
  title?: unknown;
  shortcode?: unknown;
  department?: unknown;
  url?: unknown;
  shortlink?: unknown;
  application_url?: unknown;
  published_on?: unknown;
  created_at?: unknown;
  telecommuting?: unknown;
  city?: unknown;
  state?: unknown;
  country?: unknown;
};

type WorkableResponse = {
  name?: unknown;
  jobs?: unknown;
};

/**
 * Path segments that are Workable's own routes rather than an account slug.
 * `apply.workable.com/j/{shortcode}` is a single posting, so parsing "j" as a
 * board token would produce a company bound to a board that does not exist.
 */
const RESERVED_SEGMENTS = new Set(["j", "api", "assets", "backend", "auth"]);

export const workableAdapter: AtsAdapter = {
  provider: "workable",
  label: "Workable",
  emptyBoardProvesToken: true,

  boardUrl(token) {
    return `https://apply.workable.com/${token}/`;
  },

  parseBoardUrl(url) {
    if (!/(^|\.)workable\.com$/i.test(url.hostname)) return null;

    const segments = url.pathname.split("/").filter(Boolean);

    // API form: /api/v1/widget/accounts/{token}
    const accountsAt = segments.indexOf("accounts");
    if (accountsAt >= 0) {
      const token = segments[accountsAt + 1];
      return token && isValidToken(token) ? token : null;
    }

    const token = segments[0];
    if (!token || RESERVED_SEGMENTS.has(token.toLowerCase()) || !isValidToken(token)) {
      return null;
    }
    return token;
  },

  async fetchJobs(token, options: FetchJobsOptions = {}): Promise<NormalizedJob[]> {
    assertValidToken(token);

    const data = await fetchJson<WorkableResponse>(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`,
      { signal: options.signal },
    );

    const jobs = Array.isArray(data?.jobs) ? (data.jobs as WorkableJob[]) : [];

    return collectJobs(`workable/${token}`, jobs, (job) => {
      const title = textOrNull(job.title);
      const shortcode = textOrNull(job.shortcode);
      const url = textOrNull(job.shortlink) ?? textOrNull(job.url);
      if (!title || !shortcode || !url) return null;

      const location = joinLocation(job.city, job.state, job.country);

      return {
        source: "workable",
        externalId: `${token}:${shortcode}`,
        title,
        location,
        remote: job.telecommuting === true || looksRemote(location),
        department: textOrNull(job.department),
        // `published_on` is a bare YYYY-MM-DD, which Date parses as UTC midnight.
        postedAt: dateOrNull(job.published_on) ?? dateOrNull(job.created_at),
        url,
      };
    });
  },
};
