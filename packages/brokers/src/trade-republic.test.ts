/**
 * The Trade Republic adapter against its synthetic exports, one per
 * revision (test/fixtures/trade-republic/README.md), and against the rows
 * it must refuse.
 */
import { readFileSync } from "node:fs";

import {
  fileIdOf,
  forExport,
  matchFifo,
  validateLedger,
  type LedgerEvent,
  type TradeEvent,
} from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { importFile, type ImportResult } from "./adapter.js";
import {
  TRADE_REPUBLIC_COLUMNS,
  TRADE_REPUBLIC_VALUE_DATE_COLUMNS,
} from "./trade-republic.js";

const fixtureFile = (name: string) =>
  readFileSync(
    new URL(`../test/fixtures/trade-republic/${name}`, import.meta.url),
    "utf8",
  );
const fixture = fixtureFile("tr-transactions-2026.csv");
const valueDateFixture = fixtureFile("tr-transactions-value-date.csv");

/** An export's text, imported as its bytes. */
function read(text: string): ImportResult {
  const bytes = new TextEncoder().encode(text);
  return importFile({ bytes, fileId: fileIdOf(bytes), accountGroup: 1 });
}

const HEADER = TRADE_REPUBLIC_COLUMNS.map((c) => `"${c}"`).join(",");

type Cells = Partial<Record<(typeof TRADE_REPUBLIC_COLUMNS)[number], string>>;

/** One row, a purchase of Apple unless told otherwise. */
function row(cells: Cells = {}): string {
  const all: Cells = {
    datetime: "2026-03-10T14:05:12.000Z",
    date: "2026-03-10",
    account_type: "DEFAULT",
    category: "TRADING",
    type: "BUY",
    asset_class: "STOCK",
    name: "Apple",
    symbol: "US0378331005",
    shares: "2.0000000000",
    price: "180.500000",
    amount: "-361.00",
    fee: "-1.00",
    currency: "EUR",
    transaction_id: "00000000-0000-4000-8000-000000000099",
    ...cells,
  };
  return TRADE_REPUBLIC_COLUMNS.map((c) => `"${all[c] ?? ""}"`).join(",");
}

const rows = (...lines: string[]) => read([HEADER, ...lines].join("\n"));

const codes = (result: ImportResult) => result.diagnostics.map((d) => d.code);

describe("tradeRepublic: the export", () => {
  const result = read(fixture);

  it("is recognized by its 23 columns", () => {
    expect([result.broker, result.format]).toEqual([
      "traderepublic",
      "traderepublic-csv-2026",
    ]);
    // One column more, or one renamed, is another revision, not read on
    // a guess.
    const wider = `${HEADER},"extra"\n${row()},""`;
    expect(codes(read(wider))).toEqual(["unknownFormat"]);
    const renamed = HEADER.replace('"fx_rate"', '"fx"');
    expect(codes(read(`${renamed}\n${row()}`))).toEqual(["unknownFormat"]);
  });

  it("reads purchases, savings plans and sales at their price, on their Ljubljana date", () => {
    const trades = result.events.filter(
      (e): e is TradeEvent => e.kind === "trade",
    );
    expect(
      trades.map((t) => [
        t.side,
        t.date,
        t.security.isin,
        t.quantity.toString(),
        t.price.amount.toString(),
        t.price.currency,
        t.security.isFund === true,
      ]),
    ).toEqual([
      [
        "buy",
        "2026-01-02",
        "IE00B4L5Y983",
        "1.2345678901",
        "101.23",
        "EUR",
        true,
      ],
      ["buy", "2026-02-02", "IE00B4L5Y983", "1.2", "104.1", "EUR", true],
      ["buy", "2026-03-10", "US0378331005", "2", "180.5", "EUR", false],
      // 22:40 UTC on 14 July: 15 July in Ljubljana, as Trade Republic says.
      ["sell", "2026-07-15", "US0378331005", "1", "210", "EUR", false],
      ["buy", "2026-08-03", "IE00B4L5Y983", "1.15", "108.6", "EUR", true],
    ]);
    expect(trades[3]?.at).toEqual({
      instant: "2026-07-14T22:40:55Z",
      brokerDate: "2026-07-15",
    });
  });

  it("ignores cash rows by reason, and warns that interest is not covered", () => {
    const ignored = result.events.filter((e) => e.kind === "ignored");
    expect(ignored.map((e) => [e.source.row, e.reason])).toEqual([
      [2, "deposit"],
      [6, "cardSpending"],
      [7, "interest"],
    ]);
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "interestNotCovered",
        params: { broker: "traderepublic", count: 1 },
      },
    ]);
  });

  it("accounts for every row: an event, an ignored row or a finding", () => {
    const lines = fixture.trim().split("\n").length - 1;
    const rowsSeen = new Set(result.events.map((e) => e.source.row));
    expect(rowsSeen.size).toBe(lines);
    expect(result.reach).toHaveLength(1);
    expect(result.reach[0]?.lastDate).toBe("2026-08-03");
  });

  it("gives a ledger the engine takes, and matches the sale first in, first out", () => {
    const ledger = validateLedger(result.events);
    expect(ledger.diagnostics).toEqual([]);
    const fifo = matchFifo(ledger);
    expect(fifo.diagnostics).toEqual([]);
    // The one Apple sold on 15 July comes out of the two bought on 10 March.
    const apple = fifo.securities.get("US0378331005");
    expect(
      apple?.disposals.map((d) => [
        d.sale.date,
        d.matches.map((m) => [m.purchase.date, m.quantity.toString()]),
        d.unmatched.toString(),
      ]),
    ).toEqual([["2026-07-15", [["2026-03-10", "1"]], "0"]]);
  });
});

