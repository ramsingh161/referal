import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 requires a driver adapter — the connection URL no longer lives in
 * schema.prisma. We pick the adapter from the URL scheme so that moving from
 * local SQLite to production Postgres is purely an environment change here,
 * with only `provider` in prisma/schema.prisma to update alongside it.
 */
function createAdapter() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
    );
  }

  if (url.startsWith("file:") || url === ":memory:") {
    // The better-sqlite3 adapter strips the `file:` prefix itself and resolves
    // the remaining relative path against process.cwd() — which matches how the
    // Prisma CLI resolves it from prisma.config.ts at the project root. Both
    // therefore agree on prisma/dev.db.
    return new PrismaBetterSqlite3({ url });
  }

  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return new PrismaPg({ connectionString: url });
  }

  throw new Error(
    `Unsupported DATABASE_URL scheme: ${url.split(":")[0]}:. Expected file: or postgres:.`,
  );
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: createAdapter(),
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

/**
 * Next.js dev mode hot-reloads modules on every edit. Without stashing the
 * client on globalThis, each reload would open a new connection pool and
 * eventually exhaust the database's connection limit.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// ---------------------------------------------------------------------------
// Privacy helpers
//
// Connection rows describe people who are NOT users of this app. Every read or
// write against them must be scoped to the owning user. These helpers exist so
// that intent is explicit at the call site rather than relying on each caller
// to remember a `where: { userId }` clause.
// ---------------------------------------------------------------------------

/**
 * Guards against the classic bug where an undefined session silently becomes
 * `where: { userId: undefined }` — which Prisma treats as "no filter" and would
 * return every user's connections.
 */
export function assertUserId(userId: string | undefined | null): string {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("Expected an authenticated user id, got none.");
  }
  return userId;
}

/**
 * Hard-deletes everything the app holds about a user, for the "delete all my
 * data" control in settings. Connections, matches, asks, search runs and the
 * auth rows all cascade from User, so this is deliberately a single delete
 * rather than a hand-maintained list that could drift from the schema.
 *
 * Global Company/JobPosting rows are intentionally NOT touched: they contain no
 * personal data and are shared infrastructure for every other user.
 */
export async function deleteAllUserData(userId: string): Promise<void> {
  const id = assertUserId(userId);
  await prisma.user.delete({ where: { id } });
}

/**
 * Deletes a user's connection graph and derived matches while keeping their
 * account and preferences — used when re-uploading a fresh LinkedIn export.
 */
export async function clearUserConnections(userId: string): Promise<void> {
  const id = assertUserId(userId);
  await prisma.$transaction([
    prisma.match.deleteMany({ where: { userId: id } }),
    prisma.connection.deleteMany({ where: { userId: id } }),
  ]);
}
