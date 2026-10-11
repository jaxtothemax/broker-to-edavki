/**
 * An eToro statement through the whole pipeline (ADR 0020): beside a
 * Trading 212 export of the same share, to Doh-KDVP and Doh-Div XML that
 * the vendored FURS schemas accept, whatever the order of the files. The
 * statement is synthetic, written at test time: no real export has been
 * read yet (R1).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APPLE, ROUND_TRIP, statement } from "@taxreporter/brokers/testing";
import { Decimal, fileRef, type FileId } from "@taxreporter/core";
import { writeDohDiv, writeDohKdvp, type PayerInfo } from "@taxreporter/furs";
import { validateAgainstSchema } from "@taxreporter/furs/testing";
import { RateTable } from "@taxreporter/fx";
import { describe, expect, it } from "vitest";

import { prepareReturns, readExports, type ExportFile } from "./prepare.js";

const root = new URL("../../../", import.meta.url);
const data = (file: string) =>
  readFileSync(
    fileURLToPath(new URL(`packages/fx/data/${file}`, root)),
    "utf8",
  );
const rates = RateTable.fromCsv(
  data("bsi-daily.csv"),
  data("bsi-monthly.csv"),
  (JSON.parse(data("snapshot.json")) as { completeThrough: string })
    .completeThrough,
);

/** One Apple share bought at Trading 212 before any eToro lot. */
const trading212: ExportFile = {
  name: "trading212.csv",
  bytes: new TextEncoder().encode(
    [
      "Action,Time (UTC),ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),French transaction tax,Currency (French transaction tax),Currency conversion fee,Currency (Currency conversion fee)",
      `Market buy,2023-12-01 15:00:00+00:00,${APPLE},AAPL,"Apple",,EOF0000009001,1.0000000000,150.0000000000,USD,1.08000000,,,138.89,"EUR",,,,,,`,
    ].join("\n"),
  ),
};
const etoro: ExportFile = { name: "etoro.xlsx", bytes: statement() };

const apple: PayerInfo = {
  name: "Apple Inc.",
  address: "One Apple Park Way, Cupertino, CA 95014, United States",
  country: "US",
};

const input = (files: readonly ExportFile[]) => ({
  files,
  taxYear: 2024,
  taxpayer: { taxNumber: "12345678" },
  rates,
  payers: new Map([[APPLE, apple]]),
});

describe("an eToro statement, to eDavki XML", () => {
  const prepared = prepareReturns(input([etoro, trading212]));

  it("reads both files with nothing blocking", () => {
    expect(prepared.imports.map((i) => i.result.format)).toEqual([
      "etoro-xlsx-2025.2.15",
      "trading212-csv-v4",
    ]);
    expect(
      prepared.ledger.diagnostics.filter((d) => d.severity === "blocking"),
    ).toEqual([]);
    expect(
      prepared.kdvp.diagnostics.filter((d) => d.severity === "blocking"),
    ).toEqual([]);
    expect(
      prepared.div.diagnostics.filter((d) => d.severity === "blocking"),
    ).toEqual([]);
  });

  it("sells Trading 212's share first, then eToro's (FIFO across brokers)", () => {
    const form = prepared.kdvp.form;
    if (form === null) throw new Error("no Doh-KDVP");
    expect(
      form.lists.map((list) => [
        list.isin,
        list.rows.map((r) => [r.kind, r.date, r.quantity.toPlain(8, "down")]),
      ]),
    ).toEqual([
      [
        APPLE,
        [
          ["purchase", "2023-12-01", "1"],
          ["purchase", "2024-01-05", "0.650619"],
          ["sale", "2024-01-16", "1.650619"],
        ],
      ],
    ]);
  });

  it("writes XML the vendored schemas accept", async () => {
    const kdvp = prepared.kdvp.form;
    const div = prepared.div.form;
    if (kdvp === null || div === null) throw new Error("no form");
    for (const [xml, schema] of [
      [writeDohKdvp(kdvp), "Doh_KDVP_9.xsd"],
      [writeDohDiv(div), "Doh_Div_3.xsd"],
    ] as const) {
      const result = await validateAgainstSchema(xml, schema);
      expect(result.errors, schema).toEqual([]);
      expect(result.valid).toBe(true);
    }
    // The dividend: 0.11 net plus 0.0122 withheld, in dollars.
    expect(prepared.div.dividends.map((d) => d.date)).toEqual(["2024-02-15"]);
  });

  it("writes the same XML whatever order the files come in", () => {
    const reversed = prepareReturns(input([trading212, etoro]));
    const xml = (p: typeof prepared) =>
      p.kdvp.form === null || p.div.form === null
        ? null
        : [writeDohKdvp(p.kdvp.form), writeDohDiv(p.div.form)];
    expect(xml(reversed)).toEqual(xml(prepared));
  });

  it("holds the lot still open at its exact price, which every view rounds", () => {
    // Alone: beside Trading 212, whose file ends in 2023, Apple's lots are
    // shown as of that day (ADR 0018 §2), before this one was bought.
    const holdings = prepareReturns(input([etoro])).holdings;
    if (holdings === null) throw new Error("no holdings");
    const apple = holdings.securities.find((s) => s.isin === APPLE);
    const lot = apple?.lots.find((l) => l.purchaseDate === "2024-01-08");
    // 200 / 1.1 has no finite expansion: kept as a fraction, never toString.
    expect(
      lot?.price.amount.equals(
        Decimal.parse("200").dividedBy(Decimal.parse("1.1")),
      ),
    ).toBe(true);
    expect(lot?.price.amount.toPlain(8, "halfUp")).toBe("181.81818182");
    expect(() => lot?.price.amount.toString()).toThrow(RangeError);
  });
});

describe("a second statement of one eToro account", () => {
  // The same account, a month later: a statement with one more deposit.
  const later: ExportFile = {
    name: "etoro-later.xlsx",
    bytes: statement({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity,
        {
          ...ROUND_TRIP.activity[0],
          Date: "20/03/2024 10:00:00",
          "Realized Equity Change": { n: "100" },
          "Realized Equity": { n: "5100" },
        },
      ],
    }),
  };

  it("is refused, naming both files, whatever their order", () => {
    const one = readExports({ files: [etoro, later] });
    const other = readExports({ files: [later, etoro] });
    const findings = (r: typeof one) =>
      r.ledger.diagnostics.filter((d) => d.code === "secondStatement");
    const [first, second] = [etoro, later]
      .map((f) => one.imports.find((i) => i.file === f.name)?.fileId as FileId)
      .sort();
    expect(findings(one)).toEqual([
      {
        severity: "blocking",
        code: "secondStatement",
        params: {
          broker: "etoro",
          first: fileRef(first as FileId),
          second: fileRef(second as FileId),
        },
      },
    ]);
    expect(findings(other)).toEqual(findings(one));
  });

  it("is read as another account's when the user says the files are separate", () => {
    const separate = readExports({
      files: [etoro, later],
      accounts: "separate",
    });
    expect(separate.ledger.diagnostics.map((d) => d.code)).not.toContain(
      "secondStatement",
    );
  });
});