describe("tradeRepublic: what it refuses", () => {
  it("refuses dividends until a real export confirms their columns", () => {
    const result = rows(
      row({
        category: "CASH",
        type: "DIVIDEND",
        shares: "0.2702700000",
        price: "",
        amount: "0.060000",
        tax: "-0.01",
        original_amount: "0.07",
        original_currency: "USD",
        fx_rate: "1.160000",
      }),
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "blocking",
        code: "unconfirmedAction",
        params: { broker: "traderepublic", action: "DIVIDEND" },
      }),
    ]);
    expect(result.events).toEqual([]);
  });

  it("refuses free shares, corporate actions, migrations and other assets", () => {
    for (const [cells, action] of [
      [{ type: "BENEFITS_SAVEBACK" }, "BENEFITS_SAVEBACK"],
      [{ type: "STOCKPERK" }, "STOCKPERK"],
      [{ type: "BONUS" }, "BONUS"],
      [{ type: "MIGRATION" }, "MIGRATION"],
      [{ category: "CORPORATE_ACTION", type: "SPLIT" }, "CORPORATE_ACTION"],
      [{ category: "DELIVERY", type: "BUY" }, "DELIVERY"],
      [{ asset_class: "BOND" }, "BOND"],
      [{ asset_class: "CRYPTO" }, "CRYPTO"],
      [{ asset_class: "PRIVATE_FUND" }, "PRIVATE_FUND"],
    ] as const) {
      const [d] = rows(row(cells)).diagnostics;
      expect([d?.severity, d?.code, d?.params], action).toEqual([
        "blocking",
        "unsupportedAction",
        { broker: "traderepublic", action },
      ]);
    }
  });

  it("names the category, not the type, when only the category is unknown", () => {
    const [d] = rows(row({ category: "SECRET_CATEGORY" })).diagnostics;
    expect(d?.code).toBe("unknownAction");
    expect(JSON.stringify(d?.params)).toContain("SECRET_CATEGORY");
  });

  it("refuses a type or an account it does not know, keeping their text out of exports", () => {
    for (const cells of [
      { type: "SECRET_TYPE" },
      { account_type: "SECRET_ACCOUNT" },
      { category: "CASH", type: "BUY" },
      { asset_class: "SECRET_ASSET" },
    ]) {
      const [d] = rows(row(cells)).diagnostics;
      expect(d?.code).toBe("unknownAction");
      if (d === undefined) throw new Error("no finding");
      expect(JSON.stringify(forExport(d))).not.toContain("SECRET");
    }
  });

  it("refuses a row it cannot date, or whose date and time disagree", () => {
    expect(codes(rows(row({ datetime: "10.03.2026 14:05" })))).toEqual([
      "invalidTime",
    ]);
    expect(codes(rows(row({ date: "2026-02-30" })))).toEqual(["invalidTime"]);
    // 14:05 UTC is 15:05 in Berlin, the same day; the 11th is another.
    expect(codes(rows(row({ date: "2026-03-11" })))).toEqual(["invalidTime"]);
  });

  it("refuses a sign, a number, a price, an ISIN or a currency that is wrong", () => {
    const cases: [Cells, string][] = [
      [{ shares: "-2.0000000000" }, "unexpectedSign"],
      [{ type: "SELL", shares: "2.0000000000" }, "unexpectedSign"],
      [{ shares: "0.0000000000" }, "unexpectedSign"],
      [{ shares: "2,5" }, "invalidNumber"],
      [{ shares: "1e3" }, "invalidNumber"],
      [{ price: "" }, "invalidNumber"],
      [{ price: "0.000000" }, "invalidPrice"],
      [{ symbol: "AAPL" }, "invalidIsin"],
      [{ currency: "eur" }, "invalidCurrency"],
    ];
    for (const [cells, code] of cases) {
      expect(codes(rows(row(cells))), JSON.stringify(cells)).toEqual([code]);
    }
  });
});

