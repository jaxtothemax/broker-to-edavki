/**
 * eToro's account statement (ADR 0020), on the synthetic statements of
 * ./testing/etoro.ts: no real export has been read yet (R1).
 */
import {
  Decimal,
  diagnostic,
  forExport,
  matchFifo,
  scopeLedger,
  validateLedger,
  type Diagnostic,
  type FileId,
  type LedgerEvent,
  type TradeEvent,
} from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { importFile, importXlsx, type ImportResult } from "./adapter.js";
import { ETORO, etoro } from "./etoro.js";
import {
  activityRow,
  ACTIVITY_HEADER,
  APPLE,
  CANARY,
  CLOSED_HEADER,
  closing,
  deposit,
  DIVIDEND_HEADER,
  DIVIDEND_HEADER_2025_11,
  dividendPaid,
  EXXON,
  n,
  opened,
  payment,
  position,
  ROUND_TRIP,
  statement,
  without,
  type Payment,
  type Row,
  type Statement,
} from "./testing/etoro.js";
import type { SheetSpec } from "./testing/workbook.js";
import { openWorkbook, type Workbook } from "./xlsx.js";

const context = { fileId: "0123456789abcdef" as FileId, accountGroup: 1 };

const read = (spec: Statement = ROUND_TRIP): ImportResult =>
  importXlsx(statement(spec), context, [etoro]);

const blocking = (result: ImportResult) =>
  result.diagnostics.filter((d) => d.severity === "blocking");
const codes = (result: ImportResult) => blocking(result).map((d) => d.code);
const trades = (result: ImportResult) =>
  result.events.filter((e): e is TradeEvent => e.kind === "trade");
const plain = (value: Decimal) => value.toPlain(12, "halfUp");
const at = (part: string, row: number) => ({
  fileId: context.fileId,
  row,
  part,
});

/** One blocking finding at a row of a sheet, by its code and parameters. */
const refusal = (
  code: Diagnostic["code"],
  params: object,
  part: string,
  row: number,
) => diagnostic("blocking", code as never, params as never, at(part, row));

/**
 * Every data row of the three sheets read is an event, an ignored row, or
 * the source of a blocking finding: none is dropped (CLAUDE.md).
 */
function unaccounted(spec: Statement, result: ImportResult): string[] {
  const covered = new Set([
    ...result.events.map(
      (e) => `${e.source.part ?? ""}:${String(e.source.row)}`,
    ),
    ...blocking(result).map((d) =>
      d.source === undefined
        ? ""
        : `${d.source.part ?? ""}:${String(d.source.row)}`,
    ),
  ]);
  const rows = [
    ...(spec.closed ?? []).map((_, i) => `closedPositions:${String(i + 2)}`),
    ...(spec.activity ?? []).map((_, i) => `accountActivity:${String(i + 2)}`),
    ...(spec.dividends ?? []).map((_, i) => `dividends:${String(i + 2)}`),
  ];
  return rows.filter((row) => !covered.has(row));
}

describe("etoro, choosing the statement", () => {
  it("is chosen by its five sheets, whatever their order", () => {
    const result = importFile({ bytes: statement(), ...context });
    expect(result.broker).toBe(ETORO);
    expect(result.format).toBe("etoro-xlsx-2025.2.15");
    expect(codes(result)).toEqual([]);
    const shuffled = read({
      ...ROUND_TRIP,
      sheets: (sheets) => [...sheets].reverse(),
    });
    expect(codes(shuffled)).toEqual([]);
    expect(trades(shuffled)).toEqual(trades(result));
  });

  it("is not chosen without one of its sheets, nor in another language", () => {
    for (const sheets of [
      (all: SheetSpec[]) => all.slice(1),
      (all: SheetSpec[]) =>
        all.map((s) =>
          s.name === "Closed Positions"
            ? { ...s, name: "Posiciones cerradas" }
            : s,
        ),
    ]) {
      expect(
        importFile({ bytes: statement({ ...ROUND_TRIP, sheets }), ...context })
          .diagnostics,
      ).toEqual([diagnostic("blocking", "unknownFormat", {})]);
    }
  });

  it("refuses a sheet it does not know, by its position, reading nothing", () => {
    const result = read({
      ...ROUND_TRIP,
      sheets: (sheets) => [...sheets, { name: "Notes", data: "" }],
    });
    expect(result.diagnostics).toEqual([
      diagnostic("blocking", "unknownSheet", { sheet: 6 }),
    ]);
    expect(result.events).toEqual([]);
  });

  it("refuses a hidden sheet it reads, but not a hidden one it skips", () => {
    const hide = (name: string) => (sheets: SheetSpec[]) =>
      sheets.map((s) => (s.name === name ? { ...s, state: "hidden" } : s));
    expect(
      read({ ...ROUND_TRIP, sheets: hide("Dividends") }).diagnostics,
    ).toEqual([diagnostic("blocking", "hiddenSheet", { sheet: 4 })]);
    expect(
      codes(read({ ...ROUND_TRIP, sheets: hide("Account Summary") })),
    ).toEqual([]);
  });

  it("warns of hidden rows in a sheet it reads, and reads them", () => {
    const result = read({
      ...ROUND_TRIP,
      sheets: (sheets) =>
        sheets.map((s) =>
          s.name === "Closed Positions"
            ? {
                ...s,
                data: (s.data ?? "").replace(
                  '<row r="2">',
                  '<row r="2" hidden="1">',
                ),
              }
            : s,
        ),
    });
    expect(result.diagnostics).toContainEqual(
      diagnostic("warning", "hiddenCells", { sheet: 2 }),
    );
    expect(trades(result)).toHaveLength(3);
  });
});

