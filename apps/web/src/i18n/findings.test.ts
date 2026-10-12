import { describe, expect, it } from "vitest";

import { findingsEn, findingsSl, wordsEn, wordsSl } from "./findings";
import { en } from "./messages";

/** Parameters that name themselves, so every slot shows in the text. */
const named = new Proxy(
  {},
  { get: (_, key) => (typeof key === "string" ? `‹${key}›` : undefined) },
) as never;

describe("the findings catalog", () => {
  it("says every finding in both languages, with every parameter shown", () => {
    for (const catalog of [findingsEn, findingsSl]) {
      for (const [code, message] of Object.entries(catalog)) {
        const text = (message as (p: never) => string)(named);
        expect(text, code).not.toMatch(/undefined|\[object/);
        expect(text.length, code).toBeGreaterThan(10);
        // A full sentence, however its parameters read.
        expect(text, code).toMatch(/[.!?][”"»]?$/);
      }
    }
    expect(Object.keys(findingsSl).sort()).toEqual(
      Object.keys(findingsEn).sort(),
    );
  });

  it("words a dividend counted under another label by which label it is", () => {
    const bonus = { broker: "Trading 212", label: "bonus" } as never;
    const demerger = { broker: "Trading 212", label: "demerger" } as never;
    expect(findingsEn.dividendLabelTreated(bonus)).toMatch(/Bonus.*art\. 90/);
    expect(findingsEn.dividendLabelTreated(demerger)).toMatch(/not settled/);
    expect(findingsSl.dividendLabelTreated(bonus)).toMatch(/Bonus.*90\. členu/);
    expect(findingsSl.dividendLabelTreated(demerger)).toMatch(/ni urejena/);
  });

  it("words a refusal of another year by what the row does (ADR 0017)", () => {
    const note = (shares: string) =>
      ({ isin: "ORBT", date: "3 Sept 2025", year: "2026", shares }) as never;
    expect(findingsEn.refusedElsewhere(note("out"))).toMatch(
      /^ORBT, 3 Sept 2025: a sale priced at zero is not read, but it changes nothing on the 2026 returns/,
    );
    expect(findingsEn.refusedElsewhere(note("in"))).toMatch(
      /: a receipt of new shares is not read/,
    );
    expect(findingsEn.refusedElsewhere(note("rights"))).toMatch(
      /: a receipt of free rights is not read/,
    );
    expect(findingsSl.refusedElsewhere(note("out"))).toMatch(
      /: prodaja po ceni nič ni prebrana, vendar ta vrstica ne spremeni ničesar v napovedih za leto 2026/,
    );
    expect(findingsSl.refusedElsewhere(note("in"))).toMatch(
      /: prejem novih delnic ni prebran,/,
    );
    expect(findingsSl.refusedElsewhere(note("rights"))).toMatch(
      /: prejem brezplačnih pravic ni prebran,/,
    );
  });

  it("starts a sentence with a capital when it names no security or day", () => {
    expect(findingsEn.invalidTrade({})).toMatch(/^A trade could not/);
    expect(findingsSl.invalidTrade({})).toMatch(/^Posla ni bilo/);
    expect(
      findingsEn.invalidTrade({ isin: "AAPL", date: "3 Mar 2026" }),
    ).toMatch(/^AAPL, 3 Mar 2026: a trade/);
  });

  it("names the line a file stopped at, but not for a file refused whole", () => {
    expect(
      findingsEn.unreadableFile({ reason: "a cell is too long", row: "12" }),
    ).toMatch(/^This file cannot be read: a cell is too long \(line 12\)\. /);
    expect(
      findingsEn.unreadableFile({ reason: "the file is too large", row: "0" }),
    ).toMatch(/^This file cannot be read: the file is too large\. /);
    expect(
      findingsSl.unreadableFile({ reason: "ima preveč vrstic", row: "0" }),
    ).toMatch(/^Datoteke ni mogoče prebrati: ima preveč vrstic\. /);
  });

  it("names the sheet and cell a workbook stopped at", () => {
    const reason = "a cell's number is malformed or out of range";
    expect(
      findingsEn.unreadableFile({ reason, row: "12", sheet: "2", column: "C" }),
    ).toMatch(
      /: a cell's number is malformed or out of range \(sheet 2, cell C12\)\. /,
    );
    expect(
      findingsEn.unreadableFile({ reason, row: "12", sheet: "2" }),
    ).toMatch(/ \(sheet 2, row 12\)\. /);
    expect(findingsEn.unreadableFile({ reason, row: "0", sheet: "2" })).toMatch(
      / \(sheet 2\)\. /,
    );
    expect(
      findingsSl.unreadableFile({
        reason: "x",
        row: "12",
        sheet: "2",
        column: "C",
      }),
    ).toMatch(/ \(list 2, celica C12\)\. /);
  });

  it("names the Details step in every finding that asks for a payer's details", () => {
    const payer = { isin: "IE00TEST0001" } as never;
    expect(findingsEn.payerUnknown(payer)).toContain(
      `on the ${en.stepper.details} step`,
    );
    expect(findingsSl.payerUnknown(payer)).toContain("v koraku s podatki");
    expect(findingsEn.sourceCountryUnknown(payer)).toContain(
      `on the ${en.stepper.details} step`,
    );
    expect(findingsSl.sourceCountryUnknown(payer)).toContain(
      "v koraku s podatki",
    );
    const typed = { code: "X", path: "taxpayer.taxNumber" } as never;
    expect(findingsEn.formIssue(typed)).toContain(
      `on the ${en.stepper.details} step`,
    );
    expect(findingsSl.formIssue(typed)).toContain("v koraku s podatki");
  });

  it("words each value of an eToro finding's closed list as its own clause", () => {
    const broker = "eToro";
    const says = (
      code: "statementFormat" | "historyIncomplete" | "dividendInconsistent",
      name: string,
      values: readonly string[],
    ) => {
      for (const catalog of [findingsEn, findingsSl]) {
        const message = catalog[code] as (p: Record<string, string>) => string;
        const texts = values.map((value) => message({ broker, [name]: value }));
        // Each value its own clause, none of them the fallback's.
        const fallback = message({ broker, [name]: "‹other›" });
        expect(new Set([...texts, fallback]).size, code).toBe(
          values.length + 1,
        );
      }
    };
    says("statementFormat", "format", [
      "regionalDate",
      "regionalNumber",
      "serialDate",
      "bracketNegative",
    ]);
    says("historyIncomplete", "gap", ["start", "order", "openRow"]);
    says("dividendInconsistent", "mismatch", [
      "rate",
      "pairing",
      "date",
      "unpaired",
      "netAmount",
      "class",
    ]);
    expect(findingsEn.historyIncomplete({ broker, gap: "start" })).toMatch(
      /^eToro: the statement does not start when the account was opened/,
    );
    expect(findingsSl.isinUnresolved({ broker, cause: "missing" })).toMatch(
      /^Še odprta pozicija v izpisku eToro nima kode ISIN/,
    );
  });

  it("words an unnamed purchase by whether core can scope it, and its note", () => {
    const broker = "eToro";
    const date = "2024-02-20";
    for (const catalog of [findingsEn, findingsSl]) {
      for (const cause of ["missing", "ambiguous"]) {
        const bare = catalog.isinUnresolved({ broker, cause, date });
        const scoped = catalog.isinUnresolved({
          broker,
          cause,
          date,
          side: "buy",
        });
        // Scoped, it says which return waits and which does not.
        expect(scoped, cause).not.toBe(bare);
        expect(scoped, cause).toContain("Doh-KDVP");
        expect(bare, cause).not.toContain("Doh-KDVP");
      }
    }
    const note = { broker, date, year: "2026" };
    expect(findingsEn.unresolvedElsewhere(note)).toMatch(
      /^2024-02-20: a position still open in the eToro statement has no ISIN, but it changes nothing on the 2026 returns/,
    );
    expect(findingsSl.unresolvedElsewhere(note)).toMatch(
      /^2024-02-20: še odprta pozicija v izpisku eToro nima kode ISIN, vendar ne spremeni ničesar v napovedih za leto 2026/,
    );
  });

  it("has the same closed lists in both languages", () => {
    for (const list of [
      "kinds",
      "refusals",
      "unreadable",
      "rateErrors",
      "brokers",
      "actions",
      "sections",
      "tradeChecks",
    ] as const) {
      expect(Object.keys(wordsSl[list]).sort(), list).toEqual(
        Object.keys(wordsEn[list]).sort(),
      );
    }
  });
});