describe("tradeRepublic: every type the research lists", () => {
  it("makes each an event, an ignored row or a named finding", () => {
    const cash = { category: "CASH", symbol: "", shares: "", price: "" };
    const cases: [Cells, string][] = [
      [{ type: "BUY" }, "trade"],
      [{ type: "SAVINGS_PLAN_EXECUTED", asset_class: "FUND" }, "trade"],
      [{ type: "SELL", shares: "-2.0000000000", amount: "361.00" }, "trade"],
      [{ ...cash, type: "CUSTOMER_INBOUND" }, "ignored:deposit"],
      [{ ...cash, type: "CUSTOMER_INPAYMENT" }, "ignored:deposit"],
      [{ ...cash, type: "TRANSFER_INSTANT_INBOUND" }, "ignored:deposit"],
      [{ ...cash, type: "CUSTOMER_OUTBOUND_REQUEST" }, "ignored:withdrawal"],
      [{ ...cash, type: "TRANSFER_INSTANT_OUTBOUND" }, "ignored:withdrawal"],
      [{ ...cash, type: "CARD_TRANSACTION" }, "ignored:cardSpending"],
      [
        { ...cash, type: "CARD_TRANSACTION_INTERNATIONAL" },
        "ignored:cardSpending",
      ],
      [{ ...cash, type: "INTEREST_PAYMENT" }, "ignored:interest"],
      [{ ...cash, type: "DIVIDEND" }, "unconfirmedAction"],
      [{ type: "BENEFITS_SAVEBACK" }, "unsupportedAction"],
      [{ type: "STOCKPERK" }, "unsupportedAction"],
      [{ type: "BONUS" }, "unsupportedAction"],
      [{ type: "MIGRATION" }, "unsupportedAction"],
      [{ type: "REDEMPTION" }, "unsupportedAction"],
      [{ type: "FINAL_MATURITY" }, "unsupportedAction"],
      [{ type: "PRIVATE_MARKET_BUY" }, "unsupportedAction"],
      [{ category: "CORPORATE_ACTION", type: "SPLIT" }, "unsupportedAction"],
      [{ category: "DELIVERY", type: "BUY" }, "unsupportedAction"],
    ];
    for (const [cells, outcome] of cases) {
      const result = rows(row(cells));
      const [event] = result.events;
      const blocking = result.diagnostics.find(
        (d) => d.severity === "blocking",
      );
      const seen =
        blocking?.code ??
        (event?.kind === "ignored" ? `ignored:${event.reason}` : event?.kind);
      expect(seen, JSON.stringify(cells)).toBe(outcome);
    }
  });
});

