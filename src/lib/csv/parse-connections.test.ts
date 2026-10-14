import { describe, expect, it } from "vitest";

import {
  ConnectionsCsvError,
  parseConnectedOn,
  parseConnectionsCsv,
} from "./parse-connections.ts";

/**
 * The `Notes:` preamble LinkedIn actually ships, reproduced verbatim. Its exact
 * length is the thing the parser must not depend on, so it is kept realistic
 * here and varied in the dedicated test below.
 */
const PREAMBLE = [
  "Notes:",
  '"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"',
  "",
].join("\n");

const HEADER = "First Name,Last Name,URL,Email Address,Company,Position,Connected On";

/** A faithful export: preamble, header, and rows carrying the real quirks. */
const REALISTIC_EXPORT = [
  PREAMBLE,
  HEADER,
  "Priya,Sharma,https://www.linkedin.com/in/priyasharma,,Stripe,Staff Engineer,21 Mar 2023",
  'Daniel,Okafor,https://www.linkedin.com/in/danielokafor,dan@example.com,"Acme, Inc.",Engineering Manager,04 Jan 2021',
  "Mei,Chen,https://www.linkedin.com/in/meichen,,,,17 Nov 2019",
].join("\n");

describe("parseConnectionsCsv", () => {
  it("reads a realistic export, preamble and all", () => {
    const result = parseConnectionsCsv(REALISTIC_EXPORT);

    expect(result.headerRowIndex).toBe(3);
    expect(result.totalDataRows).toBe(3);
    expect(result.connections).toHaveLength(3);
    expect(result.dropped).toEqual({ unnamed: 0, duplicate: 0 });
    expect(result.warnings).toEqual([]);

    expect(result.connections[0]).toEqual({
      firstName: "Priya",
      lastName: "Sharma",
      fullName: "Priya Sharma",
      companyRaw: "Stripe",
      position: "Staff Engineer",
      profileUrl: "https://www.linkedin.com/in/priyasharma",
      email: null,
      connectedOn: new Date("2023-03-21T00:00:00.000Z"),
    });
  });

  it("keeps a company name whose quoted value contains a comma", () => {
    const result = parseConnectionsCsv(REALISTIC_EXPORT);

    expect(result.connections[1]?.companyRaw).toBe("Acme, Inc.");
    expect(result.connections[1]?.email).toBe("dan@example.com");
  });

  it("keeps rows with no company but counts them separately", () => {
    const result = parseConnectionsCsv(REALISTIC_EXPORT);

    // Mei stays — she is still a connection, just not matchable to a board.
    expect(result.connections[2]).toMatchObject({
      fullName: "Mei Chen",
      companyRaw: null,
      position: null,
    });
    expect(result.withoutCompany).toBe(1);
  });

  it("finds the header regardless of how long the preamble is", () => {
    const longPreamble = [
      "Notes:",
      '"A note about email addresses."',
      '"A second note that a future export version might add."',
      "",
      "",
    ].join("\n");

    const noPreamble = parseConnectionsCsv(
      [HEADER, "Ada,Lovelace,,,Analytical Engines,Mathematician,01 Jan 2020"].join("\n"),
    );
    const longer = parseConnectionsCsv(
      [longPreamble, HEADER, "Ada,Lovelace,,,Analytical Engines,Mathematician,01 Jan 2020"].join(
        "\n",
      ),
    );

    expect(noPreamble.headerRowIndex).toBe(0);
    expect(longer.headerRowIndex).toBe(5);
    expect(longer.connections).toEqual(noPreamble.connections);
  });

  it("strips a UTF-8 BOM so the first column still matches", () => {
    const bom = "﻿";
    const result = parseConnectionsCsv(
      [bom + HEADER, "Ada,Lovelace,,,Analytical Engines,Mathematician,01 Jan 2020"].join("\n"),
    );

    expect(result.connections[0]?.firstName).toBe("Ada");
    expect(result.connections[0]?.companyRaw).toBe("Analytical Engines");
  });

  it("handles CRLF line endings", () => {
    const result = parseConnectionsCsv(
      [PREAMBLE, HEADER, "Ada,Lovelace,,,Analytical Engines,Mathematician,01 Jan 2020"]
        .join("\n")
        .replace(/\n/g, "\r\n"),
    );

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.position).toBe("Mathematician");
  });

  it("tolerates a trailing newline and blank rows in the middle", () => {
    const result = parseConnectionsCsv(
      [
        HEADER,
        "Ada,Lovelace,,,Analytical Engines,Mathematician,01 Jan 2020",
        "",
        ",,,,,,",
        "Grace,Hopper,,,US Navy,Rear Admiral,02 Feb 2021",
        "",
      ].join("\n"),
    );

    expect(result.connections.map((c) => c.fullName)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
    // Rows of nothing but delimiters are formatting artifacts, not connections
    // anyone lost, so they are not counted or reported as dropped.
    expect(result.totalDataRows).toBe(2);
    expect(result.dropped).toEqual({ unnamed: 0, duplicate: 0 });
  });

  it("accounts for every data row it read", () => {
    const result = parseConnectionsCsv(
      [
        HEADER,
        "Ada,Lovelace,,,Analytical Engines,Mathematician,01 Jan 2020",
        "ada,lovelace,,,analytical engines,Mathematician,01 Jan 2020",
        ",,,,Ghost Corp,Unknown,01 Jan 2020",
        "Grace,Hopper,,,US Navy,Rear Admiral,02 Feb 2021",
      ].join("\n"),
    );

    // The counts must reconcile, or the upload screen would report a number the
    // user can't square with their file.
    expect(result.connections.length + result.dropped.unnamed + result.dropped.duplicate).toBe(
      result.totalDataRows,
    );
    expect(result.totalDataRows).toBe(4);
    expect(result.dropped).toEqual({ unnamed: 1, duplicate: 1 });
  });

  it("de-duplicates the same person at the same company, ignoring case", () => {
    const result = parseConnectionsCsv(
      [
        HEADER,
        "Ada,Lovelace,,,Analytical Engines,Mathematician,01 Jan 2020",
        "ada,lovelace,,,analytical engines,Mathematician,01 Jan 2020",
        // Same name, different company: a genuine job change, so both rows stay.
        "Ada,Lovelace,,,Babbage Works,Consultant,01 Jan 2022",
      ].join("\n"),
    );

    expect(result.connections).toHaveLength(2);
    expect(result.dropped.duplicate).toBe(1);
    expect(result.connections.map((c) => c.companyRaw)).toEqual([
      "Analytical Engines",
      "Babbage Works",
    ]);
    // The first occurrence wins, so original casing survives.
    expect(result.connections[0]?.firstName).toBe("Ada");
  });

  it("keeps someone with only a last name", () => {
    const result = parseConnectionsCsv(
      [HEADER, ",Lovelace,,,Analytical Engines,Mathematician,01 Jan 2020"].join("\n"),
    );

    expect(result.connections[0]).toMatchObject({
      firstName: "",
      lastName: "Lovelace",
      fullName: "Lovelace",
    });
    expect(result.dropped.unnamed).toBe(0);
  });

  it("trims surrounding whitespace from every field", () => {
    const result = parseConnectionsCsv(
      [HEADER, "  Ada , Lovelace ,,,  Analytical Engines , Mathematician ,01 Jan 2020"].join("\n"),
    );

    expect(result.connections[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      companyRaw: "Analytical Engines",
      position: "Mathematician",
    });
  });

  it("warns about an unreadable date instead of failing the upload", () => {
    const result = parseConnectionsCsv(
      [HEADER, "Ada,Lovelace,,,Analytical Engines,Mathematician,sometime in 2020"].join("\n"),
    );

    expect(result.connections[0]?.connectedOn).toBeNull();
    expect(result.warnings).toEqual([
      { dataRow: 1, reason: "Couldn't read the connection date “sometime in 2020”." },
    ]);
  });

  it("does not warn when the date cell is simply empty", () => {
    const result = parseConnectionsCsv(
      [HEADER, "Ada,Lovelace,,,Analytical Engines,Mathematician,"].join("\n"),
    );

    expect(result.connections[0]?.connectedOn).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it("drops a profile value that is not a URL", () => {
    const result = parseConnectionsCsv(
      [HEADER, "Ada,Lovelace,not-a-url,,Analytical Engines,Mathematician,01 Jan 2020"].join("\n"),
    );

    expect(result.connections[0]?.profileUrl).toBeNull();
  });

  it("matches headers in a different order and with different spellings", () => {
    const result = parseConnectionsCsv(
      [
        "Company,Job Title,Last Name,First Name,Connected On",
        "Analytical Engines,Mathematician,Lovelace,Ada,01 Jan 2020",
      ].join("\n"),
    );

    expect(result.connections[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      companyRaw: "Analytical Engines",
      position: "Mathematician",
    });
  });

  it("rejects a file that isn't a connections export", () => {
    expect(() => parseConnectionsCsv("id,amount\n1,42")).toThrow(ConnectionsCsvError);
    expect(() => parseConnectionsCsv("id,amount\n1,42")).toThrow(/First Name/);
  });

  it("rejects an export with no Company column", () => {
    expect(() =>
      parseConnectionsCsv(["First Name,Last Name,Connected On", "Ada,Lovelace,01 Jan 2020"].join("\n")),
    ).toThrow(/no Company column/);
  });

  it("rejects an empty file", () => {
    expect(() => parseConnectionsCsv("")).toThrow(/empty/);
    expect(() => parseConnectionsCsv("   \n\n")).toThrow(/empty/);
  });

  it("rejects a header with nothing under it", () => {
    expect(() => parseConnectionsCsv([PREAMBLE, HEADER].join("\n"))).toThrow(
      /no connections underneath/,
    );
  });

  it("does not mistake the Notes paragraph for the header", () => {
    // The preamble mentions "email addresses", which a looser header test would
    // match — shifting every column and silently corrupting the whole import.
    const result = parseConnectionsCsv(REALISTIC_EXPORT);
    expect(result.connections[0]?.firstName).toBe("Priya");
  });
});

describe("parseConnectedOn", () => {
  it("reads LinkedIn's own day-month-year format", () => {
    expect(parseConnectedOn("21 Mar 2023")).toEqual(new Date("2023-03-21T00:00:00.000Z"));
    expect(parseConnectedOn("4 Jan 2021")).toEqual(new Date("2021-01-04T00:00:00.000Z"));
    expect(parseConnectedOn("04 January 2021")).toEqual(new Date("2021-01-04T00:00:00.000Z"));
  });

  it("reads the month-first format Excel produces", () => {
    expect(parseConnectedOn("Mar 21, 2023")).toEqual(new Date("2023-03-21T00:00:00.000Z"));
    expect(parseConnectedOn("March 21 2023")).toEqual(new Date("2023-03-21T00:00:00.000Z"));
  });

  it("reads ISO dates", () => {
    expect(parseConnectedOn("2023-03-21")).toEqual(new Date("2023-03-21T00:00:00.000Z"));
    expect(parseConnectedOn("2023-03-21T09:30:00Z")).toEqual(
      new Date("2023-03-21T00:00:00.000Z"),
    );
  });

  it("returns null rather than guessing", () => {
    expect(parseConnectedOn(null)).toBeNull();
    expect(parseConnectedOn("")).toBeNull();
    expect(parseConnectedOn("   ")).toBeNull();
    expect(parseConnectedOn("21 Foo 2023")).toBeNull();
    expect(parseConnectedOn("last Tuesday")).toBeNull();
    expect(parseConnectedOn("3/21/23")).toBeNull();
  });

  it("rejects a date that does not exist instead of rolling it over", () => {
    // Date would turn 31 Feb into 3 March. Reporting a date the file never
    // contained is worse than reporting none.
    expect(parseConnectedOn("31 Feb 2023")).toBeNull();
    expect(parseConnectedOn("2023-02-31")).toBeNull();
    expect(parseConnectedOn("29 Feb 2024")).toEqual(new Date("2024-02-29T00:00:00.000Z"));
  });
});