describe("etoro, its columns", () => {
  it("reads every layout it accepts, its columns in any order", () => {
    const expected = trades(read());
    const dividends = (result: ImportResult) =>
      result.events.filter((e) => e.kind !== "trade" && e.kind !== "ignored");
    const base = dividends(read());
    expect(base).toHaveLength(2);
    for (const spec of [
      // A statement saved again by a third party lacked the EUR columns.
      { closedHeader: without(CLOSED_HEADER, "Profit(EUR)") },
      {
        dividendHeader: without(
          DIVIDEND_HEADER,
          "Net Dividend Received (EUR)",
          "Withholding Tax Amount (EUR)",
        ),
      },
      { dividendHeader: DIVIDEND_HEADER_2025_11 },
      {
        dividendHeader: without(
          DIVIDEND_HEADER_2025_11,
          "Net Dividend Received (EUR)",
        ),
      },
      {
        closedHeader: [...CLOSED_HEADER].reverse(),
        activityHeader: [...ACTIVITY_HEADER].reverse(),
        dividendHeader: [...DIVIDEND_HEADER].reverse(),
      },
    ]) {
      const result = read({ ...ROUND_TRIP, ...spec });
      expect(codes(result), JSON.stringify(spec)).toEqual([]);
      expect(trades(result)).toEqual(expected);
      expect(dividends(result)).toEqual(base);
    }
    expect(
      read({ ...ROUND_TRIP, dividendHeader: DIVIDEND_HEADER_2025_11 }).format,
    ).toBe("etoro-xlsx-2025.11");
  });

  it("refuses the older layouts, which another export replaces", () => {
    // 2025.1: Units, not Units / Contracts, and no ISIN.
    const closed2025 = [
      ...without(CLOSED_HEADER, "Units / Contracts", "ISIN"),
      "Units",
    ];
    const result = read({ ...ROUND_TRIP, closedHeader: closed2025 });
    expect(result.events).toEqual([]);
    expect(blocking(result)).toEqual([
      diagnostic(
        "blocking",
        "columnMissing",
        { broker: ETORO, column: "Units / Contracts" },
        at("closedPositions", 1),
      ),
      diagnostic(
        "blocking",
        "columnMissing",
        { broker: ETORO, column: "ISIN" },
        at("closedPositions", 1),
      ),
      diagnostic(
        "blocking",
        "unknownColumn",
        {
          broker: ETORO,
          position: 22,
          column: expect.objectContaining({ untrusted: "Units" }) as never,
        },
        at("closedPositions", 1),
      ),
    ]);
    // Dividends of 2025.1, without ISIN; half of 2025.11's columns.
    expect(
      codes(
        read({
          ...ROUND_TRIP,
          dividendHeader: without(DIVIDEND_HEADER, "ISIN"),
        }),
      ),
    ).toEqual(["columnMissing"]);
    expect(
      blocking(
        read({
          ...ROUND_TRIP,
          dividendHeader: without(DIVIDEND_HEADER_2025_11, "Currency"),
        }),
      ).map((d) => d.params),
    ).toEqual([{ broker: ETORO, column: "Currency" }]);
    // Account Activity of 2023.
    expect(
      codes(
        read({
          ...ROUND_TRIP,
          activityHeader: [
            ...without(ACTIVITY_HEADER, "Units / Contracts"),
            "Units",
          ],
        }),
      ),
    ).toEqual(["columnMissing", "unknownColumn"]);
  });

  it("refuses an unknown column even when it is empty, and a repeated one", () => {
    expect(
      blocking(
        read({ ...ROUND_TRIP, closedHeader: [...CLOSED_HEADER, "Fees"] }),
      ),
    ).toEqual([
      diagnostic(
        "blocking",
        "unknownColumn",
        {
          broker: ETORO,
          position: CLOSED_HEADER.length + 1,
          column: expect.objectContaining({ untrusted: "Fees" }) as never,
        },
        at("closedPositions", 1),
      ),
    ]);
    expect(
      blocking(
        read({ ...ROUND_TRIP, closedHeader: [...CLOSED_HEADER, "ISIN"] }),
      ),
    ).toEqual([
      diagnostic("blocking", "unreadableFile", {
        reason: "duplicateHeaderName",
        row: 1,
        sheet: 2,
        column: CLOSED_HEADER.length + 1,
      }),
    ]);
  });

  it("refuses a value in a column with no header", () => {
    const result = read({
      ...ROUND_TRIP,
      sheets: (sheets) =>
        sheets.map((s) =>
          s.name === "Closed Positions"
            ? {
                ...s,
                data: (s.data ?? "").replace(
                  /<\/row>$/,
                  `<c r="AA2"><v>1</v></c></row>`,
                ),
              }
            : s,
        ),
    });
    expect(blocking(result)).toEqual([
      diagnostic("blocking", "unreadableFile", {
        reason: "rowLength",
        row: 2,
        sheet: 2,
        column: 27,
      }),
    ]);
  });
});

describe("etoro, its values", () => {
  const swap = (rows: readonly Row[], i: number, change: Row) =>
    rows.map((row, j) => (j === i ? { ...row, ...change } : row));

  it("refuses the whole file for a regional format, brackets or a serial", () => {
    const cases: [Statement, string][] = [
      [
        {
          ...ROUND_TRIP,
          activity: swap(ROUND_TRIP.activity, 1, {
            Date: "05.01.2024 19:15:25",
          }),
        },
        "regionalDate",
      ],
      [
        {
          ...ROUND_TRIP,
          closed: swap(ROUND_TRIP.closed, 0, {
            "Units / Contracts": "1,650619",
          }),
        },
        "regionalNumber",
      ],
      // A thousands separator: "1,071.56" is no number this reads.
      [
        {
          ...ROUND_TRIP,
          closed: swap(ROUND_TRIP.closed, 0, { "Open Rate": "1,071.56" }),
        },
        "regionalNumber",
      ],
      [
        {
          ...ROUND_TRIP,
          closed: swap(ROUND_TRIP.closed, 0, { "Profit(USD)": "(0.92)" }),
        },
        "bracketNegative",
      ],
      [
        {
          ...ROUND_TRIP,
          dividends: swap(ROUND_TRIP.dividends, 0, {
            "Date of Payment": n("45337"),
          }),
        },
        "serialDate",
      ],
    ];
    for (const [spec, format] of cases) {
      const result = read(spec);
      expect(result.diagnostics, format).toEqual([
        diagnostic("blocking", "statementFormat", {
          broker: ETORO,
          format: format as never,
        }),
      ]);
      expect(result.events).toEqual([]);
    }
  });

  it("reads units written as text or as a number cell alike", () => {
    const asNumber = read({
      ...ROUND_TRIP,
      closed: swap(ROUND_TRIP.closed, 0, {
        "Units / Contracts": n("1.650619"),
      }),
      activity: swap(ROUND_TRIP.activity, 1, {
        "Units / Contracts": n("1.6506190000000001"),
      }),
    });
    expect(codes(asNumber)).toEqual([]);
    expect(trades(asNumber)).toEqual(trades(read()));
  });

  it("reads a position ID written as a number cell", () => {
    const asNumber = read({
      ...ROUND_TRIP,
      closed: swap(ROUND_TRIP.closed, 0, { "Position ID": n("1001") }),
    });
    expect(codes(asNumber)).toEqual([]);
    expect(trades(asNumber)).toEqual(trades(read()));
  });
});