describe("tradeRepublic: what it checks", () => {
  it("keys by transaction ID: two fills alike in all else stay two", () => {
    const result = rows(
      row(),
      row({ transaction_id: "00000000-0000-4000-8000-000000000100" }),
    );
    expect(validateLedger(result.events).diagnostics).toEqual([]);
  });

  it("refuses a fee that is no number", () => {
    expect(codes(rows(row({ fee: "1,00" })))).toEqual(["invalidNumber"]);
  });

  it("blocks a row repeated inside one file, rather than count it twice", () => {
    const result = rows(row(), row());
    expect(result.events.filter((e) => e.kind === "trade")).toHaveLength(2);
    expect(
      validateLedger(result.events).diagnostics.map((d) => [
        d.severity,
        d.code,
      ]),
    ).toContainEqual(["blocking", "duplicateKeyInFile"]);
  });

  it("takes a cash type only as cash, never on a row that names a security", () => {
    for (const cells of [
      { type: "CUSTOMER_INBOUND" },
      { type: "INTEREST_PAYMENT" },
      { category: "CASH", type: "CARD_TRANSACTION" },
      // Each condition alone: a TRADING deposit with nothing else, and a
      // CASH card payment that names a security.
      { type: "CUSTOMER_INBOUND", symbol: "", shares: "", price: "" },
      { category: "CASH", type: "CARD_TRANSACTION", shares: "", price: "" },
    ]) {
      expect(codes(rows(row(cells))), JSON.stringify(cells)).toEqual([
        "unknownAction",
      ]);
    }
  });

  it("refuses a trade with a foreign leg until a real export shows its price's currency", () => {
    for (const cells of [
      { original_amount: "400.00" },
      { original_currency: "USD" },
      { fx_rate: "1.108" },
    ]) {
      const [d] = rows(row(cells)).diagnostics;
      expect([d?.code, d?.params]).toEqual([
        "unconfirmedAction",
        { broker: "traderepublic", action: "FOREIGN_CURRENCY_TRADE" },
      ]);
    }
  });

  it("refuses a trade whose cash amount is not its quantity at its price", () => {
    // 2 at 180.50 is 361.00, with a fee of 1.00 either way.
    expect(codes(rows(row({ amount: "-362.00" })))).toEqual([]);
    expect(codes(rows(row({ amount: "-362.02" })))).toEqual([
      "tradeInconsistent",
    ]);
    expect(codes(rows(row({ price: "18050.000000" })))).toEqual([
      "tradeInconsistent",
    ]);
    expect(codes(rows(row({ amount: "" })))).toEqual(["invalidNumber"]);
  });

  it("reads its columns in any order, after a byte-order mark", () => {
    const shuffled = [...TRADE_REPUBLIC_COLUMNS].reverse();
    const line = (values: Record<string, string>) =>
      shuffled.map((c) => `"${values[c] ?? ""}"`).join(",");
    const values: Record<string, string> = {
      datetime: "2026-03-10T14:05:12.000Z",
      date: "2026-03-10",
      account_type: "DEFAULT",
      category: "TRADING",
      type: "BUY",
      asset_class: "STOCK",
      symbol: "US0378331005",
      shares: "2.0000000000",
      price: "180.500000",
      amount: "-361.00",
      currency: "EUR",
      transaction_id: "00000000-0000-4000-8000-000000000098",
    };
    const text = `${String.fromCharCode(0xfeff)}${shuffled.map((c) => `"${c}"`).join(",")}\n${line(values)}`;
    const result = read(text);
    expect(result.format).toBe("traderepublic-csv-2026");
    expect(result.events.map((e) => e.kind)).toEqual(["trade"]);
  });
});

describe("tradeRepublic: overlapping exports", () => {
  it("are one account, so the second copy of each trade is dropped", () => {
    const first = read(fixture);
    const second = read(`${fixture}\n`);
    expect(second.events[0]?.source.fileId).not.toBe(
      first.events[0]?.source.fileId,
    );
    expect(second.events[0]?.account).toBe(first.events[0]?.account);
    const all: LedgerEvent[] = [...first.events, ...second.events];
    const keyed = first.events.filter((e) => e.kind !== "ignored").length;
    const ledger = validateLedger(all);
    expect(ledger.diagnostics).toEqual([
      {
        severity: "info",
        code: "duplicatesRemoved",
        params: { count: keyed },
      },
    ]);
  });

  it("names the account whatever group the file was put in", () => {
    const bytes = new TextEncoder().encode(fixture);
    const groups = [1, 2].map(
      (accountGroup) =>
        importFile({ bytes, fileId: fileIdOf(bytes), accountGroup }).events[0]
          ?.account,
    );
    expect(groups[0]).toBe(groups[1]);
    expect(groups[0]).toMatch(/^traderepublic:[0-9a-f]+$/);
  });
});

