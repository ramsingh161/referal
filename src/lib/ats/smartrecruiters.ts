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
 * SmartRecruiters — `api.smartrecruiters.com/v1/companies/{token}/postings`.
 *
 * The odd one out, in three ways:
 *
 *   1. It PAGINATES. `limit` silently caps at 100 (ask for 200, get 100 back
 *      with no error), so a company with more than 100 open roles needs a loop
 *      over `offset` against `totalFound`. The other four return everything at
 *      once.
 *
 *   2. It cannot be slug-probed. A nonsense token returns 200 with
 *      `{"totalFound":0,"content":[]}`, byte-identical to a real company with
 *      nothing open — so `emptyBoardProvesToken` is false, and the resolver must
 *      never record a negative from an empty result here.
 *
 *   3. Its `ref` field is an API URL, not a careers page. The human-facing link
 *      is `jobs.smartrecruiters.com/{identifier}/{id}`, built by hand below.
 *
 * Title is `name`. `department` arrives as `{}` when unset — an empty object,
 * not null — so `textOrNull(department?.label)` guards it.
 */

/** Provider caps a page at 100 regardless of what we ask. */
const PAGE_SIZE = 100;

/**
 * Stop after this many pages even if `totalFound` claims more. 25 pages is 2,500
 * open roles at one company — past that it is an aggregator, not an employer a
 * user has a personal contact at, and the tail is not worth the requests.
 */
const MAX_PAGES = 25;

type SmartRecruitersPosting = {
  id?: unknown;
  name?: unknown;
  releasedDate?: unknown;
  company?: { identifier?: unknown } | null;
  location?: {
    city?: unknown;
    region?: unknown;
    country?: unknown;
    remote?: unknown;
    fullLocation?: unknown;
  } | null;
  department?: { label?: unknown } | null;
  function?: { label?: unknown } | null;
};

type SmartRecruitersResponse = {
  offset?: unknown;
  limit?: unknown;
  totalFound?: unknown;
  content?: unknown;
};

export const smartRecruitersAdapter: AtsAdapter = {
  provider: "smartrecruiters",
  label: "SmartRecruiters",
  emptyBoardProvesToken: false,

  boardUrl(token) {
    return `https://jobs.smartrecruiters.com/${token}`;
  },

  parseBoardUrl(url) {
    if (!/(^|\.)smartrecruiters\.com$/i.test(url.hostname)) return null;

    const segments = url.pathname.split("/").filter(Boolean);

    // API form: /v1/companies/{token}/postings
    if (segments[0] === "v1" && segments[1] === "companies" && segments[2]) {
      return isValidToken(segments[2]) ? segments[2] : null;
    }

    // Board form: jobs.smartrecruiters.com/{identifier}[/...]
    const token = segments[0];
    if (!token || !isValidToken(token)) return null;
    return token;
  },

  async fetchJobs(token, options: FetchJobsOptions = {}): Promise<NormalizedJob[]> {
    assertValidToken(token);

    const encoded = encodeURIComponent(token);
    const collected: SmartRecruitersPosting[] = [];
    let identifier = token;

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const data = await fetchJson<SmartRecruitersResponse>(
        `https://api.smartrecruiters.com/v1/companies/${encoded}/postings?limit=${PAGE_SIZE}&offset=${offset}`,
        { signal: options.signal },
      );

      const content = Array.isArray(data?.content)
        ? (data.content as SmartRecruitersPosting[])
        : [];
      if (content.length === 0) break;

      // The response echoes the canonical identifier casing; prefer it for URLs.
      const first = content[0]?.company?.identifier;
      if (typeof first === "string" && first.length > 0) identifier = first;

      collected.push(...content);

      const totalFound = typeof data?.totalFound === "number" ? data.totalFound : 0;
      if (collected.length >= totalFound) break;
      if (content.length < PAGE_SIZE) break;

      if (page === MAX_PAGES - 1) {
        console.warn(
          `[ats] smartrecruiters/${token}: stopped at ${MAX_PAGES} pages with ${totalFound} reported`,
        );
      }
    }

    return collectJobs(`smartrecruiters/${token}`, collected, (posting) => {
      const title = textOrNull(posting.name);
      const id = textOrNull(posting.id);
      if (!title || !id) return null;

      const location = posting.location ?? null;
      const locationText =
        textOrNull(location?.fullLocation) ??
        joinLocation(location?.city, location?.region, location?.country);

      return {
        source: "smartrecruiters",
        externalId: `${token}:${id}`,
        title,
        location: locationText,
        remote: location?.remote === true || looksRemote(locationText),
        department: textOrNull(posting.department?.label) ?? textOrNull(posting.function?.label),
        url: `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${encodeURIComponent(id)}`,
        postedAt: dateOrNull(posting.releasedDate),
      };
    });
  },
};
