/**
 * eToro account statements for the tests (ADR 0020): no real export with
 * a row has been read yet (R1), so every statement is written at test
 * time, with the shapes research 07 §4.1 records. The Apple round trip and its
 * dividend carry the figures of the one statement research saw, under
 * made-up IDs and dates; the holder's name is a canary.
 */
import {
  makeWorkbook,
  sheetRows,
  type CellSpec,
  type SheetSpec,
} from "./workbook.js";

export const CLOSED_HEADER = [
  "Position ID",
  "Action",
  "Long / Short",
  "Amount",
  "Units / Contracts",
  "Open Date",
  "Close Date",
  "Leverage",
  "Spread Fees (USD)",
  "Market Spread (USD)",
  "Profit(USD)",
  "Profit(EUR)",
  "FX rate at open (USD)",
  "FX rate at close (USD)",
  "Open Rate",
  "Close Rate",
  "Take profit rate",
  "Stop loss rate",
  "Overnight Fees and Dividends",
  "Copied From",
  "Type",
  "ISIN",
  "Notes",
];
export const ACTIVITY_HEADER = [
  "Date",
  "Type",
  "Details",
  "Amount",
  "Units / Contracts",
  "Realized Equity Change",
  "Realized Equity",
  "Balance",
  "Position ID",
  "Asset type",
  "NWA",
];
export const DIVIDEND_HEADER = [
  "Date of Payment",
  "Instrument Name",
  "Net Dividend Received (USD)",
  "Net Dividend Received (EUR)",
  "Withholding Tax Rate (%)",
  "Withholding Tax Amount (USD)",
  "Withholding Tax Amount (EUR)",
  "Position ID",
  "Type",
  "ISIN",
];
export const DIVIDEND_HEADER_2025_11 = [
  "Date of Payment",
  "Instrument Name",
  "Net Dividend Received (USD)",
  "Net dividends",
  "Currency",
  "Franked/Unfranked",
  "Franking Credits (AUD)",
  "Net Dividend Received (EUR)",
  "Withholding Tax Rate (%)",
  "Withholding Tax Amount (USD)",
  "Withholding Tax Amount (EUR)",
  "Position ID",
  "Type",
  "ISIN",
];

export type Row = Readonly<Record<string, CellSpec>>;
export const n = (text: string) => ({ n: text });
export const without = (header: readonly string[], ...columns: string[]) =>
  header.filter((c) => !columns.includes(c));

export const APPLE = "US0378331005";
export const EXXON = "US30231G1022";
export const CANARY = "CANARY-Jane-Doe";

/** The deposit that opens the account: realized equity from nothing. */
export function deposit(date = "02/01/2024 10:00:00", amount = "5000"): Row {
  return activityRow("Deposit", date, {
    amount: n(amount),
    equity: [amount, amount],
  });
}

export function activityRow(
  type: string,
  date: string,
  o: {
    readonly details?: string;
    readonly amount?: CellSpec;
    readonly units?: CellSpec;
    readonly id?: string;
    readonly asset?: string;
    /** Realized Equity Change, then Realized Equity. */
    readonly equity?: readonly [string, string];
  } = {},
): Row {
  return {
    Date: date,
    Type: type,
    Details: o.details ?? "-",
    Amount: o.amount ?? n("0"),
    "Units / Contracts": o.units ?? "-",
    "Realized Equity Change": n(o.equity?.[0] ?? "0"),
    "Realized Equity": n(o.equity?.[1] ?? "5000"),
    Balance: n("4000"),
    "Position ID": o.id ?? "-",
    "Asset type": o.asset ?? "-",
    NWA: n("0"),
  };
}

export const opened = (
  id: string,
  date: string,
  details: string,
  amount: string,
  units: CellSpec,
  asset = "Stocks",
) =>
  activityRow("Open Position", date, {
    details,
    amount: n(amount),
    units,
    id,
    asset,
  });
export const closing = (
  id: string,
  date: string,
  details: string,
  amount: string,
  units: CellSpec,
  asset = "Stocks",
) =>
  activityRow("Position closed", date, {
    details,
    amount: n(amount),
    units,
    id,
    asset,
  });
export const dividendPaid = (
  id: string,
  date: string,
  details: string,
  net: string,
) =>
  activityRow("Dividend", date, {
    details,
    amount: n(net),
    id,
    asset: "Stocks",
  });

export interface Position {
  readonly id: string;
  readonly amount: string;
  readonly units: CellSpec;
  readonly open: string;
  readonly close: string;
  readonly profit: string;
  readonly openRate: string;
  readonly closeRate: string;
  readonly isin: string;
  readonly side?: string;
  readonly leverage?: CellSpec;
  readonly type?: string;
  readonly fx?: CellSpec;
}

