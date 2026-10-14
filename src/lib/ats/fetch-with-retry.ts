import { AtsError } from "./types";

/**
 * The one HTTP call every adapter makes.
 *
 * Public job boards are free and unauthenticated, which makes it easy to be a
 * bad citizen: a single search fans out over every company in a user's network,
 * so this module is where politeness is enforced rather than left to each
 * adapter's discretion.
 *
 * Three rules:
 *   - Identify ourselves. A board owner who wants to block us should be able to,
 *     and should be able to find out who we are first.
 *   - Retry only what retrying can fix. 404 is an answer; 503 is not.
 *   - Always time out. A board that hangs must not hold a search run open.
 */

/**
 * Sent on every request. A real product name and a contact route, because an
 * anonymous scraper-shaped User-Agent is what gets an IP range banned.
 * Override in production with the deployed URL.
 */
const DEFAULT_USER_AGENT =
  "ReferralFinder/0.1 (job-referral matching for individual job seekers; +https://github.com/referral-finder)";

function userAgent(): string {
  return process.env.ATS_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
}

/** Per-attempt, not per-call. Boards are usually fast; a slow one is broken. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Attempts after the first. Three total tries is enough for a blip. */
const DEFAULT_RETRIES = 2;

const BASE_BACKOFF_MS = 500;

/** Ignore an absurd Retry-After — a search cannot wait five minutes. */
const MAX_BACKOFF_MS = 8_000;

/**
 * Refuse to buffer an unreasonable response. The probe layer sends requests to
 * URLs derived from user-supplied company names, so "the other end is
 * well-behaved" is an assumption worth not making. Greenhouse's largest real
 * board is ~4 MB.
 */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export type FetchJsonOptions = {
  timeoutMs?: number;
  retries?: number;
  /** Caller's cancellation, e.g. an abandoned search run. */
  signal?: AbortSignal;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AtsError("unavailable", "Cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new AtsError("unavailable", "Cancelled"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * How long to wait before retrying. Honours Retry-After when the server sent
 * one, otherwise exponential with full jitter — without jitter, a search that
 * fans out over 200 companies would retry all of them in the same instant and
 * reproduce the burst that caused the 429.
 */
function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) {
      const delta = asDate - Date.now();
      if (delta > 0) return Math.min(delta, MAX_BACKOFF_MS);
    }
  }

  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

function classifyStatus(status: number, url: string): AtsError {
  if (status === 404 || status === 410) {
    return new AtsError("not_found", `No board at ${url}`, status);
  }
  if (status === 429) {
    return new AtsError("rate_limited", `Rate limited by ${url}`, status);
  }
  if (status >= 500) {
    return new AtsError("unavailable", `Board provider error ${status} at ${url}`, status);
  }
  // 401/403 on a public board means the board is not public — for our purposes
  // that is the same outcome as no board, but it is not the same fact, so it
  // stays inconclusive and will be retried by the caller another day.
  return new AtsError("unavailable", `Unexpected ${status} from ${url}`, status);
}

/**
 * GET (or POST) a board endpoint and parse JSON, with timeout and retry.
 *
 * Always rejects with {@link AtsError} so callers can branch on `kind` instead
 * of pattern-matching error messages.
 */
export async function fetchJson<T = unknown>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    signal,
    method = "GET",
    body,
    headers,
  } = options;

  let lastError: AtsError = new AtsError("unavailable", `No attempt made for ${url}`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new AtsError("unavailable", "Cancelled");

    // Per-attempt timeout, combined with the caller's cancellation so an
    // abandoned search run stops mid-flight instead of running to completion.
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        body,
        signal: combined,
        redirect: "follow",
        headers: {
          "User-Agent": userAgent(),
          Accept: "application/json",
          ...headers,
        },
      });
    } catch (cause) {
      // DNS failures, resets, and timeouts land here. None of them say anything
      // about whether the board exists.
      if (signal?.aborted) throw new AtsError("unavailable", "Cancelled");
      const reason = cause instanceof Error ? cause.message : String(cause);
      lastError = new AtsError(
        "unavailable",
        timeout.aborted ? `Timed out after ${timeoutMs}ms: ${url}` : `Network error: ${reason}`,
      );
      if (attempt < retries) {
        await sleep(backoffMs(attempt, null), signal);
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const error = classifyStatus(response.status, url);

      // A conclusive answer is not worth asking again.
      if (error.isConclusive) throw error;

      lastError = error;
      if (attempt < retries) {
        await sleep(backoffMs(attempt, response.headers.get("retry-after")), signal);
        continue;
      }
      throw error;
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      // Not retryable: it will be just as large next time.
      throw new AtsError(
        "bad_response",
        `Response from ${url} is ${declaredLength} bytes, over the ${MAX_RESPONSE_BYTES} limit`,
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      lastError = new AtsError("unavailable", `Truncated response from ${url}: ${reason}`);
      if (attempt < retries) {
        await sleep(backoffMs(attempt, null), signal);
        continue;
      }
      throw lastError;
    }

    if (text.length > MAX_RESPONSE_BYTES) {
      throw new AtsError("bad_response", `Response from ${url} exceeded the size limit`);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      // 200 with HTML in the body is how some providers serve a parked domain
      // or an error page. Not retryable, and definitely not a board.
      throw new AtsError(
        "bad_response",
        `${url} returned ${response.status} but the body is not JSON`,
      );
    }
  }

  throw lastError;
}
