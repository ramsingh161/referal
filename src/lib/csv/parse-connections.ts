import Papa from "papaparse";

/**
 * Parser for LinkedIn's official `Connections.csv` export.
 *
 * This file is the app's only source of connection data — LinkedIn exposes no
 * API for it — so the parser has to be forgiving about the real shape of real
 * exports rather than an idealised one. Known quirks, all handled below:
 *
 *   1. A `Notes:` preamble sits above the header row. Its length has varied
 *      across export versions, so the header row is *found*, never skipped by
 *      a hardcoded count.
 *   2. UTF-8 BOM on the first byte.
 *   3. CRLF line endings.
 *   4. Quoted fields containing commas: `"Acme, Inc."`.
 *   5. `Email Address` is usually blank (most members don't share it).
 *   6. `Company` and `Position` are frequently blank.
 *   7. `Connected On` reads `21 Mar 2023`, not ISO.
 *   8. Duplicate rows for the same person at the same company.
 *
 * Company *normalisation* is deliberately not done here — this module's job is
 * to turn bytes into rows faithfully. `src/lib/company/normalize.ts` owns the
 * lossy transformations, so a bad normalisation rule can never corrupt what we
 * believe the file said.
 */

/** One usable row from the export. */
export type ParsedConnection = {
  firstName: string;
  lastName: string;
  /** `firstName` and `lastName` joined; convenient for display and drafting. */
  fullName: string;
  /** Verbatim company text. Blank cells become `null`, never `""`. */
  companyRaw: string | null;
  position: string | null;
  profileUrl: string | null;
  email: string | null;
  /** UTC midnight on the connection date, or `null` if unparseable. */
  connectedOn: Date | null;
};

export type ParseWarning = {
  /** 1-based position among data rows, which is what a user can count to. */
  dataRow: number;
  reason: string;
};

export type ParseConnectionsResult = {
  connections: ParsedConnection[];
  /** Non-empty rows below the header, before any filtering. */
  totalDataRows: number;
  /** Rows dropped, by cause. `connections.length + dropped = totalDataRows`. */
  dropped: {
    /** No first or last name — not a person we can name in an ask. */
    unnamed: number;
    /** Same person, same company, already seen. */
    duplicate: number;
  };
  /** Kept rows with no company. They can't be matched to a job board. */
  withoutCompany: number;
  /** 0-based index of the detected header row, for diagnostics. */
  headerRowIndex: number;
  warnings: ParseWarning[];
};

/**
 * Thrown when the file isn't a connections export at all. Separate from a
 * generic Error so the upload UI can show the message directly — every message
 * below is written to be read by a user, not a developer.
 */
export class ConnectionsCsvError extends Error {
  override name = "ConnectionsCsvError";
}

/**
 * LinkedIn caps a member at 30,000 connections, so anything approaching double
 * that is a different kind of file. Refusing beats spending minutes parsing it.
 */
const MAX_DATA_ROWS = 60_000;

/** How far down to look for the header before giving up. */
const HEADER_SEARCH_LIMIT = 25;

/**
 * Warnings are for the user to skim, not an exhaustive log, and the result
 * crosses a server-action boundary. Keep the first few and stop.
 */
const MAX_WARNINGS = 50;

/**
 * Accepted spellings per column, normalised the same way header cells are.
 *
 * LinkedIn emits English headers even for non-English accounts, which is why
 * the English spellings come first. The extra entries cost nothing and cover
 * hand-edited or re-saved files (Excel likes to rename `Email Address`).
 */
const COLUMN_SYNONYMS = {
  firstName: ["first name", "firstname", "given name"],
  lastName: ["last name", "lastname", "surname", "family name"],
  profileUrl: ["url", "profile url", "public profile url", "linkedin url"],
  email: ["email address", "email", "e mail address", "e mail", "emailaddress"],
  company: ["company", "company name", "current company", "organization"],
  position: ["position", "title", "job title", "current position", "headline"],
  connectedOn: ["connected on", "connected", "connection date", "date connected"],
} as const satisfies Record<string, readonly string[]>;