describe("etoro, the whole history or nothing", () => {
  it("refuses a statement that starts with money in the account", () => {
    const later = read({
      ...ROUND_TRIP,
      activity: [
        activityRow("Deposit", "02/01/2024 10:00:00", {
          amount: n("100"),
          equity: ["100", "4391.25"],
        }),
        ...ROUND_TRIP.activity.slice(1),
      ],
    });
    expect(later.diagnostics).toEqual([
      diagnostic("blocking", "historyIncomplete", {
        broker: ETORO,
        gap: "start",
      }),
    ]);
    expect(later.events).toEqual([]);
  });

  it("refuses activity out of date order", () => {
    const [first, a, b, ...rest] = ROUND_TRIP.activity;
    const result = read({
      ...ROUND_TRIP,
      activity: [first, b, a, ...rest],
    });
    expect(codes(result)).toEqual(["historyIncomplete"]);
    expect(blocking(result)[0]?.params).toEqual({
      broker: ETORO,
      gap: "order",
    });
  });

  it("refuses a position with no opening row, or with two", () => {
    for (const activity of [
      ROUND_TRIP.activity.filter((_, i) => i !== 1),
      [
        ...ROUND_TRIP.activity.slice(0, 2),
        opened("1001", "05/01/2024 19:15:25", "AAPL/USD", "300", "1.650619"),
        ...ROUND_TRIP.activity.slice(2),
      ],
    ]) {
      expect(read({ ...ROUND_TRIP, activity }).diagnostics).toEqual([
        diagnostic("blocking", "historyIncomplete", {
          broker: ETORO,
          gap: "openRow",
        }),
      ]);
    }
    // A dividend of a position the statement never opened.
    expect(
      blocking(
        read({
          ...ROUND_TRIP,
          dividends: [
            ...ROUND_TRIP.dividends,
            payment({
              date: "11/03/2024",
              id: "9999",
              net: "3.95",
              rate: "10 %",
              withheld: n("0.43890000000000001"),
              isin: EXXON,
            }),
          ],
        }),
      ).map((d) => d.params),
    ).toEqual([{ broker: ETORO, gap: "openRow" }]);
  });
});

