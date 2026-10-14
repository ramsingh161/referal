import "dotenv/config";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { canonicalCompanyName } from "../src/lib/company/normalize.ts";
import { loadRegistry } from "../src/lib/company/registry.ts";

/**
 * Seeds the shared Company table from prisma/data/ats-registry.json.
 *
 * Run by `prisma db seed` as `node prisma/seed.ts` (see prisma.config.ts), so
 * every import in this file's graph must use an explicit `.ts` path and avoid
 * the `@/` alias — Node resolves it directly, without Next's bundler. That is
 * why it constructs its own PrismaClient rather than importing src/lib/db.ts.
 *
 * The seed is offline and idempotent. It trusts the registry file; correctness
 * of the tokens is enforced separately by registry.live.test.ts, keeping the
 * seed fast and runnable in CI with no network.
 */

function createAdapter() {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  if (url.startsWith("file:") || url === ":memory:") {
    return new PrismaBetterSqlite3({ url });
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return new PrismaPg({ connectionString: url });
  }
  throw new Error(`Unsupported DATABASE_URL scheme for seed: ${url.split(":")[0]}:`);
}

async function main() {
  const prisma = new PrismaClient({ adapter: createAdapter() });
  const entries = loadRegistry();

  let created = 0;
  let updated = 0;
  const now = new Date();

  try {
    for (const entry of entries) {
      const nameNorm = canonicalCompanyName(entry.name);
      if (!nameNorm) {
        console.warn(`[seed] skipping "${entry.name}": normalises to empty`);
        continue;
      }

      // Registry entries are trusted positives, so they never expire; lastProbedAt
      // is set only for the record of when it was last confirmed.
      const data = {
        displayName: entry.name,
        atsProvider: entry.provider,
        atsToken: entry.token,
        resolveStatus: "resolved",
        lastProbedAt: now,
      };

      const before = await prisma.company.findUnique({
        where: { nameNorm },
        select: { id: true },
      });
      await prisma.company.upsert({
        where: { nameNorm },
        create: { nameNorm, ...data },
        update: data,
      });
      if (before) updated++;
      else created++;
    }

    console.log(
      `[seed] ats-registry: ${created} created, ${updated} updated (${entries.length} entries).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[seed] failed:", error);
  process.exit(1);
});