type ColumnKey = keyof typeof COLUMN_SYNONYMS;

type ColumnMap = Partial<Record<ColumnKey, number>>;

/**
 * Fold a header cell down to bare words so `"Email Address"`, `email_address`
 * and `E-Mail Address` all collide.
 */
function normalizeHeaderCell(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesColumn(cell: string, key: ColumnKey): boolean {
  return (COLUMN_SYNONYMS[key] as readonly string[]).includes(cell);
}

/**
 * Locate the header row.
 *
 * The test is "has a first-name column *and* a last-name or company column".
 * A single match would be too loose: the `Notes:` paragraph mentions email
 * addresses, and matching it would shift every column by several rows.
 */
function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, HEADER_SEARCH_LIMIT);

  for (let index = 0; index < limit; index += 1) {
    const cells = (rows[index] ?? []).map(normalizeHeaderCell);
    if (!cells.some((cell) => matchesColumn(cell, "firstName"))) continue;

    const hasSecondSignal = cells.some(
      (cell) => matchesColumn(cell, "lastName") || matchesColumn(cell, "company"),
    );
    if (hasSecondSignal) return index;
  }

  return -1;
}

function buildColumnMap(headerRow: string[]): ColumnMap {
  const cells = headerRow.map(normalizeHeaderCell);
  const map: ColumnMap = {};

  for (const key of Object.keys(COLUMN_SYNONYMS) as ColumnKey[]) {
    const index = cells.findIndex((cell) => matchesColumn(cell, key));
    if (index !== -1) map[key] = index;
  }

  return map;
}

/** Read a cell as trimmed text, or `null` when absent or blank. */
function cell(row: string[], index: number | undefined): string | null {
  if (index === undefined) return null;
  const value = row[index];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Build a UTC date, rejecting values `Date` would silently roll over (there is
 * no 31 February, and turning it into 3 March would be a quiet lie).
 */
function utcDate(year: number, monthIndex: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, monthIndex, day));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === monthIndex &&
    date.getUTCDate() === day;
  return roundTrips ? date : null;
}

function monthFrom(name: string): number | undefined {
  return MONTH_INDEX[name.slice(0, 3).toLowerCase()];
}

/**
 * Parse `Connected On`. UTC midnight, so the calendar day never shifts with the
 * server's timezone — the value only feeds recency ranking, where a one-day
 * drift is harmless but a systematic one is not.
 */
export function parseConnectedOn(raw: string | null): Date | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value === "") return null;

  // LinkedIn's own format: "21 Mar 2023".
  const dmy = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(value);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    const month = monthFrom(dmy[2]);
    if (month !== undefined) {
      return utcDate(Number(dmy[3]), month, Number(dmy[1]));
    }
  }

  // "Mar 21, 2023" — produced when Excel re-saves the file.
  const mdy = /^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/.exec(value);
  if (mdy?.[1] && mdy[2] && mdy[3]) {
    const month = monthFrom(mdy[1]);
    if (month !== undefined) {
      return utcDate(Number(mdy[3]), month, Number(mdy[2]));
    }
  }

  // ISO, with or without a time component.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso?.[1] && iso[2] && iso[3]) {
    return utcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  return null;
}

/**
 * Only keep profile URLs that are actually URLs. A stray value here would end
 * up as an `href` in the UI.
 */
function cleanProfileUrl(raw: string | null): string | null {
  if (raw === null) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}

/**
 * Identity key for de-duplication, matching the `[userId, firstName, lastName,
 * companyRaw]` unique constraint on `Connection` so the database can never
 * reject an insert this parser allowed through.
 *
 * Compared case-insensitively, which means two distinct people with the same
 * name at the same company collapse into one row. That is a real if rare loss,
 * and it is forced by the constraint — the export carries nothing else stable
 * enough to tell them apart (the profile URL is often blank).
 */