describe("etoro, lots", () => {
  it("makes a closed position a purchase and a sale at its rates, in dollars", () => {
    const result = read();
    expect(codes(result)).toEqual([]);
    const [buy, sale, open] = trades(result);
    expect(buy).toMatchObject({
      side: "buy",
      date: "2024-01-05",
      at: { instant: "2024-01-05T19:15:25Z", brokerDate: "2024-01-05" },
      security: { isin: APPLE, symbol: "AAPL" },
      source: at("closedPositions", 2),
    });
    expect(plain(buy?.quantity as Decimal)).toBe("1.650619");
    expect(plain(buy?.price.amount as Decimal)).toBe("181.75");
    expect(buy?.price.currency).toBe("USD");
    expect(sale).toMatchObject({ side: "sell", date: "2024-01-16" });
    expect(plain(sale?.price.amount as Decimal)).toBe("182.31");
    // Still open: the amount invested over its units, kept exact.
    expect(open).toMatchObject({
      side: "buy",
      date: "2024-01-08",
      source: at("accountActivity", 4),
    });
    expect(
      open?.price.amount.equals(
        Decimal.parse("200").dividedBy(Decimal.parse("1.1")),
      ),
    ).toBe(true);
    expect(result.diagnostics).toContainEqual(
      diagnostic("warning", "openPositionsAssumed", {
        broker: ETORO,
        count: 1,
      }),
    );
    expect(result.reach).toEqual([
      { account: "etoro:1", lastDate: "2024-02-15" },
    ]);
    expect(result.wholeHistory).toBe(true);
    expect(unaccounted(ROUND_TRIP, result)).toEqual([]);
  });

  it("passes the ledger, the exact open price included", () => {
    const result = read();
    const ledger = validateLedger(result.events, result.diagnostics);
    expect(ledger.diagnostics.filter((d) => d.severity === "blocking")).toEqual(
      [],
    );
    expect(ledger.events).toHaveLength(result.events.length);
  });

  it("takes an earlier open lot before the closed position's own (FIFO)", () => {
    // A1 bought first and still open, A2 bought and sold later: FIFO per
    // ISIN sells A1's shares, whatever eToro calls the position.
    const spec: Statement = {
      activity: [
        deposit(),
        opened("2001", "03/01/2024 15:00:00", "AAPL/USD", "180", "1"),
        opened("2002", "10/01/2024 15:00:00", "AAPL/USD", "190", "1"),
        closing("2002", "20/02/2024 15:00:00", "AAPL/USD", "200", "1"),
      ],
      closed: [
        position({
          id: "2002",
          amount: "190",
          units: "1",
          open: "10/01/2024 15:00:00",
          close: "20/02/2024 15:00:00",
          profit: "10",
          openRate: "190",
          closeRate: "200",
          isin: APPLE,
        }),
      ],
    };
    const result = read(spec);
    expect(codes(result)).toEqual([]);
    const fifo = matchFifo(validateLedger(result.events));
    const history = fifo.securities.get(APPLE);
    const [disposal] = history?.disposals ?? [];
    expect(disposal?.matches.map((m) => m.purchase.date)).toEqual([
      "2024-01-03",
    ]);
    expect(plain(disposal?.matches[0]?.purchase.price.amount as Decimal)).toBe(
      "180",
    );
    expect(history?.open.map((lot) => lot.purchase.date)).toEqual([
      "2024-01-10",
    ]);
  });

  it("takes a Trading 212 lot of the same ISIN before an eToro one (FIFO across brokers)", () => {
    const t212 = new TextEncoder().encode(
      [
        "Action,Time (UTC),ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),French transaction tax,Currency (French transaction tax),Currency conversion fee,Currency (Currency conversion fee)",
        `Market buy,2023-12-01 15:00:00+00:00,${APPLE},AAPL,"Apple",,EOF0000009001,1.0000000000,150.0000000000,USD,1.08000000,,,138.89,"EUR",,,,,,`,
      ].join("\n"),
    );
    const other = importFile({
      bytes: t212,
      fileId: "fedcba9876543210" as FileId,
      accountGroup: 1,
    });
    expect(other.broker).toBe("trading212");
    const result = read();
    const ledger = validateLedger([...other.events, ...result.events]);
    const history = matchFifo(ledger).securities.get(APPLE);
    // eToro's sale of 1.650619 takes Trading 212's share first, then the
    // rest of eToro's own first lot.
    const [disposal] = history?.disposals ?? [];
    expect(
      disposal?.matches.map((m) => [m.purchase.broker, plain(m.quantity)]),
    ).toEqual([
      ["trading212", "1"],
      [ETORO, "0.650619"],
    ]);
    expect(
      history?.open.map((lot) => [lot.purchase.broker, plain(lot.quantity)]),
    ).toEqual([
      [ETORO, "1"],
      [ETORO, "1.1"],
    ]);
  });

  it("refuses partial closes in either shape", () => {
    const twoRows = read({
      ...ROUND_TRIP,
      closed: [...ROUND_TRIP.closed, ...ROUND_TRIP.closed],
    });
    expect(blocking(twoRows)).toEqual(
      [2, 3].map((row) =>
        refusal(
          "unsupportedAction",
          { broker: ETORO, action: "partialClose" },
          "closedPositions",
          row,
        ),
      ),
    );
    const twoCloses = read({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity.slice(0, 4),
        closing("1001", "16/01/2024 14:34:07", "AAPL/USD", "1", "0.1"),
        ROUND_TRIP.activity[4],
      ],
    });
    expect(codes(twoCloses)).toEqual(["unsupportedAction"]);
  });

  it("refuses a position whose figures or rows disagree", () => {
    const base = ROUND_TRIP.closed[0];
    const check = (
      change: Row,
      activity: readonly Row[] = ROUND_TRIP.activity,
    ) =>
      blocking(
        read({ ...ROUND_TRIP, activity, closed: [{ ...base, ...change }] }),
      ).map((d) => (d.code === "tradeInconsistent" ? d.params.check : d.code));
    // A margin: the units at the open rate are twice the amount.
    expect(check({ Amount: n("150") })).toEqual(["amount"]);
    expect(check({ "Profit(USD)": n("10.92") })).toEqual(["closeAmount"]);
    expect(check({ "Units / Contracts": "1.65062" })).toEqual(["units"]);
    expect(check({ "Close Date": "16/01/2024 14:34:08" })).toEqual(["dates"]);
    expect(
      check(
        {},
        ROUND_TRIP.activity.map((row) =>
          row.Type === "Position closed"
            ? { ...row, "Units / Contracts": n("1.65") }
            : row,
        ),
      ),
    ).toEqual(["units"]);
    // Closed in Closed Positions, never in Account Activity.
    expect(
      check(
        {},
        ROUND_TRIP.activity.filter((_, i) => i !== 3),
      ),
    ).toEqual(["activity"]);
  });

  it("allows a cent and a millionth of the rate between the figures, and no more", () => {
    // 1.650619 at 181.75 is 300.00000325; a cent and 181.75 millionths
    // is 0.01018175. The profit keeps the close side as it was.
    const base = ROUND_TRIP.closed[0];
    const at = (amount: string, profit: string) =>
      read({
        ...ROUND_TRIP,
        closed: [{ ...base, Amount: n(amount), "Profit(USD)": n(profit) }],
      });
    expect(codes(at("299.9898215", "0.9301785"))).toEqual([]);
    expect(
      blocking(at("299.9898214", "0.9301786")).map((d) =>
        d.code === "tradeInconsistent" ? d.params.check : d.code,
      ),
    ).toEqual(["amount"]);
  });

  it("refuses a closed position so near midnight that the clock decides the sale's day", () => {
    // Summer, UTC+2: 23:30 is the 16th at UTC+0 and the 17th at UTC+3.
    const close = "16/07/2024 23:30:00";
    const [deposit_, openA, openB, , paid] = ROUND_TRIP.activity;
    const result = read({
      ...ROUND_TRIP,
      activity: [
        deposit_,
        openA,
        openB,
        paid,
        closing("1001", close, "AAPL/USD", "300.92", n("1.6506190000000001")),
      ] as Row[],
      closed: [{ ...ROUND_TRIP.closed[0], "Close Date": close }],
    });
    expect(blocking(result)).toEqual([
      refusal(
        "dateUncertain",
        { broker: ETORO, isin: APPLE, date: "2024-07-17" },
        "closedPositions",
        2,
      ),
    ]);
  });

  it("refuses short and leveraged shares, and leaves out crypto and CFDs", () => {
    const base = ROUND_TRIP.closed[0];
    const with_ = (change: Row) =>
      read({ ...ROUND_TRIP, closed: [{ ...base, ...change }] });
    expect(blocking(with_({ "Long / Short": "Short" }))).toEqual([
      refusal(
        "unsupportedAction",
        { broker: ETORO, action: "short" },
        "closedPositions",
        2,
      ),
    ]);
    expect(blocking(with_({ Leverage: "2" }))).toEqual([
      refusal(
        "unsupportedAction",
        { broker: ETORO, action: "leveraged" },
        "closedPositions",
        2,
      ),
    ]);
    expect(codes(with_({ Type: "Bonds" }))).toEqual(["unknownAction"]);
    const crypto = with_({ Type: "Crypto", ISIN: "" });
    expect(codes(crypto)).toEqual([]);
    expect(crypto.events).toContainEqual(
      expect.objectContaining({
        kind: "ignored",
        reason: "crypto",
        source: at("closedPositions", 2),
      }),
    );
    // A CFD closed and one still open: left out, with one warning.
    const cfds = read({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity,
        opened("1003", "20/02/2024 15:00:00", "NVDA/USD", "100", "2", "CFD"),
      ],
      closed: [
        { ...base, Type: "CFD", Leverage: "5", "Long / Short": "Short" },
      ],
    });
    expect(codes(cfds)).toEqual([]);
    expect(
      cfds.diagnostics.filter((d) => d.code === "derivativesNotCovered"),
    ).toEqual([
      diagnostic("warning", "derivativesNotCovered", {
        broker: ETORO,
        count: 2,
      }),
    ]);
    expect(trades(cfds).map((t) => t.source.part)).toEqual(["accountActivity"]);
  });

  it("refuses an instrument not in dollars", () => {
    const pence = read({
      ...ROUND_TRIP,
      closed: [
        { ...ROUND_TRIP.closed[0], ...{ "FX rate at open (USD)": n("1.27") } },
      ],
    });
    expect(blocking(pence)).toEqual([
      refusal(
        "unconfirmedAction",
        { broker: ETORO, action: "nonUsd" },
        "closedPositions",
        2,
      ),
    ]);
    const gbx = read({
      ...ROUND_TRIP,
      activity: ROUND_TRIP.activity.map((row) =>
        row["Position ID"] === "1001" ? { ...row, Details: "BARC.L/GBX" } : row,
      ),
    });
    expect(codes(gbx)).toEqual(["unconfirmedAction"]);
    const closedPence = read({
      ...ROUND_TRIP,
      closed: [
        { ...ROUND_TRIP.closed[0], "FX rate at close (USD)": n("1.27") },
      ],
    });
    expect(codes(closedPence)).toEqual(["unconfirmedAction"]);
    // A position still open in pence, and its dividend, paid in dollars:
    // both refused, never converted.
    const open = read({
      ...ROUND_TRIP,
      activity: ROUND_TRIP.activity.map((row) =>
        row["Position ID"] === "1002" && row.Type === "Open Position"
          ? { ...row, Details: "BARC.L/GBX" }
          : row,
      ),
    });
    const nonUsd = { broker: ETORO, action: "nonUsd" };
    expect(blocking(open)).toHaveLength(2);
    expect(blocking(open)).toContainEqual(
      refusal("unconfirmedAction", nonUsd, "accountActivity", 4),
    );
    expect(blocking(open)).toContainEqual(
      refusal("unconfirmedAction", nonUsd, "dividends", 2),
    );
  });

  it("refuses a position still open that paid an overnight fee", () => {
    const result = read({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity,
        activityRow("Overnight fee", "16/02/2024 22:00:00", {
          amount: n("-0.05"),
          id: "1002",
          details: "AAPL/USD",
          asset: "Stocks",
        }),
      ],
    });
    expect(blocking(result)).toEqual([
      refusal(
        "unsupportedAction",
        { broker: ETORO, action: "leveragedOrShort" },
        "accountActivity",
        4,
      ),
    ]);
  });

  it("refuses a position still open whose ticker names two ISINs", () => {
    const result = read({
      ...ROUND_TRIP,
      dividends: [
        ...ROUND_TRIP.dividends,
        payment({
          date: "16/02/2024",
          id: "1001",
          net: "0.1",
          rate: "0 %",
          withheld: n("0"),
          isin: "US0378331013",
        }),
      ],
      activity: [
        ...ROUND_TRIP.activity,
        dividendPaid("1001", "16/02/2024 12:00:00", "AAPL/USD", "0.1"),
      ],
    });
    expect(blocking(result)).toContainEqual(
      refusal(
        "isinUnresolved",
        { broker: ETORO, date: "2024-01-08", cause: "ambiguous" },
        "accountActivity",
        4,
      ),
    );
  });

  it("refuses a position still open with no ISIN in the file, in every year (R2, option a)", () => {
    const result = read({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity,
        opened("1004", "20/02/2024 15:00:00", "MSFT/USD", "400", "1"),
      ],
    });
    const finding = refusal(
      "isinUnresolved",
      { broker: ETORO, date: "2024-02-20", cause: "missing" },
      "accountActivity",
      7,
    );
    expect(blocking(result)).toEqual([finding]);
    // Unscoped (ADR 0017): it withholds the returns of a year it is not in.
    const ledger = validateLedger(result.events, result.diagnostics);
    const scope = scopeLedger(ledger, 2026);
    expect(scope.kdvp).toEqual([finding]);
    expect(scope.div).toEqual([finding]);
  });
});

