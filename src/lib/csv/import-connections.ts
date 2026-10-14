import { canonicalCompanyName } from "@/lib/company/normalize";
import { parseConnectionsCsv, type ParsedConnection } from "@/lib/csv/parse-connections";
import { assertUserId, prisma } from "@/lib/db";

/**
 * Persisting a parsed connections export.
 *
 * Kept apart from the server action so it can be tested against a real database
 * without a request, and apart from the parser so a storage change cannot alter
 * what we believe the file said.
 *
 * The whole import runs in one transaction: a half-written connection list would
 * make the next search quietly incomplete, and the user would have no way to
 * tell. All-or-nothing is the only honest outcome.
 *
 * Note what is *not* stored: the export's `Email Address` column is parsed and
 * then dropped. These are third parties who never agreed to be in this app, the
 * app never contacts them, and it needs no address to draft a message the user
 * sends themselves. Not holding the data is the only way to be sure it cannot
 * leak.
 */

export type ImportSummary = {
  /** Rows in the file, after blank lines. */
  totalRows: number;
  /** Connections now stored for this user, across all uploads. */
  storedTotal: number;
  created: number;
  updated: number;
  skipped: { unnamed: number; duplicate: number };
  /** Stored connections with no company — not matchable to a job board. */
  withoutCompany: number;
  /** Distinct companies represented, which bounds how many boards we check. */
  distinctCompanies: number;
  warnings: { dataRow: number; reason: string }[];
};

/**
 * Rows per `createMany`/update batch. SQLite has a hard limit on bound
 * variables per statement (999 by default), and a 30,000-connection export
 * would blow past it in a single call.
 */
const BATCH_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

type ConnectionRow = {
  userId: string;
  firstName: string;
  lastName: string;
  profileUrl: string | null;
  position: string | null;
  companyRaw: string;
  companyNorm: string;
  connectedOn: Date | null;
};

function toRow(userId: string, parsed: ParsedConnection): ConnectionRow {
  // `companyRaw` is non-nullable in the schema, so a missing company is stored
  // as the empty string. `companyNorm` is then also empty, which is the signal
  // downstream code uses for "cannot be matched".
  const companyRaw = parsed.companyRaw ?? "";

  return {
    userId,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    profileUrl: parsed.profileUrl,
    position: parsed.position,
    companyRaw,
    companyNorm: companyRaw === "" ? "" : canonicalCompanyName(companyRaw),
    connectedOn: parsed.connectedOn,
  };
}

/**
 * Import a connections export for one user.
 *
 * Re-uploads are additive and idempotent: rows matching an existing
 * `[userId, firstName, lastName, companyRaw]` are refreshed rather than
 * duplicated, and rows absent from the new file are left alone. That matters
 * because LinkedIn's export is a snapshot — someone who changed jobs appears
 * under a new company, and deleting the old row would throw away a contact the
 * user still has.
 *
 * @throws {ConnectionsCsvError} from the parser, for anything the user can fix.
 */
export async function importConnectionsCsv(
  userId: string,
  csvText: string,
): Promise<ImportSummary> {
  const id = assertUserId(userId);
  const parsed = parseConnectionsCsv(csvText);
  const rows = parsed.connections.map((connection) => toRow(id, connection));

  const { created, updated } = await prisma.$transaction(
    async (tx) => {
      // Which of these rows we already hold, so the counts we report are real
      // rather than guessed from a create/update fallback.
      const existing = await tx.connection.findMany({
        where: { userId: id },
        select: { firstName: true, lastName: true, companyRaw: true },
      });

      const existingKeys = new Set(
        existing.map((row) => JSON.stringify([row.firstName, row.lastName, row.companyRaw])),
      );

      const fresh: ConnectionRow[] = [];
      const known: ConnectionRow[] = [];

      for (const row of rows) {
        const key = JSON.stringify([row.firstName, row.lastName, row.companyRaw]);
        if (existingKeys.has(key)) known.push(row);
        else fresh.push(row);
      }

      for (const batch of chunk(fresh, BATCH_SIZE)) {
        await tx.connection.createMany({ data: batch });
      }

      // Known rows are refreshed one by one. `updateMany` cannot vary values per
      // row, and a re-export legitimately carries new titles and profile URLs
      // for people whose name and company are unchanged.
      for (const row of known) {
        await tx.connection.update({
          where: {
            userId_firstName_lastName_companyRaw: {
              userId: id,
              firstName: row.firstName,
              lastName: row.lastName,
              companyRaw: row.companyRaw,
            },
          },
          data: {
            profileUrl: row.profileUrl,
            position: row.position,
            companyNorm: row.companyNorm,
            connectedOn: row.connectedOn,
          },
        });
      }

      return { created: fresh.length, updated: known.length };
    },
    // A large export does real work per row; the default 5s timeout is not
    // enough for tens of thousands of them.
    { timeout: 120_000, maxWait: 10_000 },
  );

  const [storedTotal, withoutCompany, distinct] = await Promise.all([
    prisma.connection.count({ where: { userId: id } }),
    prisma.connection.count({ where: { userId: id, companyNorm: "" } }),
    prisma.connection.findMany({
      where: { userId: id, companyNorm: { not: "" } },
      select: { companyNorm: true },
      distinct: ["companyNorm"],
    }),
  ]);

  return {
    totalRows: parsed.totalDataRows,
    storedTotal,
    created,
    updated,
    skipped: parsed.dropped,
    withoutCompany,
    distinctCompanies: distinct.length,
    warnings: parsed.warnings,
  };
}

/**
 * Recompute `companyNorm` for every connection a user has.
 *
 * Needed whenever the normaliser or the alias table changes: stored keys were
 * written by the old rules, and a stale key silently stops matching. Clears
 * `companyId` for rows whose key moved, so resolution runs again rather than
 * trusting a link made under different rules.
 */
export async function renormalizeUserConnections(userId: string): Promise<number> {
  const id = assertUserId(userId);

  const connections = await prisma.connection.findMany({
    where: { userId: id },
    select: { id: true, companyRaw: true, companyNorm: true },
  });

  const changed = connections.flatMap((connection) => {
    const next =
      connection.companyRaw === "" ? "" : canonicalCompanyName(connection.companyRaw);
    return next === connection.companyNorm ? [] : [{ id: connection.id, companyNorm: next }];
  });

  for (const batch of chunk(changed, BATCH_SIZE)) {
    await prisma.$transaction(
      batch.map((row) =>
        prisma.connection.update({
          where: { id: row.id },
          data: { companyNorm: row.companyNorm, companyId: null },
        }),
      ),
    );
  }

  return changed.length;
}