function identityKey(connection: ParsedConnection): string {
  // JSON-encoded rather than joined on a separator: any separator that can
  // also appear inside a field would let ("Priya Sharma", "", "Stripe")
  // collide with ("Priya", "Sharma", "Stripe") — two different readings of
  // the same file.
  return JSON.stringify([
    connection.firstName.toLowerCase(),
    connection.lastName.toLowerCase(),
    (connection.companyRaw ?? "").toLowerCase(),
  ]);
}

function isBlankRow(row: string[]): boolean {
  return row.every((value) => value.trim() === "");
}

/**
 * Turn the raw text of a LinkedIn connections export into rows.
 *
 * @throws {ConnectionsCsvError} if the file is empty, has no locatable header,
 *   is missing a company column, or is implausibly large.
 */
export function parseConnectionsCsv(text: string): ParseConnectionsResult {
  const withoutBom = text.replace(/^\uFEFF/, "");

  if (withoutBom.trim() === "") {
    throw new ConnectionsCsvError("That file is empty.");
  }

  const parsed = Papa.parse<string[]>(withoutBom, {
    header: false,
    // Set explicitly rather than auto-detected: the `Notes:` preamble has a
    // different field count from the data, which can throw off the guess.
    delimiter: ",",
    // Papa normalises CRLF itself once the ending is known.
    newline: undefined,
    skipEmptyLines: false,
  });

  const rows = parsed.data;
  const headerRowIndex = findHeaderRow(rows);

  if (headerRowIndex === -1) {
    throw new ConnectionsCsvError(
      "This doesn't look like a LinkedIn connections export — we couldn't find a row of column headings starting with “First Name”. Upload Connections.csv from your LinkedIn data export.",
    );
  }

  const columns = buildColumnMap(rows[headerRowIndex] ?? []);

  if (columns.company === undefined) {
    throw new ConnectionsCsvError(
      "This export has no Company column, so there's nothing to match against job openings. Re-request your data from LinkedIn and choose Connections.",
    );
  }

  const dataRows = rows.slice(headerRowIndex + 1).filter((row) => !isBlankRow(row));

  if (dataRows.length > MAX_DATA_ROWS) {
    throw new ConnectionsCsvError(
      `That file has ${dataRows.length.toLocaleString()} rows, which is more than any LinkedIn account can have. Check you uploaded Connections.csv.`,
    );
  }

  const warnings: ParseWarning[] = [];
  const addWarning = (dataRow: number, reason: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push({ dataRow, reason });
  };

  const connections: ParsedConnection[] = [];
  const seen = new Set<string>();
  let unnamed = 0;
  let duplicate = 0;
  let withoutCompany = 0;

  for (const [index, row] of dataRows.entries()) {
    const dataRow = index + 1;

    const firstName = cell(row, columns.firstName) ?? "";
    const lastName = cell(row, columns.lastName) ?? "";

    if (firstName === "" && lastName === "") {
      unnamed += 1;
      addWarning(dataRow, "No name, so there's nobody to ask. Skipped.");
      continue;
    }

    const rawDate = cell(row, columns.connectedOn);
    const connectedOn = parseConnectedOn(rawDate);
    if (rawDate !== null && connectedOn === null) {
      addWarning(dataRow, `Couldn't read the connection date “${rawDate}”.`);
    }

    const connection: ParsedConnection = {
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" "),
      companyRaw: cell(row, columns.company),
      position: cell(row, columns.position),
      profileUrl: cleanProfileUrl(cell(row, columns.profileUrl)),
      email: cell(row, columns.email),
      connectedOn,
    };

    const key = identityKey(connection);
    if (seen.has(key)) {
      duplicate += 1;
      continue;
    }
    seen.add(key);

    if (connection.companyRaw === null) withoutCompany += 1;
    connections.push(connection);
  }

  if (connections.length === 0) {
    throw new ConnectionsCsvError(
      "We found the column headings but no connections underneath them. This export looks empty.",
    );
  }

  return {
    connections,
    totalDataRows: dataRows.length,
    dropped: { unnamed, duplicate },
    withoutCompany,
    headerRowIndex,
    warnings,
  };
}