describe("etoro, the day of a trade", () => {
  /** A position still open, bought at `time` on `day`. */
  const boughtAt = (day: string, time: string) =>
    read({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity,
        opened("1005", `${day} ${time}`, "AAPL/USD", "100", "0.5"),
      ],
    });

  it("refuses a closed position bought so near midnight that the clock decides the purchase's day", () => {
    // Winter, UTC+1: 23:30 is the 6th in Ljubljana at UTC+0, the 5th at
    // UTC+3. The finding names the sale's day, where the return is.
    const open = "05/01/2024 23:30:00";
    const result = read({
      ...ROUND_TRIP,
      activity: ROUND_TRIP.activity.map((row) =>
        row["Position ID"] === "1001" && row.Type === "Open Position"
          ? { ...row, Date: open }
          : row,
      ),
      closed: [{ ...ROUND_TRIP.closed[0], "Open Date": open }],
    });
    expect(blocking(result)).toEqual([
      refusal(
        "dateUncertain",
        { broker: ETORO, isin: APPLE, date: "2024-01-16" },
        "closedPositions",
        2,
      ),
    ]);
  });

  it("refuses a position still open that had an overnight fee refunded", () => {
    const result = read({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity,
        activityRow("Overnight refund", "16/02/2024 22:00:00", {
          amount: n("0.05"),
          id: "1002",
          details: "AAPL/USD",
          asset: "Stocks",
        }),
      ],
    });
    expect(codes(result)).toEqual(["unsupportedAction"]);
  });

  it("refuses a row whose position ID is not one, in either sheet", () => {
    expect(
      codes(
        read({
          ...ROUND_TRIP,
          closed: [{ ...ROUND_TRIP.closed[0], "Position ID": "12a" }],
        }),
      ),
    ).toContain("invalidNumber");
    expect(
      codes(
        read({
          ...ROUND_TRIP,
          activity: [
            ...ROUND_TRIP.activity,
            opened("x1", "20/02/2024 15:00:00", "AAPL/USD", "100", "0.5"),
          ],
        }),
      ),
    ).toContain("invalidNumber");
  });

  it("refuses crypto still open that paid an overnight fee, as it refuses shares", () => {
    const result = read({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity,
        opened(
          "1003",
          "20/02/2024 15:00:00",
          "BTC/USD",
          "100",
          "0.002",
          "Crypto",
        ),
        activityRow("Overnight fee", "21/02/2024 22:00:00", {
          amount: n("-0.05"),
          id: "1003",
          details: "BTC/USD",
          asset: "Crypto",
        }),
      ],
    });
    expect(blocking(result)).toEqual([
      refusal(
        "unsupportedAction",
        { broker: ETORO, action: "leveragedOrShort" },
        "accountActivity",
        7,
      ),
    ]);
  });

  it("dates a trade whose day no clock from UTC to UTC+3 changes", () => {
    // Winter, UTC+1 in Ljubljana: 22:30 is on its day at UTC+0 and +3.
    const winter = boughtAt("20/02/2024", "22:30:00");
    expect(codes(winter)).toEqual([]);
    expect(trades(winter).at(-1)?.date).toBe("2024-02-20");
    // Summer, UTC+2: 01:30 is 03:30 at UTC+0 and 00:30 at UTC+3.
    const summer = boughtAt("20/06/2024", "01:30:00");
    expect(codes(summer)).toEqual([]);
    expect(trades(summer).at(-1)?.date).toBe("2024-06-20");
  });

  it("refuses one so near midnight that the clock decides its day", () => {
    for (const [day, time, date] of [
      // Winter 01:30: the day before at UTC+3.
      ["20/02/2024", "01:30:00", "2024-02-20"],
      // Summer 22:30: the day after at UTC+0.
      ["20/06/2024", "22:30:00", "2024-06-21"],
    ] as const) {
      expect(blocking(boughtAt(day, time)), time).toEqual([
        refusal(
          "dateUncertain",
          { broker: ETORO, isin: APPLE, date },
          "accountActivity",
          7,
        ),
      ]);
    }
  });
});