type ValueDateCells = Partial<
  Record<(typeof TRADE_REPUBLIC_VALUE_DATE_COLUMNS)[number], string>
>;

const VALUE_DATE_HEADER = TRADE_REPUBLIC_VALUE_DATE_COLUMNS.join(";");

/**
 * One row of the semicolon revision, unquoted as it writes them: a fund
 * purchase unless told otherwise, at midnight UTC on its date.
 */
function valueDateRow(cells: ValueDateCells = {}): string {
  const all: ValueDateCells = {
    datetime: "2026-02-02T00:00:00.000000Z",
    date: "2026-02-02",
    account_type: "DEFAULT",
    category: "TRADING",
    type: "BUY",
    asset_class: "FUND",
    name: "Core MSCI World USD (Acc)",
    symbol: "IE00B4L5Y983",
    shares: "1.4000000000",
    price: "107.150000",
    amount: "-150.01",
    currency: "EUR",
    transaction_id: "00000000-0000-4000-8000-000000000199",
    value_date: "2026-02-04",
    ...cells,
  };
  return TRADE_REPUBLIC_VALUE_DATE_COLUMNS.map((c) => all[c] ?? "").join(";");
}

const valueDateRows = (...lines: string[]) =>
  read([VALUE_DATE_HEADER, ...lines].join("\n"));

const trades = (result: ImportResult) =>
  result.events.filter((e): e is TradeEvent => e.kind === "trade");

/** Each row's outcome: its blocking code, "ignored:<reason>" or its kind. */
function outcome(result: ImportResult): string | undefined {
  const blocking = result.diagnostics.find((d) => d.severity === "blocking");
  const [event] = result.events;
  return (
    blocking?.code ??
    (event?.kind === "ignored" ? `ignored:${event.reason}` : event?.kind)
  );
}

describe("tradeRepublic: the semicolon revision with value_date", () => {
  const result = read(valueDateFixture);

  it("is recognized by its own 23 columns, written with semicolons", () => {
    expect([result.broker, result.format]).toEqual([
      "traderepublic",
      "traderepublic-csv-value-date",
    ]);
  });

  it("dates every row by `date` alone: its datetime is midnight, no time", () => {
    expect(
      trades(result).map((t) => [
        t.side,
        t.date,
        t.security.isin,
        t.quantity.toString(),
        t.price.amount.toString(),
        t.security.isFund === true,
      ]),
    ).toEqual([
      ["buy", "2025-12-01", "IE00B4L5Y983", "1.5", "100", true],
      ["buy", "2026-01-05", "FR0000121014", "1", "600", false],
      ["buy", "2026-02-02", "IE00B4L5Y983", "1.4", "107.15", true],
      ["sell", "2026-06-15", "IE00B4L5Y983", "2", "115", true],
    ]);
    // No instant: the export gives none, and the settlement is not one.
    expect(trades(result)[0]?.at).toEqual({
      instant: null,
      brokerDate: "2025-12-01",
    });
  });

  it("ignores its cash rows by reason, and accounts for every row", () => {
    expect(
      result.events
        .filter((e) => e.kind === "ignored")
        .map((e) => [e.source.row, e.reason]),
    ).toEqual([
      [2, "deposit"],
      [6, "interest"],
      [8, "withdrawal"],
    ]);
    const lines = valueDateFixture.trim().split("\n").length - 1;
    expect(new Set(result.events.map((e) => e.source.row)).size).toBe(lines);
    expect(result.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ["warning", "interestNotCovered"],
    ]);
    expect(result.reach[0]?.lastDate).toBe("2026-07-01");
  });

  it("gives a ledger the engine takes, the sale matched first in, first out", () => {
    const ledger = validateLedger(result.events);
    expect(ledger.diagnostics).toEqual([]);
    const fifo = matchFifo(ledger);
    expect(fifo.diagnostics).toEqual([]);
    expect(
      fifo.securities
        .get("IE00B4L5Y983")
        ?.disposals.map((d) =>
          d.matches.map((m) => [m.purchase.date, m.quantity.toString()]),
        ),
    ).toEqual([
      [
        ["2025-12-01", "1.5"],
        ["2026-02-02", "0.5"],
      ],
    ]);
  });

  it("refuses a datetime that is not its date at midnight, as the revision writes it", () => {
    for (const datetime of [
      "2026-02-02T09:30:00.000000Z",
      "2026-02-01T00:00:00.000000Z",
      "2026-02-02T00:00:00.000Z",
      "2026-02-02T00:00:00Z",
      "",
    ]) {
      expect(
        codes(valueDateRows(valueDateRow({ datetime }))),
        datetime,
      ).toEqual(["invalidTime"]);
    }
  });

  it("never reads value_date: settlement, not a tax date", () => {
    // Two files, two IDs: everything else is alike.
    const rowsOf = (result: ImportResult) =>
      result.events.map((e) => ({ ...e, source: e.source.row }));
    const settled = valueDateRows(valueDateRow());
    const changed = valueDateRows(valueDateRow({ value_date: "not a date" }));
    expect(rowsOf(changed)).toEqual(rowsOf(settled));
    expect(changed.diagnostics).toEqual(settled.diagnostics);
  });

  it("keys a trade alike in both revisions, so overlapping exports read it once", () => {
    // The same purchase, exported once with its time and once without.
    const timed = rows(
      row({
        datetime: "2026-03-10T14:05:12.000Z",
        transaction_id: "00000000-0000-4000-8000-000000000301",
      }),
    );
    const untimed = valueDateRows(
      valueDateRow({
        datetime: "2026-03-10T00:00:00.000000Z",
        date: "2026-03-10",
        asset_class: "STOCK",
        name: "Apple",
        symbol: "US0378331005",
        shares: "2.0000000000",
        price: "180.500000",
        amount: "-361.00",
        fee: "-1.00",
        transaction_id: "00000000-0000-4000-8000-000000000301",
      }),
    );
    const ledger = validateLedger([...timed.events, ...untimed.events]);
    expect(ledger.diagnostics).toEqual([
      { severity: "info", code: "duplicatesRemoved", params: { count: 1 } },
    ]);
  });
});

