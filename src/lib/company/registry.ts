import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isAtsProvider, isValidToken, type AtsProvider } from "../ats/types.ts";

/**
 * Loader for prisma/data/ats-registry.json, shared by the seed (which runs under
 * raw `node prisma/seed.ts`) and the live audit test (which runs under vitest).
 *
 * The explicit `.ts` import specifier above is deliberate: the seed resolves
 * this module graph directly through Node, without the bundler that lets the
 * rest of src/ omit extensions. `../ats/types.ts` is import-free, so nothing
 * extensionless is pulled in transitively.
 */

export type RegistryEntry = {
  /** Display name as a human recognises it; also the source of `nameNorm`. */
  name: string;
  provider: AtsProvider;
  /** Board slug within that provider — kept verbatim (SmartRecruiters is case-sensitive). */
  token: string;
  /** True only for tokens confirmed against a live board (registry.live.test.ts). */
  verified: boolean;
};

const REGISTRY_URL = new URL("../../../prisma/data/ats-registry.json", import.meta.url);

export function loadRegistry(): RegistryEntry[] {
  const parsed = JSON.parse(readFileSync(fileURLToPath(REGISTRY_URL), "utf8")) as unknown;
  const rows = (parsed as { companies?: unknown }).companies;
  if (!Array.isArray(rows)) {
    throw new Error("ats-registry.json: expected a top-level `companies` array");
  }
  return rows.map(parseEntry);
}

// A curated file is code: a malformed entry is a bug worth failing loudly on,
// not a row to silently drop and wonder later why a company never resolves.
function parseEntry(row: unknown, index: number): RegistryEntry {
  const entry = (row ?? {}) as Record<string, unknown>;
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const token = typeof entry.token === "string" ? entry.token : "";

  if (!name) throw new Error(`ats-registry.json[${index}]: missing name`);
  if (!isAtsProvider(entry.provider)) {
    throw new Error(`ats-registry.json[${index}] (${name}): unknown provider ${String(entry.provider)}`);
  }
  if (!isValidToken(token)) {
    throw new Error(`ats-registry.json[${index}] (${name}): invalid token ${String(entry.token)}`);
  }

  return { name, provider: entry.provider, token, verified: entry.verified === true };
}
