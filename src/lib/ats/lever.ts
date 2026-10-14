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
 * Lever — `api.lever.co/v0/postings/{token}`.
 *
 * The response is a bare array, and the title lives in `text` rather than
 * `title`. `categories` carries department, team, and locations; `workplaceType`
 * is one of `onsite` | `hybrid` | `remote`, which makes Lever one of the three
 * providers that answers the remote question honestly.
 */

type LeverPosting = {
  id?: unknown;
  text?: unknown;
  hostedUrl?: unknown;
  applyUrl?: unknown;
  createdAt?: unknown;
  workplaceType?: unknown;
  country?: unknown;
  categories?: {
    department?: unknown;
    team?: unknown;
    location?: unknown;
    allLocations?: unknown;
  } | null;
};

export const leverAdapter: AtsAdapter = {
  provider: "lever",
  label: "Lever",
  emptyBoardProvesToken: true,

  boardUrl(token) {
    return `https://jobs.lever.co/${token}`;
  },

  parseBoardUrl(url) {
    if (!/(^|\.)lever\.co$/i.test(url.hostname)) return null;

    const segments = url.pathname.split("/").filter(Boolean);

    // API form: /v0/postings/{token}
    if (segments[0] === "v0" && segments[1] === "postings" && segments[2]) {
      return isValidToken(segments[2]) ? segments[2] : null;
    }

    const token = segments[0];
    if (!token || !isValidToken(token)) return null;
    return token;
  },

  async fetchJobs(token, options: FetchJobsOptions = {}): Promise<NormalizedJob[]> {
    assertValidToken(token);

    const data = await fetchJson<unknown>(
      `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
      { signal: options.signal },
    );

    const postings = Array.isArray(data) ? (data as LeverPosting[]) : [];

    return collectJobs(`lever/${token}`, postings, (posting) => {
      const title = textOrNull(posting.text);
      const id = textOrNull(posting.id);
      const url = textOrNull(posting.hostedUrl) ?? textOrNull(posting.applyUrl);
      if (!title || !id || !url) return null;

      const categories = posting.categories ?? {};
      const allLocations = Array.isArray(categories.allLocations)
        ? categories.allLocations.filter((value): value is string => typeof value === "string")
        : [];

      const location =
        joinLocation(...allLocations) ?? textOrNull(categories.location) ?? null;

      const workplaceType = textOrNull(posting.workplaceType)?.toLowerCase();

      return {
        source: "lever",
        externalId: `${token}:${id}`,
        title,
        location,
        remote: workplaceType === "remote" || looksRemote(location),
        department: textOrNull(categories.department) ?? textOrNull(categories.team),
        url,
        // Epoch milliseconds, not a string.
        postedAt: dateOrNull(posting.createdAt),
      };
    });
  },
};