describe("tradeRepublic: each header, with its own delimiter", () => {
  it("reads the comma revision unquoted as it reads it quoted", () => {
    const unquoted = read(fixture.replaceAll('"', ""));
    const quoted = read(fixture);
    expect(unquoted.format).toBe("traderepublic-csv-2026");
    expect(unquoted.diagnostics).toEqual(quoted.diagnostics);
    expect(
      unquoted.events.map((e) => ({ ...e, source: e.source.row })),
    ).toEqual(quoted.events.map((e) => ({ ...e, source: e.source.row })));
  });

  it("does not know a header written with the other revision's delimiter", () => {
    // A re-save in another locale: its numbers and dates may have changed
    // with its delimiter, so the file fails whole.
    expect(codes(read(fixture.replaceAll(",", ";")))).toEqual([
      "unknownFormat",
    ]);
    const commas = [VALUE_DATE_HEADER, valueDateRow()].map((line) =>
      line.replaceAll(";", ","),
    );
    expect(codes(read(commas.join("\n")))).toEqual(["unknownFormat"]);
    // The fixture's descriptions hold commas: re-saved, it cannot even be
    // split into rows.
    expect(codes(read(valueDateFixture.replaceAll(";", ",")))).toEqual([
      "unreadableFile",
    ]);
  });
});

describe("tradeRepublic: what a row is comes before its date", () => {
  // A dividend correction booked a day after its date, as a real export
  // shows (07 §4.2): the date and time disagree.
  const correction = row({
    datetime: "2026-03-28T12:17:14.638045Z",
    date: "2026-03-27",
    category: "CASH",
    type: "DIVIDEND",
    price: "",
    amount: "-32.270000",
    fee: "",
    tax: "8.25",
  });

  it("refuses a row its type refuses for that, though it cannot be dated", () => {
    expect(codes(rows(correction))).toEqual(["unconfirmedAction"]);
    expect(codes(rows(row({ date: "2026-03-11", type: "STOCKPERK" })))).toEqual(
      ["unsupportedAction"],
    );
    expect(codes(rows(row({ date: "2026-03-11", type: "SECRET" })))).toEqual([
      "unknownAction",
    ]);
  });

  it("moves the file's reach for a refused row only when the row is dated", () => {
    expect(rows(correction).reach).toEqual([]);
    const dated = rows(row({ type: "STOCKPERK" }));
    expect(dated.reach.map((r) => r.lastDate)).toEqual(["2026-03-10"]);
  });

  it("still dates every row it reads, an ignored one included", () => {
    expect(
      codes(
        rows(
          row({
            date: "2026-03-11",
            category: "CASH",
            type: "CUSTOMER_INBOUND",
            symbol: "",
            shares: "",
            price: "",
          }),
        ),
      ),
    ).toEqual(["invalidTime"]);
  });
});