describe("etoro, dividends", () => {
  it("makes the gross the net plus the tax withheld, 0.11 and 0.0122", () => {
    const result = read();
    const dividend = result.events.find((e) => e.kind === "dividend");
    const withholding = result.events.find((e) => e.kind === "withholding");
    expect(dividend).toMatchObject({
      date: "2024-02-15",
      at: { instant: null, brokerDate: "2024-02-15" },
      security: { isin: APPLE, symbol: "AAPL" },
      source: at("dividends", 2),
    });
    expect(
      dividend?.kind === "dividend" ? plain(dividend.gross.amount) : null,
    ).toBe("0.1222");
    expect(withholding).toMatchObject({
      date: "2024-02-15",
      isin: APPLE,
      dividendKey: dividend?.kind === "dividend" ? dividend.key : null,
    });
    expect(
      withholding?.kind === "withholding"
        ? plain(withholding.amount.amount)
        : null,
    ).toBe("0.0122");
    // Paid at 00:45 UTC: on the day before at UTC+3, so a warning.
    expect(result.diagnostics).toContainEqual(
      diagnostic("warning", "dividendDatesUncertain", {
        broker: ETORO,
        count: 1,
      }),
    );
  });

  it("reads a dividend with no tax withheld, and the rate written without a space", () => {
    const result = read({
      ...ROUND_TRIP,
      dividends: [
        payment({
          date: "15/02/2024",
          id: "1002",
          net: "0.11",
          rate: "0%",
          withheld: n("0"),
          isin: APPLE,
        }),
      ],
    });
    expect(codes(result)).toEqual([]);
    expect(result.events.filter((e) => e.kind === "withholding")).toEqual([]);
  });

  const mismatch = (spec: Statement) =>
    blocking(read(spec)).map((d) =>
      d.code === "dividendInconsistent" ? d.params.mismatch : d.code,
    );
  const swapPayment = (change: Partial<Payment>) => [
    payment({
      date: "15/02/2024",
      id: "1002",
      net: "0.11",
      rate: "10 %",
      withheld: n("0.0122"),
      isin: APPLE,
      ...change,
    }),
  ];

  it("holds a number cell to the digits a text number may have", () => {
    for (const amount of ["1E+30", "1E-30"]) {
      const result = read({
        ...ROUND_TRIP,
        closed: [{ ...ROUND_TRIP.closed[0], Amount: n(amount) }],
      });
      expect(codes(result), amount).toContain("invalidNumber");
    }
  });

  it("reads two dividends of one position on one day as two", () => {
    // A regular and a special dividend, paid the same day: two keys.
    const result = read({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity,
        dividendPaid("1002", "15/02/2024 12:00:00", "AAPL/USD", "0.5"),
      ],
      dividends: [
        ...swapPayment({}),
        payment({
          date: "15/02/2024",
          id: "1002",
          net: "0.5",
          rate: "0%",
          withheld: n("0"),
          isin: APPLE,
        }),
      ],
    });
    expect(codes(result)).toEqual([]);
    const dividends = result.events.filter((e) => e.kind === "dividend");
    expect(dividends).toHaveLength(2);
    expect(new Set(dividends.map((d) => d.key)).size).toBe(2);
    expect(
      validateLedger(result.events, result.diagnostics).diagnostics.map(
        (d) => d.code,
      ),
    ).not.toContain("duplicateKeyInFile");
  });

  it("pairs dividends in linear time, however many rows name one position", () => {
    // A crafted file: thousands of payments and activity rows of one
    // position. Pairing by lookup keeps it fast; a scan per payment would
    // take seconds.
    const count = 12_000;
    const days = Array.from({ length: count }, (_, i) => {
      const day = new Date(Date.UTC(2024, 1, 15) + i * 86_400_000);
      const dd = String(day.getUTCDate()).padStart(2, "0");
      const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
      return `${dd}/${mm}/${String(day.getUTCFullYear())}`;
    });
    const spec: Statement = {
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity.slice(0, 4),
        ...days.map((day) =>
          dividendPaid("1002", `${day} 12:00:00`, "AAPL/USD", "0.11"),
        ),
      ],
      dividends: days.map((day) =>
        payment({
          date: day,
          id: "1002",
          net: "0.11",
          rate: "0%",
          withheld: n("0"),
          isin: APPLE,
        }),
      ),
    };
    const bytes = statement(spec);
    const started = Date.now();
    importXlsx(bytes, context, [etoro]);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("sets a CFD's dividend adjustment aside as interest, in any currency", () => {
    // Interest under ZDoh-2 art. 81, on Doh-Obr (research 04 §2.4, FURS IFI
    // brochure §6), not part of the contract's D-IFI result.
    for (const details of ["NVDA/USD", "BARC.L/GBX"]) {
      const result = read({
        ...ROUND_TRIP,
        activity: [
          ...ROUND_TRIP.activity,
          opened("1003", "20/02/2024 15:00:00", details, "100", "2", "CFD"),
          dividendPaid("1003", "21/02/2024 12:00:00", details, "0.3"),
        ],
        dividends: [
          ...swapPayment({}),
          payment({
            date: "21/02/2024",
            id: "1003",
            net: "0.3",
            rate: "0%",
            withheld: n("0"),
            isin: "",
            type: "CFD",
          }),
        ],
      });
      expect(codes(result), details).toEqual([]);
      expect(
        result.events.filter(
          (e) => e.kind === "ignored" && e.reason === "interest",
        ),
        details,
      ).toHaveLength(2);
      expect(
        result.diagnostics.filter((d) => d.code === "interestNotCovered"),
        details,
      ).toEqual([
        diagnostic("warning", "interestNotCovered", {
          broker: ETORO,
          count: 1,
        }),
      ]);
    }
  });

  it("refuses a tax that is not the stated rate", () => {
    expect(
      mismatch({ ...ROUND_TRIP, dividends: swapPayment({ rate: "30 %" }) }),
    ).toEqual(["rate"]);
  });

  it("refuses a dividend without its activity row, and an activity row without its dividend", () => {
    expect(
      mismatch({ ...ROUND_TRIP, dividends: swapPayment({ net: "0.12" }) }),
    ).toEqual(["pairing", "unpaired"]);
    expect(
      mismatch({
        ...ROUND_TRIP,
        dividends: swapPayment({ date: "14/02/2024" }),
      }),
    ).toEqual(["date", "unpaired"]);
    expect(mismatch({ ...ROUND_TRIP, dividends: [] })).toEqual(["unpaired"]);
  });

  it("pairs a dividend only with an activity row that pays it in dollars", () => {
    expect(
      mismatch({
        ...ROUND_TRIP,
        activity: ROUND_TRIP.activity.map((row) =>
          row.Type === "Dividend" ? { ...row, Details: "AAPL/GBX" } : row,
        ),
      }),
    ).toEqual(["pairing", "unpaired"]);
  });

  it("refuses a dividend not in dollars", () => {
    expect(
      mismatch({
        ...ROUND_TRIP,
        dividendHeader: DIVIDEND_HEADER_2025_11,
        dividends: swapPayment({ currency: "GBP" }),
      }),
    ).toEqual(["unconfirmedAction"]);
    expect(
      mismatch({
        ...ROUND_TRIP,
        dividendHeader: DIVIDEND_HEADER_2025_11,
        dividends: swapPayment({ native: "0.1" }),
      }),
    ).toEqual(["netAmount"]);
    expect(
      mismatch({
        ...ROUND_TRIP,
        dividendHeader: DIVIDEND_HEADER_2025_11,
        dividends: swapPayment({ franked: "Franked" }),
      }),
    ).toEqual(["unsupportedAction"]);
  });

  it("refuses a dividend whose type is not its position's class, either way", () => {
    const cfd = opened(
      "1003",
      "20/02/2024 15:00:00",
      "NVDA/USD",
      "100",
      "2",
      "CFD",
    );
    const cfdPaid = dividendPaid(
      "1003",
      "21/02/2024 12:00:00",
      "NVDA/USD",
      "0.3",
    );
    const onCfd = (type: string) =>
      payment({
        date: "21/02/2024",
        id: "1003",
        net: "0.3",
        rate: "0%",
        withheld: n("0"),
        isin: APPLE,
        type,
      });
    // A CFD's dividend called a share's: never on Doh-Div.
    expect(
      mismatch({
        ...ROUND_TRIP,
        activity: [...ROUND_TRIP.activity, cfd, cfdPaid],
        dividends: [...swapPayment({}), onCfd("Stocks")],
      }),
    ).toEqual(["class"]);
    // A share's dividend called a CFD's: never set aside as interest.
    expect(
      mismatch({ ...ROUND_TRIP, dividends: swapPayment({ type: "CFD" }) }),
    ).toEqual(["class"]);
    // A contract's dividend without its activity row is refused too.
    expect(
      mismatch({
        ...ROUND_TRIP,
        activity: [...ROUND_TRIP.activity, cfd],
        dividends: [...swapPayment({}), onCfd("CFD")],
      }),
    ).toEqual(["pairing"]);
  });

  it("refuses a dividend with a sign it cannot have", () => {
    expect(
      mismatch({
        ...ROUND_TRIP,
        activity: [
          ...ROUND_TRIP.activity.slice(0, 4),
          dividendPaid("1002", "15/02/2024 12:00:00", "AAPL/USD", "-0.11"),
        ],
        dividends: swapPayment({ net: "-0.11" }),
      }),
    ).toEqual(["unexpectedSign"]);
    expect(
      mismatch({
        ...ROUND_TRIP,
        dividends: swapPayment({ withheld: n("-0.0122") }),
      }),
    ).toEqual(["unexpectedSign"]);
  });

  it("refuses a dividend booked so late on 31 December that its year is a guess", () => {
    // 23:30 at UTC+0 is already 1 January in Ljubljana; at UTC+3 it is not.
    const result = read({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity.slice(0, 4),
        dividendPaid("1002", "31/12/2024 23:30:00", "AAPL/USD", "0.11"),
      ],
      dividends: swapPayment({ date: "31/12/2024" }),
    });
    expect(blocking(result)).toEqual([
      refusal(
        "dateUncertain",
        { broker: ETORO, isin: APPLE, date: "2024-12-31" },
        "dividends",
        2,
      ),
    ]);
  });

  it("refuses a dividend whose time could put it in another tax year", () => {
    const result = read({
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity.slice(0, 4),
        dividendPaid("1002", "01/01/2025 00:30:00", "AAPL/USD", "0.11"),
      ],
      dividends: swapPayment({ date: "01/01/2025" }),
    });
    expect(blocking(result)).toEqual([
      refusal(
        "dateUncertain",
        { broker: ETORO, isin: APPLE, date: "2025-01-01" },
        "dividends",
        2,
      ),
    ]);
  });
});

