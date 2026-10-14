import { ashbyAdapter } from "./ashby";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { smartRecruitersAdapter } from "./smartrecruiters";
import { workableAdapter } from "./workable";
import {
  type AtsAdapter,
  type AtsProvider,
  type FetchJobsOptions,
  type NormalizedJob,
  ATS_PROVIDERS,
  isAtsProvider,
} from "./types";

/**
 * The provider registry. Everything outside `src/lib/ats` addresses boards
 * through this file and the `AtsProvider` string, never by importing an adapter
 * directly — so adding a sixth provider is one line here plus its adapter.
 */

const ADAPTERS: Record<AtsProvider, AtsAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  workable: workableAdapter,
  smartrecruiters: smartRecruitersAdapter,
};

/** Probe order. The four that 404 on unknown tokens come first; SmartRecruiters
 *  cannot be probed at all (see its adapter), so it is last and only ever
 *  resolved from the seed registry or a pasted URL. */
export const PROBE_ORDER: readonly AtsProvider[] = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
];

export function getAdapter(provider: AtsProvider): AtsAdapter {
  return ADAPTERS[provider];
}

export function getAdapterOrNull(provider: string): AtsAdapter | null {
  return isAtsProvider(provider) ? ADAPTERS[provider] : null;
}

export function allAdapters(): readonly AtsAdapter[] {
  return ATS_PROVIDERS.map((provider) => ADAPTERS[provider]);
}

/**
 * Fetch open roles for a `{provider, token}` binding.
 *
 * A thin pass-through, but it keeps callers from having to hold an adapter
 * reference and re-validate the provider string themselves.
 */
export function fetchJobs(
  provider: AtsProvider,
  token: string,
  options?: FetchJobsOptions,
): Promise<NormalizedJob[]> {
  return ADAPTERS[provider].fetchJobs(token, options);
}

export type ParsedBoardUrl = { provider: AtsProvider; token: string };

/**
 * Turn a careers-page or board URL the user pasted into a `{provider, token}`,
 * or null if it belongs to no provider we support.
 *
 * This is the manual-override escape hatch: when the slug probe can't find a
 * company's board (or, for SmartRecruiters, is structurally unable to), the user
 * pastes the URL and we parse it here. Each adapter owns the shape of its own
 * URLs; this only dispatches.
 */
export function parseBoardUrl(input: string): ParsedBoardUrl | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  for (const adapter of allAdapters()) {
    const token = adapter.parseBoardUrl(url);
    if (token) return { provider: adapter.provider, token };
  }

  return null;
}

export {
  type AtsAdapter,
  type AtsProvider,
  type NormalizedJob,
  type FetchJobsOptions,
  ATS_PROVIDERS,
  isAtsProvider,
} from "./types";
export { AtsError } from "./types";