describe("tradeRepublic: the types and classes real exports show", () => {
  const cash = {
    category: "CASH",
    asset_class: "",
    name: "",
    symbol: "",
    shares: "",
    price: "",
    fee: "",
  };
  const fundCash = {
    category: "CASH",
    asset_class: "FUND",
    name: "S&P 500 EUR (Dist)",
    symbol: "LU0496786574",
    shares: "24.9188000000",
    price: "",
    fee: "",
  };

  it("makes each an event, an ignored row or a named finding", () => {
    const cases: [Cells, string][] = [
      [{ ...cash, type: "TRANSFER_IN", amount: "53.00" }, "ignored:deposit"],
      [{ ...cash, type: "TRANSFER_INBOUND", amount: "300" }, "ignored:deposit"],
      [{ ...cash, type: "TRANSFER_OUT", amount: "-53" }, "ignored:withdrawal"],
      [
        { ...cash, type: "TRANSFER_DIRECT_DEBIT_INBOUND", amount: "-9.99" },
        "ignored:withdrawal",
      ],
      [{ ...cash, type: "GIFT", amount: "-101.00" }, "ignored:gift"],
      [{ ...cash, type: "GIFT", amount: "26.00" }, "ignored:gift"],
      [
        { ...cash, type: "BENEFITS_SAVEBACK", amount: "0.09" },
        "ignored:cardSpending",
      ],
      // Gifts and Saveback of a security are not cash: refused.
      [{ type: "GIFT" }, "unsupportedAction"],
      [{ type: "BENEFITS_SAVEBACK" }, "unsupportedAction"],
      [
        { ...fundCash, type: "DISTRIBUTION", amount: "11.46" },
        "unconfirmedAction",
      ],
      [
        { ...fundCash, type: "DIVIDEND_EQUIVALENT_PAYMENT", amount: "41.56" },
        "unsupportedAction",
      ],
      [
        { ...fundCash, type: "INTEREST_PAYMENT", asset_class: "BOND" },
        "unsupportedAction",
      ],
      [
        { ...fundCash, type: "SEC_ACCOUNT", asset_class: "BOND" },
        "unsupportedAction",
      ],
      [
        { ...fundCash, type: "TILG", asset_class: "DERIVATIVE" },
        "unsupportedAction",
      ],
      [
        { category: "CORPORATE_ACTION", type: "WARRANT_EXERCISE" },
        "unsupportedAction",
      ],
      [{ asset_class: "SYNTHETIC" }, "unsupportedAction"],
      [{ asset_class: "DERIVATIVE" }, "ignored:derivative"],
      [{ type: "SELL", asset_class: "DERIVATIVE" }, "ignored:derivative"],
    ];
    for (const [cells, expected] of cases) {
      expect(outcome(rows(row(cells))), JSON.stringify(cells)).toBe(expected);
    }
  });

  it("names a bond's coupon by its class, an export token, not its type", () => {
    const [d] = rows(
      row({ ...fundCash, type: "INTEREST_PAYMENT", asset_class: "BOND" }),
    ).diagnostics;
    expect(d?.params).toEqual({ broker: "traderepublic", action: "BOND" });
  });

  it("leaves derivative trades out with a warning, as Interactive Brokers' are", () => {
    const result = rows(
      row({ asset_class: "DERIVATIVE" }),
      row({
        asset_class: "DERIVATIVE",
        transaction_id: "00000000-0000-4000-8000-000000000400",
      }),
    );
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "derivativesNotCovered",
        params: { broker: "traderepublic", count: 2 },
      },
    ]);
  });

  it("ignores German tax rows only in their shape: an amount of 0 and a tax", () => {
    const optimization = {
      ...cash,
      type: "TAX_OPTIMIZATION",
      amount: "0.000000",
      tax: "15.33",
    };
    const earnings = {
      ...fundCash,
      type: "EARNINGS",
      amount: "0.000000",
      tax: "-0.08",
    };
    const base = { ...earnings, type: "PRE_DETERMINED_TAX_BASE", tax: "-0.33" };
    const cases: [Cells, string][] = [
      [optimization, "ignored:brokerTaxSettlement"],
      [{ ...optimization, tax: "-4.21" }, "ignored:brokerTaxSettlement"],
      [earnings, "ignored:brokerTaxSettlement"],
      [base, "ignored:brokerTaxSettlement"],
      // Money moved, no tax, a security where none belongs, or none where
      // one does: not the known shape, so not guessed at.
      [{ ...optimization, amount: "1.49" }, "unconfirmedAction"],
      [{ ...optimization, tax: "" }, "unconfirmedAction"],
      [{ ...optimization, tax: "0.00" }, "unconfirmedAction"],
      [{ ...optimization, symbol: "LU0496786574" }, "unconfirmedAction"],
      [{ ...earnings, amount: "0.21" }, "unconfirmedAction"],
      [{ ...earnings, asset_class: "STOCK" }, "unconfirmedAction"],
      [{ ...earnings, symbol: "" }, "unconfirmedAction"],
      [{ ...base, tax: "x" }, "unconfirmedAction"],
    ];
    for (const [cells, expected] of cases) {
      expect(outcome(rows(row(cells))), JSON.stringify(cells)).toBe(expected);
    }
  });

  it("counts German tax rows and taxed sales in one warning; the sales are read", () => {
    const result = rows(
      row({
        ...cash,
        type: "TAX_OPTIMIZATION",
        amount: "0.000000",
        tax: "0.10",
      }),
      // A fund sale with German capital-gains tax beside its gross amount.
      row({
        type: "SELL",
        shares: "-2.0000000000",
        amount: "361.00",
        tax: "-12.40",
        transaction_id: "00000000-0000-4000-8000-000000000401",
      }),
    );
    expect(trades(result)).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "brokerTaxSettled",
        params: { broker: "traderepublic", count: 2 },
      },
    ]);
  });

  it("never widens a trade's amount check for a tax", () => {
    // Real exports give `amount` gross: 2 at 180.50 is 361.00 whatever tax
    // stands beside it, and an amount net of a tax is not that.
    expect(codes(rows(row({ tax: "-1.44" })))).toEqual([]);
    expect(codes(rows(row({ amount: "-363.44", tax: "-1.44" })))).toEqual([
      "tradeInconsistent",
    ]);
    expect(codes(rows(row({ tax: "1,44" })))).toEqual(["invalidNumber"]);
  });

  it("refuses a child's account once per file, reading none of its rows", () => {
    const junior = (cells: Cells) => row({ account_type: "JUNIOR", ...cells });
    const result = rows(
      junior({}),
      junior({ transaction_id: "00000000-0000-4000-8000-000000000402" }),
      junior({ ...cash, type: "TRANSFER_IN", amount: "1.00" }),
    );
    expect(result.events).toEqual([]);
    expect(result.reach).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        severity: "blocking",
        code: "juniorAccount",
        params: { broker: "traderepublic" },
        source: { fileId: result.diagnostics[0]?.source?.fileId, row: 2 },
      },
    ]);
    // The taxpayer's own rows beside it are still read.
    expect(trades(rows(junior({}), row()))).toHaveLength(1);
  });

  it("keeps a row's description, names and IBANs out of every finding", () => {
    const secret = {
      description: "Outgoing transfer for SECRET NAME (SI56000000000000000)",
      counterparty_name: "SECRET NAME",
      counterparty_iban: "SI56000000000000000",
    };
    const result = rows(
      row({ ...cash, type: "SECRET_TYPE", amount: "-5", ...secret }),
      row({ ...cash, type: "DIVIDEND", ...secret }),
      row({ account_type: "JUNIOR", ...secret }),
    );
    expect(result.diagnostics).toHaveLength(3);
    for (const d of result.diagnostics) {
      expect(JSON.stringify(forExport(d))).not.toMatch(/SECRET|SI56/);
    }
  });
});