export function position(p: Position): Row {
  return {
    "Position ID": p.id,
    Action: "Apple (AAPL)",
    "Long / Short": p.side ?? "Long",
    Amount: n(p.amount),
    "Units / Contracts": p.units,
    "Open Date": p.open,
    "Close Date": p.close,
    Leverage: p.leverage ?? "1",
    "Spread Fees (USD)": n("0"),
    "Market Spread (USD)": "-0.02",
    "Profit(USD)": n(p.profit),
    "Profit(EUR)": n("0.85"),
    "FX rate at open (USD)": p.fx ?? "-",
    "FX rate at close (USD)": p.fx ?? "-",
    "Open Rate": n(p.openRate),
    "Close Rate": n(p.closeRate),
    "Take profit rate": n("1999.24"),
    "Stop loss rate": n("0"),
    "Overnight Fees and Dividends": n("0"),
    "Copied From": "-",
    Type: p.type ?? "Stocks",
    ISIN: p.isin,
    Notes: "",
  };
}

export interface Payment {
  readonly date: string;
  readonly id: string;
  readonly net: string;
  readonly rate: string;
  readonly withheld: CellSpec;
  readonly isin: string;
  readonly type?: string;
  readonly currency?: string;
  readonly native?: string;
  readonly franked?: string;
}

export function payment(d: Payment): Row {
  return {
    "Date of Payment": d.date,
    "Instrument Name": "Apple",
    "Net Dividend Received (USD)": n(d.net),
    "Net dividends": n(d.native ?? d.net),
    Currency: d.currency ?? "USD",
    "Franked/Unfranked": d.franked ?? "",
    "Franking Credits (AUD)": "",
    "Net Dividend Received (EUR)": n("0.1"),
    "Withholding Tax Rate (%)": d.rate,
    "Withholding Tax Amount (USD)": d.withheld,
    "Withholding Tax Amount (EUR)": n("0.01"),
    "Position ID": d.id,
    Type: d.type ?? "Stocks",
    ISIN: d.isin,
  };
}

/** An Apple round trip, an Apple position still open and its dividend. */
export const ROUND_TRIP = {
  activity: [
    deposit(),
    opened("1001", "05/01/2024 19:15:25", "AAPL/USD", "300", "1.650619"),
    opened("1002", "08/01/2024 15:00:00", "AAPL/USD", "200", "1.1"),
    closing(
      "1001",
      "16/01/2024 14:34:07",
      "AAPL/USD",
      "300.92",
      n("1.6506190000000001"),
    ),
    dividendPaid("1002", "15/02/2024 00:45:16", "AAPL/USD", "0.11"),
  ],
  closed: [
    position({
      id: "1001",
      amount: "300",
      units: "1.650619",
      open: "05/01/2024 19:15:25",
      close: "16/01/2024 14:34:07",
      profit: "0.92",
      openRate: "181.75",
      closeRate: "182.31",
      isin: APPLE,
    }),
  ],
  dividends: [
    payment({
      date: "15/02/2024",
      id: "1002",
      net: "0.11",
      rate: "10 %",
      withheld: n("1.2200000000000001E-2"),
      isin: APPLE,
    }),
  ],
} as const;

export interface Statement {
  readonly activity?: readonly Row[];
  readonly closed?: readonly Row[];
  readonly dividends?: readonly Row[];
  readonly activityHeader?: readonly string[];
  readonly closedHeader?: readonly string[];
  readonly dividendHeader?: readonly string[];
  /** Changes to the five sheets: add one, hide one, rename one. */
  readonly sheets?: (sheets: SheetSpec[]) => SheetSpec[];
  /** A shared-string table, each entry an `<si>`'s contents, as Excel saves. */
  readonly strings?: readonly string[];
}

const table = (header: readonly string[], rows: readonly Row[]) =>
  sheetRows([header, ...rows.map((row) => header.map((h) => row[h] ?? null))]);

/** Account Summary as eToro lays it out, with the holder's name and username. */
const SUMMARY = sheetRows([
  ["Details", null],
  ["Name", "Totals"],
  ["Name", CANARY],
  ["Username", `${CANARY}-user`],
  ["Currency", "USD"],
  ["Date Created", "20/09/2025 11:00:00"],
]);
const FINANCIAL = sheetRows([
  ["Name", "Amount\n in (USD)", "Tax\nRate"],
  ["Stocks (Profit or Loss)", n("0.92"), "0.00"],
]);

export function statement(spec: Statement = ROUND_TRIP): Uint8Array {
  const sheets: SheetSpec[] = [
    { name: "Account Summary", data: SUMMARY },
    {
      name: "Closed Positions",
      data: table(spec.closedHeader ?? CLOSED_HEADER, spec.closed ?? []),
    },
    {
      name: "Account Activity",
      data: table(spec.activityHeader ?? ACTIVITY_HEADER, spec.activity ?? []),
    },
    {
      name: "Dividends",
      data: table(spec.dividendHeader ?? DIVIDEND_HEADER, spec.dividends ?? []),
    },
    { name: "Financial Summary", data: FINANCIAL },
  ];
  return makeWorkbook({
    sheets: spec.sheets?.(sheets) ?? sheets,
    ...(spec.strings === undefined ? {} : { strings: spec.strings }),
  });
}