describe("etoro, Account Activity", () => {
  it("leaves out each kind of cash row by its reason, and refuses any other", () => {
    const rows: [string, string | null][] = [
      ["Deposit", "deposit"],
      ["Withdraw Request", "withdrawal"],
      ["Withdraw Fee", "fee"],
      ["Withdrawal Conversion Fee", "fee"],
      ["Overnight fee", "fee"],
      ["Overnight refund", "interest"],
      ["SDRT", "fee"],
      ["Interest Payment", "interest"],
      ["Adjustment", null],
      ["corp action: Split", null],
      ["Withdraw Request Cancelled", null],
    ];
    const activity = [
      ...ROUND_TRIP.activity,
      ...rows.map(([type]) =>
        activityRow(type, "20/02/2024 12:00:00", {
          details: `${CANARY} details`,
        }),
      ),
    ];
    const spec = { ...ROUND_TRIP, activity };
    const result = read(spec);
    rows.forEach(([type, reason], i) => {
      const source = at("accountActivity", ROUND_TRIP.activity.length + 2 + i);
      if (reason === null) {
        expect(blocking(result), type).toContainEqual(
          diagnostic(
            "blocking",
            "unknownAction",
            {
              broker: ETORO,
              action: expect.objectContaining({ untrusted: type }) as never,
            },
            source,
          ),
        );
      } else {
        expect(result.events, type).toContainEqual(
          expect.objectContaining({ kind: "ignored", reason, source }),
        );
      }
    });
    // The interest payment and the overnight refund, a contract's
    // financing income: both interest on Doh-Obr.
    expect(result.diagnostics).toContainEqual(
      diagnostic("warning", "interestNotCovered", { broker: ETORO, count: 2 }),
    );
    expect(unaccounted(spec, result)).toEqual([]);
    // Each skipped sheet is one ignored row.
    expect(
      result.events.filter(
        (e) => e.kind === "ignored" && e.reason === "summary",
      ),
    ).toEqual([
      expect.objectContaining({ source: at("accountSummary", 1) }),
      expect.objectContaining({ source: at("financialSummary", 1) }),
    ]);
  });
});

describe("etoro, privacy", () => {
  it("never reads Account Summary or Financial Summary", () => {
    const book = openWorkbook(statement()) as Workbook;
    const asked: number[] = [];
    const spy: Workbook = {
      sheets: book.sheets,
      date1904: book.date1904,
      rows(position) {
        asked.push(position);
        return book.rows(position);
      },
    };
    etoro.read(spy, context);
    expect(asked.sort()).toEqual([2, 3, 4]);
  });

  it("reads none of a skipped sheet, its shared strings or its damage", () => {
    // As a spreadsheet saves it: the name and username in the shared-string
    // table, and the Financial Summary's part damaged. Neither is read.
    const summary =
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="s"><v>0</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Username</t></is></c><c r="B2" t="s"><v>1</v></c></row>';
    const bytes = statement({
      ...ROUND_TRIP,
      strings: [`<t>${CANARY}</t>`, `<t>${CANARY}-user</t>`],
      sheets: (sheets) =>
        sheets.map((sheet) =>
          sheet.name === "Account Summary"
            ? { ...sheet, data: summary }
            : sheet.name === "Financial Summary"
              ? { ...sheet, data: "<row><c><v>1</c></row" }
              : sheet,
        ),
    });
    const book = openWorkbook(bytes) as Workbook;
    const asked: number[] = [];
    const result = etoro.read(
      {
        sheets: book.sheets,
        date1904: book.date1904,
        rows(position) {
          asked.push(position);
          return book.rows(position);
        },
      },
      context,
    );
    expect(asked.sort()).toEqual([2, 3, 4]);
    expect(codes(result)).toEqual([]);
    expect(JSON.stringify(result.diagnostics.map(forExport))).not.toContain(
      "CANARY",
    );
    expect(
      JSON.stringify(result.events, (_, v: unknown) =>
        Decimal.isDecimal(v) ? v.toPlain(12, "halfUp") : v,
      ),
    ).not.toContain("CANARY");
  });

  it("lets no name, username or cash row's details reach a finding or an event", () => {
    const spec: Statement = {
      ...ROUND_TRIP,
      activity: [
        ...ROUND_TRIP.activity,
        activityRow("Withdraw Request", "20/02/2024 12:00:00", {
          details: CANARY,
        }),
      ],
      closed: [
        { ...ROUND_TRIP.closed[0], "Copied From": CANARY, Notes: CANARY },
      ],
    };
    // The canary is planted in Account Summary's name and username too,
    // where eToro writes the holder's: that sheet is never read.
    const book = openWorkbook(statement(spec)) as Workbook;
    const summary = book
      .rows(1)
      .rows.flatMap((row) => [...row.cells.values()].map((cell) => cell.text));
    expect(summary).toContain(CANARY);
    expect(summary).toContain(`${CANARY}-user`);
    const result = read(spec);
    const shown = (events: readonly LedgerEvent[]) =>
      JSON.stringify(events, (_, v: unknown) =>
        Decimal.isDecimal(v) ? v.toPlain(12, "halfUp") : v,
      );
    expect(shown(result.events)).not.toContain("CANARY");
    expect(JSON.stringify(result.diagnostics)).not.toContain("CANARY");
    expect(JSON.stringify(result.diagnostics.map(forExport))).not.toContain(
      "CANARY",
    );
  });
});
