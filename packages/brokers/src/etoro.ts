/**
 * eToro's account statement (XLSX), its current revision only (research 07
 * §4.1; ADR 0020). **Unverified:** written from parsers of real exports
 * and one statement a third party saved again, never from an untouched
 * export, which it waits for before it ships (ADR 0014, Consequences).
 *
 * What it reads, and why:
 *
 * - **Recognized by its five sheets**, by their exact English names. It
 *   reads Closed Positions, Account Activity and Dividends; Account Summary,
 *   which holds the holder's name and username, and Financial Summary are
 *   skipped whole, their rows never read. (The workbook's shared strings
 *   are inflated whole, but a string is reached only through a cell of a
 *   sheet that is read.) Any other sheet, or a hidden one it
 *   reads, refuses the file (ADR 0014 §6).
 * - **Columns by their exact header** on row 1, in any order, each once;
 *   a column outside the revision's list refuses the file, as does an older
 *   revision's layout, which another export fixes.
 * - **Values as written**, never read past a doubt: a number is a number
 *   cell, at 15 digits (ADR 0014 §8), or plain text such as "1.650619"; a
 *   date is text, "05/01/2024 19:15:25". A regional format (31.12.2025, a
 *   decimal comma), a thousands separator, brackets for a minus or a date
 *   stored as a serial makes every number of the file doubtful, and
 *   refuses it.
 * - **The whole history or nothing** (ADR 0020 §4). FIFO needs every
 *   purchase, and eToro's statement is the one place they are: it must
 *   start with an empty account, list its activity in date order, and
 *   open every position it names exactly once. One statement per account
 *   group; a second is refused by the pipeline (`wholeHistory`).
 * - **Lots from Closed Positions**: each row is a purchase at its open
 *   rate and a sale at its close rate, on the times Account Activity
 *   records, in US dollars only, with its amount, profit, units and times
 *   checked against the rows that record them. A position still open is
 *   a purchase at the amount invested over its units, its ISIN found by
 *   its ticker in the rows that give one. Lots are matched FIFO across
 *   every broker, never per position (research 04 §4.4).
 * - **Times are taken as UTC** [L], and a trade so near midnight that a
 *   clock of UTC+0 to UTC+3 would put it on another day is refused.
 * - **Dividends**, one per row, gross as the net plus the tax withheld,
 *   each paired with its Account Activity row.
 * - **Left out with their reason:** CFDs and other derivatives (one
 *   warning), unleveraged crypto, cash movements, fees and interest (one
 *   warning). **Refused:** short or leveraged shares, partial closes,
 *   instruments not in US dollars, and every value or row it does not know.
 *
 * Every refusal is unscoped (ADR 0017): no eToro row's reach on a holding
 * has been analysed. No position ID, `Copied From`, `Notes` or cash row's
 * `Details` reaches a finding.
 */
import {
  accountGroup,
  Decimal,
  diagnostic,
  instantMillis,
  isIsin,
  isIsoDate,
  keyOf,
  LIMITS,
  ljubljanaDate,
  taxDate,
  untrusted,
  type AccountScope,
  type BrokerTime,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticParams,
  type IgnoredReason,
  type IsoDate,
  type LedgerEvent,
  type NumberColumn,
  type SecurityRef,
  type SourceRef,
} from "@taxreporter/core";

import type { ImportResult, ReadContext, XlsxAdapter } from "./adapter.js";
import { fromUtcStamp } from "./time.js";
import type { Cell, SheetRow, Workbook, WorkbookInfo } from "./xlsx.js";
import { cellInteger } from "./xlsx-values.js";

export const ETORO = "etoro";

const CLOSED = "Closed Positions";
const ACTIVITY = "Account Activity";
const DIVIDENDS = "Dividends";

/**
 * The sheets read, by name, with the identifier a row's source names its
 * sheet by: letters only, as the web app's protocol takes them.
 */
const READ: ReadonlyMap<string, string> = new Map([
  [CLOSED, "closedPositions"],
  [ACTIVITY, "accountActivity"],
  [DIVIDENDS, "dividends"],
]);

/**
 * The sheets skipped whole, never inflated: Account Summary names the
 * holder and the username (CLAUDE.md, "Privacy"), and both only total what
 * the read sheets hold in detail.
 */
const SKIPPED: ReadonlyMap<string, string> = new Map([
  ["Account Summary", "accountSummary"],
  ["Financial Summary", "financialSummary"],
]);

/** A sheet's columns in one revision: those it must have, and may. */
interface Layout {
  readonly revision: string;
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

/**
 * Closed Positions as `masbug/etoro-edavki` 5f607d9 names its 2025.2.15
 * revision (research 07 §4.1). Profit(EUR) is missing from one statement
 * (research 07 §4.1) and is never read, so it may be absent.
 */
const CLOSED_LAYOUT: Layout = {
  revision: "2025.2.15",
  required: [
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
  ],
  optional: ["Profit(EUR)"],
};

/** Account Activity's 2025.2 revision (research 07 §4.1). */
const ACTIVITY_LAYOUT: Layout = {
  revision: "2025.2",
  required: [
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
  ],
  optional: [],
};

const DIVIDEND_BASE = [
  "Date of Payment",
  "Instrument Name",
  "Net Dividend Received (USD)",
  "Withholding Tax Rate (%)",
  "Withholding Tax Amount (USD)",
  "Position ID",
  "Type",
  "ISIN",
];
/** Missing from one statement (research 07 §4.1), and never read. */
const DIVIDEND_EUR = [
  "Net Dividend Received (EUR)",
  "Withholding Tax Amount (EUR)",
];

/**
 * Dividends with ISIN, as in 2024, and with the four columns 2025.11
 * added, all four or none: 2025.1, without ISIN, is refused.
 */
const DIVIDEND_LAYOUTS: readonly Layout[] = [
  { revision: "2024", required: DIVIDEND_BASE, optional: DIVIDEND_EUR },
  {
    revision: "2025.11",
    required: [
      ...DIVIDEND_BASE,
      "Net dividends",
      "Currency",
      "Franked/Unfranked",
      "Franking Credits (AUD)",
    ],
    optional: DIVIDEND_EUR,
  },
];

/** Columns read as numbers, and as dates: where a regional format shows. */
const NUMBER_COLUMNS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    CLOSED,
    [
      "Amount",
      "Units / Contracts",
      "Leverage",
      "Profit(USD)",
      "Open Rate",
      "Close Rate",
    ],
  ],
  [
    ACTIVITY,
    [
      "Amount",
      "Units / Contracts",
      "Realized Equity Change",
      "Realized Equity",
    ],
  ],
  [
    DIVIDENDS,
    [
      "Net Dividend Received (USD)",
      "Withholding Tax Rate (%)",
      "Withholding Tax Amount (USD)",
      "Net dividends",
    ],
  ],
]);
const DATE_COLUMNS: ReadonlyMap<string, readonly string[]> = new Map([
  [CLOSED, ["Open Date", "Close Date"]],
  [ACTIVITY, ["Date"]],
  [DIVIDENDS, ["Date of Payment"]],
]);

/** Instruments owned outright: a purchase and a sale on Doh-KDVP. */
const REAL = new Set(["Stocks", "ETF"]);
const CRYPTO = "Crypto";
/** Contracts, taxed on D-IFI (research 07 §4.1, `masbug`'s list). */
const DERIVATIVES = new Set(["CFD", "OPT", "FUT", "FOP", "Crypto Margin"]);

const OPEN = "Open Position";
const CLOSE = "Position closed";
const DIVIDEND = "Dividend";
const INTEREST = "Interest Payment";

/**
 * Account Activity's other rows, a closed list (ADR 0020 §9): cash that
 * is part of neither return, and costs, which the normed costs cover
 * (research 04 §4.2). Overnight fees and refunds belong to leveraged or
 * short positions; SDRT is the UK's stamp duty on a purchase.
 */
const CASH: ReadonlyMap<string, IgnoredReason> = new Map([
  ["Deposit", "deposit"],
  ["Withdraw Request", "withdrawal"],
  ["Withdraw Fee", "fee"],
  ["Withdrawal Conversion Fee", "fee"],
  ["Overnight fee", "fee"],
  ["Overnight refund", "fee"],
  ["SDRT", "fee"],
]);
const OVERNIGHT = new Set(["Overnight fee", "Overnight refund"]);

/** The statement's mark for a value that does not apply. */
const NONE = "-";
const USD = "USD";

/** A plain decimal, an optional minus: nothing regional, no separator. */
const NUMBER = new RegExp(
  `^-?\\d{1,${String(LIMITS.numberWholeDigits)}}(?:\\.\\d{1,${String(LIMITS.numberDecimals)}})?$`,
);
/** "10 %" or "15%", as eToro writes the rate withheld (research 07 §4.1). */
const RATE = /^(\d{1,3}(?:\.\d{1,4})?) ?%$/;
const POSITION_ID = /^\d{1,15}$/;
/** "05/01/2024 19:15:25", and "15/02/2024" for a payment date. */
const STAMP = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;
const DAY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
/** "AAPL/USD": a ticker, and the currency it is quoted in. */
const TICKER = /^[A-Za-z0-9._-]{1,24}$/;
const CURRENCY = /^[A-Za-z]{3}$/;

const CENT = Decimal.parse("0.01");
/**
 * What rounding leaves between figures that should agree. Units are
 * written to 6 decimals (research 07 §4.1; the statement of §4.1), so
 * units times a rate misses the amount by up to half a millionth of the
 * rate; amounts and profits are in cents. One unit of each, twice what
 * rounding can give, and far less than any misreading, which is out by a
 * leverage, a currency or a hundred (ADR 0020 §5).
 */
const UNITS_STEP = Decimal.parse("0.000001");

/**
 * The hours east of UTC the statement's clock may be in: from UTC, which
 * the timestamps of market opens suggest [L], to UTC+3, Cyprus' summer
 * time, where eToro's European entity sits (ADR 0020 §7). One constant,
 * so a source that settles the zone changes one line.
 */
const ZONE_BAND_HOURS = 3;
const HOUR_MS = 3_600_000;

/** A sheet read: its header's columns and the rows below it. */
interface Table {
  readonly name: string;
  readonly part: string;
  readonly position: number;
  readonly revision: string;
  readonly columns: ReadonlyMap<string, number>;
  readonly rows: readonly SheetRow[];
}

const cellOf = (table: Table, row: SheetRow, column: string) => {
  const index = table.columns.get(column);
  return index === undefined ? undefined : row.cells.get(index);
};

/** A string cell's text, "" for no cell, null for a cell of another kind. */
function textOf(cell: Cell | undefined): string | null {
  if (cell === undefined) return "";
  return cell.kind === "string" ? cell.text : null;
}

/** A number cell at 15 digits, or text in the plain grammar; else null. */
function numberOf(cell: Cell | undefined): Decimal | null {
  // A number cell is held to the digits a text number may have: its
  // 15-digit value can still lie far past any amount (1e30, 1e-30).
  if (cell?.kind === "number") {
    return NUMBER.test(cell.value) ? Decimal.parse(cell.value) : null;
  }
  if (cell?.kind === "string" && NUMBER.test(cell.text)) {
    return Decimal.parse(cell.text);
  }
  return null;
}

/** A position's ID: text of digits, or a number cell of at most 15 digits. */
function positionOf(cell: Cell | undefined): string | null {
  if (cell?.kind === "string") {
    return POSITION_ID.test(cell.text) ? cell.text : null;
  }
  return cell?.kind === "number" ? cellInteger(cell.text) : null;
}

/** A time as the broker's clock, read as UTC; null when it is none. */
function stampOf(cell: Cell | undefined): BrokerTime | null {
  const text = textOf(cell);
  const match = text === null ? null : STAMP.exec(text);
  if (match === null) return null;
  const [, day, month, year, hour, minute, second] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  return fromUtcStamp(`${year}-${month}-${day} ${hour}:${minute}:${second}`);
}

function dayOf(cell: Cell | undefined): IsoDate | null {
  const text = textOf(cell);
  const match = text === null ? null : DAY.exec(text);
  if (match === null) return null;
  const date = `${match[3] ?? ""}-${match[2] ?? ""}-${match[1] ?? ""}`;
  return isIsoDate(date) ? date : null;
}

/** A blank row: every cell an empty string, as a styled row Excel keeps. */
const isBlank = (row: SheetRow) =>
  [...row.cells.values()].every((c) => c.kind === "string" && c.text === "");

/** "AAPL/USD" as its ticker and currency, or null. */
function quoteOf(
  details: string | null,
): { readonly ticker: string; readonly currency: string } | null {
  if (details === null) return null;
  const slash = details.lastIndexOf("/");
  const ticker = details.slice(0, slash);
  const currency = details.slice(slash + 1);
  return slash > 0 && TICKER.test(ticker) && CURRENCY.test(currency)
    ? { ticker, currency }
    : null;
}

/**
 * The Ljubljana days a broker's time could fall on if its clock were
 * anywhere from UTC to UTC+3: read as UTC+3 (the earliest instant) and as
 * UTC (the latest). The day never goes back as the instant moves on,
 * summer time included, so the two ends bound the band.
 */
function bandOf(instant: string): readonly [IsoDate | null, IsoDate | null] {
  const ms = instantMillis(instant);
  if (ms === null) return [null, null];
  const early = new Date(ms - ZONE_BAND_HOURS * HOUR_MS);
  const text = `${early.toISOString().slice(0, 19)}Z`;
  return [ljubljanaDate(text), ljubljanaDate(instant)];
}

/** Rows of Account Activity, as far as they could be read. */
interface Activity {
  readonly source: SourceRef;
  /** File text, matched against the closed list and never shown unwrapped. */
  readonly type: string | null;
  readonly at: BrokerTime | null;
  readonly details: string | null;
  /** The position's ID; null for "-", a cash row's. */
  readonly id: string | null;
  readonly idValid: boolean;
  readonly amount: Decimal | null;
  readonly units: Decimal | null;
  readonly assetType: string | null;
}

interface Closed {
  readonly table: Table;
  readonly row: SheetRow;
  readonly source: SourceRef;
  readonly id: string | null;
}

interface Payment {
  readonly table: Table;
  readonly row: SheetRow;
  readonly source: SourceRef;
  readonly id: string | null;
  readonly isin: string;
}

/** The finding's security and day, each only in its proper shape. */
function where(isin: string | null, date: IsoDate | null) {
  return {
    ...(isin !== null && isIsin(isin) ? { isin } : {}),
    ...(date === null ? {} : { date }),
  };
}

/**
 * Finds the header on row 1 and checks it against the sheet's layouts:
 * the first that matches wins, and the nearest one names what is wrong.
 */
function tableOf(
  name: string,
  position: number,
  rows: readonly SheetRow[],
  layouts: readonly Layout[],
  context: ReadContext,
  refusals: Diagnostic[],
): Table {
  const part = READ.get(name) ?? "";
  const header = new Map<string, number>();
  /** Every column with a header, a repeated one too: refused already. */
  const named = new Set<number>();
  const [first] = rows;
  const hasHeader = first?.row === 1;
  const source: SourceRef = { fileId: context.fileId, row: 1, part };
  for (const [column, cell] of hasHeader ? first.cells : []) {
    const text = cell.kind === "string" ? cell.text : null;
    if (text === "") continue;
    named.add(column);
    if (text === null) {
      refusals.push(
        diagnostic(
          "blocking",
          "unknownColumn",
          { broker: ETORO, position: column, column: untrusted(cell.text) },
          source,
        ),
      );
    } else if (header.has(text)) {
      refusals.push(
        diagnostic("blocking", "unreadableFile", {
          reason: "duplicateHeaderName",
          row: 1,
          sheet: position,
          column,
        }),
      );
    } else {
      header.set(text, column);
    }
  }
  const fit = layouts.map((layout) => {
    const known = new Set([...layout.required, ...layout.optional]);
    return {
      layout,
      missing: layout.required.filter((c) => !header.has(c)),
      unknown: [...header].filter(([c]) => !known.has(c)),
    };
  });
  const chosen =
    fit.find((f) => f.missing.length + f.unknown.length === 0) ??
    fit.reduce((best, f) =>
      f.missing.length + f.unknown.length <=
      best.missing.length + best.unknown.length
        ? f
        : best,
    );
  for (const column of chosen.missing) {
    refusals.push(
      diagnostic(
        "blocking",
        "columnMissing",
        { broker: ETORO, column },
        source,
      ),
    );
  }
  for (const [text, column] of chosen.unknown) {
    refusals.push(
      diagnostic(
        "blocking",
        "unknownColumn",
        { broker: ETORO, position: column, column: untrusted(text) },
        source,
      ),
    );
  }
  const data = (hasHeader ? rows.slice(1) : rows).filter((r) => !isBlank(r));
  // A value under no header is a column the export does not have.
  const stray = data
    .flatMap((r) =>
      [...r.cells]
        .filter(([c, cell]) => !named.has(c) && textOf(cell) !== "")
        .map(([column]) => ({ row: r.row, column })),
    )
    .at(0);
  if (stray !== undefined) {
    refusals.push(
      diagnostic("blocking", "unreadableFile", {
        reason: "rowLength",
        row: stray.row,
        sheet: position,
        column: stray.column,
      }),
    );
  }
  return {
    name,
    part,
    position,
    revision: chosen.layout.revision,
    columns: header,
    rows: data,
  };
}

/**
 * What in the read columns makes every number of the file doubtful: a
 * comma, which a decimal comma or a thousands separator puts there (so
 * "1.071" could be a thousand and seventy-one), brackets for a minus, a
 * date in a regional format or stored as a serial (ADR 0020 §2).
 */
function formatsOf(
  table: Table,
): Set<DiagnosticParams["statementFormat"]["format"]> {
  const found = new Set<DiagnosticParams["statementFormat"]["format"]>();
  const numbers = NUMBER_COLUMNS.get(table.name) ?? [];
  const dates = DATE_COLUMNS.get(table.name) ?? [];
  for (const row of table.rows) {
    for (const column of numbers) {
      const cell = cellOf(table, row, column);
      if (cell?.kind !== "string") continue;
      if (cell.text.includes(",")) found.add("regionalNumber");
      if (cell.text.startsWith("(")) found.add("bracketNegative");
    }
    for (const column of dates) {
      const cell = cellOf(table, row, column);
      if (cell?.kind === "number") found.add("serialDate");
      if (
        cell?.kind === "string" &&
        cell.text.charAt(2) === "." &&
        cell.text.charAt(5) === "."
      ) {
        found.add("regionalDate");
      }
    }
  }
  return found;
}

function read(book: Workbook, context: ReadContext): ImportResult {
  const account = accountGroup(ETORO, context.accountGroup);
  const events: LedgerEvent[] = [];
  const diagnostics: Diagnostic[] = [];
  let format = `etoro-xlsx-${CLOSED_LAYOUT.revision}`;
  const done = (reach: ImportResult["reach"]): ImportResult => ({
    broker: ETORO,
    format,
    events,
    diagnostics,
    reach,
    wholeHistory: true,
  });
  const refused = (refusals: readonly Diagnostic[]): ImportResult => {
    diagnostics.push(...refusals);
    events.length = 0;
    return done([]);
  };

  // Every sheet is known (ADR 0014 §6): one the revision lacks could hold
  // rows read by no one, and a hidden one shows the user nothing of what
  // is read.
  const refusals: Diagnostic[] = [];
  const positions = new Map<string, number>();
  for (const sheet of book.sheets) {
    const part = READ.get(sheet.name) ?? SKIPPED.get(sheet.name);
    if (part === undefined || !sheet.worksheet) {
      refusals.push(
        diagnostic("blocking", "unknownSheet", { sheet: sheet.position }),
      );
      continue;
    }
    positions.set(sheet.name, sheet.position);
    if (READ.has(sheet.name) && sheet.hidden) {
      refusals.push(
        diagnostic("blocking", "hiddenSheet", { sheet: sheet.position }),
      );
    }
  }
  if (refusals.length > 0) return refused(refusals);

  const tables = new Map<string, Table>();
  for (const [name, layouts] of [
    [CLOSED, [CLOSED_LAYOUT]],
    [ACTIVITY, [ACTIVITY_LAYOUT]],
    [DIVIDENDS, DIVIDEND_LAYOUTS],
  ] as const) {
    const position = positions.get(name);
    if (position === undefined) {
      return refused([diagnostic("blocking", "unknownFormat", {})]);
    }
    const { rows, hiddenCells } = book.rows(position);
    if (hiddenCells) {
      diagnostics.push(
        diagnostic("warning", "hiddenCells", { sheet: position }),
      );
    }
    tables.set(name, tableOf(name, position, rows, layouts, context, refusals));
  }
  const closedTable = tables.get(CLOSED) as Table;
  const activityTable = tables.get(ACTIVITY) as Table;
  const dividendTable = tables.get(DIVIDENDS) as Table;
  if (dividendTable.revision === "2025.11") format = "etoro-xlsx-2025.11";
  if (refusals.length > 0) return refused(refusals);
  const formats = new Set(
    [...tables.values()].flatMap((table) => [...formatsOf(table)]),
  );
  if (formats.size > 0) {
    return refused(
      [...formats].map((f) =>
        diagnostic("blocking", "statementFormat", { broker: ETORO, format: f }),
      ),
    );
  }

  // Account Activity, read once: the statement's ledger of cash and
  // positions, which the other two sheets are checked against.
  const sourceOf = (table: Table, row: SheetRow): SourceRef => ({
    fileId: context.fileId,
    row: row.row,
    part: table.part,
  });
  const activity: Activity[] = activityTable.rows.map((row) => {
    const cell = (column: string) => cellOf(activityTable, row, column);
    const idText = textOf(cell("Position ID"));
    const id = idText === NONE ? null : positionOf(cell("Position ID"));
    const units = cell("Units / Contracts");
    return {
      source: sourceOf(activityTable, row),
      type: textOf(cell("Type")),
      at: stampOf(cell("Date")),
      details: textOf(cell("Details")),
      id,
      idValid: idText === NONE || id !== null,
      amount: numberOf(cell("Amount")),
      units: textOf(units) === NONE ? null : numberOf(units),
      assetType: textOf(cell("Asset type")),
    };
  });

  const closed: Closed[] = closedTable.rows.map((row) => ({
    table: closedTable,
    row,
    source: sourceOf(closedTable, row),
    id: positionOf(cellOf(closedTable, row, "Position ID")),
  }));
  const payments: Payment[] = dividendTable.rows.map((row) => ({
    table: dividendTable,
    row,
    source: sourceOf(dividendTable, row),
    id: positionOf(cellOf(dividendTable, row, "Position ID")),
    isin: textOf(cellOf(dividendTable, row, "ISIN")) ?? "",
  }));

  // The history gate (ADR 0020 §4): without every purchase since the
  // account opened, FIFO would match a sale against the wrong lots, here
  // or at another broker, and nothing would say so.
  const gaps = new Set<DiagnosticParams["historyIncomplete"]["gap"]>();
  const [firstActivity] = activityTable.rows;
  if (firstActivity !== undefined) {
    const equity = numberOf(
      cellOf(activityTable, firstActivity, "Realized Equity"),
    );
    const change = numberOf(
      cellOf(activityTable, firstActivity, "Realized Equity Change"),
    );
    if (equity === null || change === null || !equity.equals(change)) {
      gaps.add("start");
    }
  }
  let previous: string | null = null;
  for (const row of activity) {
    const instant = row.at?.instant ?? null;
    if (instant === null) continue;
    if (previous !== null && instant < previous) gaps.add("order");
    previous = instant;
  }
  const opens = new Map<string, Activity[]>();
  for (const row of activity) {
    if (row.type === OPEN && row.id !== null) {
      const list = opens.get(row.id);
      if (list === undefined) opens.set(row.id, [row]);
      else list.push(row);
    }
  }
  const named = [
    ...activity.map((a) => a.id),
    ...closed.map((c) => c.id),
    ...payments.map((p) => p.id),
  ];
  if (named.some((id) => id !== null && opens.get(id)?.length !== 1)) {
    gaps.add("openRow");
  }
  if (gaps.size > 0) {
    return refused(
      [...gaps].map((gap) =>
        diagnostic("blocking", "historyIncomplete", { broker: ETORO, gap }),
      ),
    );
  }

  // Rows from here on are each an event, an ignored row or a refusal.
  const ignore = (source: SourceRef, reason: IgnoredReason) => {
    events.push({ kind: "ignored", reason, broker: ETORO, account, source });
  };
  const blockAt =
    (source: SourceRef) =>
    <C extends DiagnosticCode>(code: C, params: DiagnosticParams[C]) => {
      diagnostics.push(diagnostic("blocking", code, params, source));
    };
  // How far the file reaches: its latest day, cash rows included.
  const days: IsoDate[] = [];
  for (const row of activity) {
    const dated = row.at === null ? null : taxDate(row.at);
    if (dated !== null) days.push(dated.date);
  }

  const closesById = group(activity.filter((a) => a.type === CLOSE));
  const dividendsById = group(activity.filter((a) => a.type === DIVIDEND));
  const overnight = new Set(
    activity.flatMap((a) =>
      a.type !== null && OVERNIGHT.has(a.type) && a.id !== null ? [a.id] : [],
    ),
  );
  const closedById = new Map<string, Closed[]>();
  for (const row of closed) {
    if (row.id === null) continue;
    const list = closedById.get(row.id);
    if (list === undefined) closedById.set(row.id, [row]);
    else list.push(row);
  }
  const openOf = (id: string) => (opens.get(id) ?? [])[0] as Activity;

  // Tickers to ISINs, from the rows that give both: how a position still
  // open, which carries no ISIN, finds its own (ADR 0020 §5).
  const isinsByTicker = new Map<string, Set<string>>();
  const learn = (id: string | null, isin: string) => {
    const quote = id === null ? null : quoteOf(openOf(id).details);
    if (quote === null || !isIsin(isin)) return;
    const set = isinsByTicker.get(quote.ticker) ?? new Set<string>();
    set.add(isin);
    isinsByTicker.set(quote.ticker, set);
  };
  for (const row of closed) {
    learn(row.id, textOf(cellOf(closedTable, row.row, "ISIN")) ?? "");
  }
  for (const payment of payments) learn(payment.id, payment.isin);

  let derivatives = 0;
  let interest = 0;
  let assumed = 0;
  let nearMidnight = 0;

  /**
   * A closed position: a purchase and a sale, checked against the rows
   * that record them. Returns the reason its activity rows are left out.
   */
  const readClosed = (
    row: Closed,
    id: string,
    open: Activity,
    closes: readonly Activity[],
    count: number,
  ): IgnoredReason => {
    const block = blockAt(row.source);
    const cell = (column: string) => cellOf(closedTable, row.row, column);
    if (count > 1 || closes.length > 1) {
      block("unsupportedAction", { broker: ETORO, action: "partialClose" });
      return "pairedRow";
    }
    const type = textOf(cell("Type")) ?? "";
    if (DERIVATIVES.has(type)) {
      ignore(row.source, "derivative");
      derivatives += 1;
      return "derivative";
    }
    if (!REAL.has(type) && type !== CRYPTO) {
      block("unknownAction", { broker: ETORO, action: untrusted(type) });
      return "pairedRow";
    }
    const direction = textOf(cell("Long / Short")) ?? "";
    if (direction !== "Long" && direction !== "Short") {
      block("unknownAction", { broker: ETORO, action: untrusted(direction) });
      return "pairedRow";
    }
    // A real asset is only ever long and unleveraged at eToro in the EU
    // (research 07 §4.1); a short or leveraged one is a contract whose
    // reading no source settles (R3).
    if (direction === "Short") {
      block("unsupportedAction", { broker: ETORO, action: "short" });
      return "pairedRow";
    }
    const leverage = numberOf(cell("Leverage"));
    if (leverage === null) {
      block("invalidNumber", { column: "Leverage" });
      return "pairedRow";
    }
    if (!leverage.equals(Decimal.ONE)) {
      block("unsupportedAction", { broker: ETORO, action: "leveraged" });
      return "pairedRow";
    }
    if (type === CRYPTO) {
      ignore(row.source, "crypto");
      return "crypto";
    }
    const [close] = closes;
    if (close === undefined) {
      block("tradeInconsistent", { check: "activity" });
      return "pairedRow";
    }
    // US dollars only (ADR 0020 §6): the rates are then in dollars, and
    // eToro's own FX columns, never a value, say "-".
    const quote = quoteOf(open.details);
    if (
      quote?.currency !== USD ||
      textOf(cell("FX rate at open (USD)")) !== NONE ||
      textOf(cell("FX rate at close (USD)")) !== NONE
    ) {
      block("unconfirmedAction", { broker: ETORO, action: "nonUsd" });
      return "pairedRow";
    }
    const isin = textOf(cell("ISIN")) ?? "";
    if (!isIsin(isin)) {
      block("invalidIsin", {});
      return "pairedRow";
    }
    const openAt = stampOf(cell("Open Date"));
    const closeAt = stampOf(cell("Close Date"));
    const openDated = openAt === null ? null : taxDate(openAt);
    const closeDated = closeAt === null ? null : taxDate(closeAt);
    if (
      openAt === null ||
      closeAt === null ||
      openDated === null ||
      closeDated === null
    ) {
      block("invalidTime", {});
      return "pairedRow";
    }
    const at = where(isin, closeDated.date);
    if (
      openAt.instant !== open.at?.instant ||
      closeAt.instant !== close.at?.instant
    ) {
      block("tradeInconsistent", { ...at, check: "dates" });
      return "pairedRow";
    }
    const figures: [NumberColumn, Decimal | null][] = [
      ["Units / Contracts", numberOf(cell("Units / Contracts"))],
      ["Amount", numberOf(cell("Amount"))],
      ["Open Rate", numberOf(cell("Open Rate"))],
      ["Close Rate", numberOf(cell("Close Rate"))],
      ["Profit(USD)", numberOf(cell("Profit(USD)"))],
    ];
    const bad = figures.find(([, value]) => value === null);
    if (bad !== undefined) {
      block("invalidNumber", { column: bad[0] });
      return "pairedRow";
    }
    const [units, amount, openRate, closeRate, profit] = figures.map(
      ([, value]) => value as Decimal,
    ) as [Decimal, Decimal, Decimal, Decimal, Decimal];
    if (!units.isPositive()) {
      block("invalidQuantity", {});
      return "pairedRow";
    }
    if (!amount.isPositive()) {
      block("unexpectedSign", { column: "Amount" });
      return "pairedRow";
    }
    if (!openRate.isPositive() || !closeRate.isPositive()) {
      block("invalidPrice", {});
      return "pairedRow";
    }
    // The units, written in three places, agree once each is read.
    if (
      open.units === null ||
      close.units === null ||
      !units.equals(open.units) ||
      !units.equals(close.units)
    ) {
      block("tradeInconsistent", { ...at, check: "units" });
      return "pairedRow";
    }
    // The amount invested is the units at the open rate, and what came
    // back the units at the close rate: a margin, a price in pence or in
    // another currency is out by far more than rounding (ADR 0020 §5).
    if (!near(units.times(openRate), amount, openRate)) {
      block("tradeInconsistent", { ...at, check: "amount" });
      return "pairedRow";
    }
    if (!near(units.times(closeRate), amount.plus(profit), closeRate)) {
      block("tradeInconsistent", { ...at, check: "closeAmount" });
      return "pairedRow";
    }
    if (!certain(openAt) || !certain(closeAt)) {
      block("dateUncertain", { broker: ETORO, ...at });
      return "pairedRow";
    }
    const security = securityOf(isin, quote.ticker, type);
    events.push(
      trade(account, row.source, openAt, openDated.date, id, "buy", {
        security,
        units,
        price: openRate,
      }),
      trade(account, row.source, closeAt, closeDated.date, id, "sell", {
        security,
        units,
        price: closeRate,
      }),
    );
    return "pairedRow";
  };

  /** A position still open: a purchase at the amount over the units. */
  const readOpen = (open: Activity, id: string): void => {
    const block = blockAt(open.source);
    const type = open.assetType ?? "";
    if (DERIVATIVES.has(type)) {
      ignore(open.source, "derivative");
      derivatives += 1;
      return;
    }
    if (type === CRYPTO) {
      ignore(open.source, "crypto");
      return;
    }
    if (!REAL.has(type)) {
      block("unknownAction", { broker: ETORO, action: untrusted(type) });
      return;
    }
    // Account Activity gives an open position no direction or leverage.
    // An overnight fee is charged only on a leveraged or short one, so a
    // position that paid one is refused, never taken as shares owned.
    if (overnight.has(id)) {
      block("unsupportedAction", { broker: ETORO, action: "leveragedOrShort" });
      return;
    }
    const quote = quoteOf(open.details);
    if (quote?.currency !== USD) {
      block("unconfirmedAction", { broker: ETORO, action: "nonUsd" });
      return;
    }
    const isins = isinsByTicker.get(quote.ticker) ?? new Set<string>();
    const dated = open.at === null ? null : taxDate(open.at);
    if (open.at === null || dated === null) {
      block("invalidTime", {});
      return;
    }
    // R2, option (a): a position no row of the file names an ISIN for is
    // refused, and withholds every return (ADR 0020, open questions).
    if (isins.size !== 1) {
      block("isinUnresolved", {
        broker: ETORO,
        date: dated.date,
        cause: isins.size === 0 ? "missing" : "ambiguous",
      });
      return;
    }
    const [isin] = [...isins] as [string];
    if (open.units === null) {
      block("invalidNumber", { column: "Units / Contracts" });
      return;
    }
    if (open.amount === null) {
      block("invalidNumber", { column: "Amount" });
      return;
    }
    if (!open.units.isPositive()) {
      block("invalidQuantity", {});
      return;
    }
    if (!open.amount.isPositive()) {
      block("unexpectedSign", { column: "Amount" });
      return;
    }
    if (!certain(open.at)) {
      block("dateUncertain", { broker: ETORO, ...where(isin, dated.date) });
      return;
    }
    // Exact: the quotient may not end (300 / 1.650619), and Decimal keeps
    // it as a fraction until a form field rounds it (ADR 0020 §5).
    events.push(
      trade(account, open.source, open.at, dated.date, id, "buy", {
        security: securityOf(isin, quote.ticker, type),
        units: open.units,
        price: open.amount.dividedBy(open.units),
      }),
    );
    assumed += 1;
  };

  for (const row of closed) {
    if (row.id === null) {
      blockAt(row.source)("invalidNumber", { column: "Position ID" });
    }
  }
  for (const [id, list] of opens) {
    const open = list[0] as Activity;
    const rows = closedById.get(id) ?? [];
    const closes = closesById.get(id) ?? [];
    if (rows.length === 0 && closes.length === 0) {
      readOpen(open, id);
      continue;
    }
    let reason: IgnoredReason = "pairedRow";
    if (rows.length === 0) {
      // Closed by Account Activity, but not in Closed Positions.
      for (const close of closes) {
        blockAt(close.source)("tradeInconsistent", { check: "activity" });
      }
      ignore(open.source, reason);
      continue;
    }
    for (const row of rows) {
      reason = readClosed(row, id, open, closes, rows.length);
    }
    ignore(open.source, reason);
    for (const close of closes) ignore(close.source, reason);
  }

  // Dividends, each paired with the one Account Activity row that paid it.
  const paid = new Set<Activity>();
  // The dollar Account Activity dividends by position, day and amount, so
  // each payment finds its own row by one lookup, however many rows a
  // crafted file gives one position (bounded work, CLAUDE.md).
  const unpaid = new Map<string, Activity[]>();
  // How many of them, on any day, pay each amount: a payment whose amount
  // a row pays on another day is a date mismatch, not a missing row.
  const unpaidAnyDay = new Map<string, number>();
  for (const [id, rows] of dividendsById) {
    for (const a of rows) {
      const day = a.at?.brokerDate ?? null;
      if (a.amount === null || day === null) continue;
      if (quoteOf(a.details)?.currency !== USD) continue;
      const amount = a.amount.toString();
      const slot = `${id}|${day}|${amount}`;
      const list = unpaid.get(slot);
      if (list === undefined) unpaid.set(slot, [a]);
      else list.push(a);
      const any = `${id}|${amount}`;
      unpaidAnyDay.set(any, (unpaidAnyDay.get(any) ?? 0) + 1);
    }
  }
  for (const payment of payments) {
    const block = blockAt(payment.source);
    const cell = (column: string) => cellOf(dividendTable, payment.row, column);
    const { id, isin } = payment;
    if (id === null) {
      block("invalidNumber", { column: "Position ID" });
      continue;
    }
    const date = dayOf(cell("Date of Payment"));
    if (date === null) {
      block("invalidTime", {});
      continue;
    }
    days.push(date);
    const net = numberOf(cell("Net Dividend Received (USD)"));
    const withheld = numberOf(cell("Withholding Tax Amount (USD)"));
    const at = where(isin, date);
    // The Account Activity rows of the position that paid this amount, in
    // dollars (ADR 0020 §10): one is this dividend's, on its day.
    // Exactly one unpaid row pairs; two alike are ambiguous, and pair none.
    const amount = net === null ? null : net.toString();
    const slot =
      amount === null ? undefined : unpaid.get(`${id}|${date}|${amount}`);
    const onDay = slot?.length ?? 0;
    const anyDay =
      amount === null ? 0 : (unpaidAnyDay.get(`${id}|${amount}`) ?? 0);
    const pair = onDay === 1 ? slot?.[0] : undefined;
    if (pair !== undefined && slot !== undefined && amount !== null) {
      slot.length = 0;
      unpaidAnyDay.set(`${id}|${amount}`, anyDay - 1);
    }
    const type = textOf(cell("Type")) ?? "";
    // The activity row this row pays out is this row's to account for:
    // left out with it, or covered by its refusal.
    if (pair !== undefined) {
      paid.add(pair);
      ignore(pair.source, DERIVATIVES.has(type) ? "derivative" : "pairedRow");
    }
    if (DERIVATIVES.has(type)) {
      // A contract's dividend adjustment: on D-IFI, with its contract.
      ignore(payment.source, "derivative");
      derivatives += 1;
      continue;
    }
    if (!REAL.has(type)) {
      block("unknownAction", { broker: ETORO, action: untrusted(type) });
      continue;
    }
    const quote = quoteOf(openOf(id).details);
    const currency =
      dividendTable.revision === "2025.11" ? textOf(cell("Currency")) : USD;
    if (quote?.currency !== USD || currency !== USD) {
      block("unconfirmedAction", { broker: ETORO, action: "nonUsd" });
      continue;
    }
    if (dividendTable.revision === "2025.11") {
      // Franking is Australia's credit for company tax: none here.
      const franking = [
        textOf(cell("Franked/Unfranked")),
        textOf(cell("Franking Credits (AUD)")),
      ];
      if (franking.some((t) => t !== "" && t !== NONE)) {
        block("unsupportedAction", { broker: ETORO, action: "franked" });
        continue;
      }
    }
    if (!isIsin(isin)) {
      block("invalidIsin", {});
      continue;
    }
    if (net === null) {
      block("invalidNumber", { column: "Net Dividend Received (USD)" });
      continue;
    }
    if (withheld === null) {
      block("invalidNumber", { column: "Withholding Tax Amount (USD)" });
      continue;
    }
    const rateText = textOf(cell("Withholding Tax Rate (%)"));
    const rate = rateText === null ? null : RATE.exec(rateText);
    if (rate === null) {
      block("invalidNumber", { column: "Withholding Tax Rate (%)" });
      continue;
    }
    if (!net.isPositive()) {
      block("unexpectedSign", { column: "Net Dividend Received (USD)" });
      continue;
    }
    if (withheld.isNegative()) {
      block("unexpectedSign", { column: "Withholding Tax Amount (USD)" });
      continue;
    }
    if (dividendTable.revision === "2025.11") {
      const native = numberOf(cell("Net dividends"));
      if (native === null) {
        block("invalidNumber", { column: "Net dividends" });
        continue;
      }
      if (!native.equals(net)) {
        block("dividendInconsistent", {
          broker: ETORO,
          ...at,
          mismatch: "netAmount",
        });
        continue;
      }
    }
    // eToro gives the dividend net of the tax withheld (research 07
    // §4.1, [M]): the gross is their sum, and the tax its stated rate of
    // it, give or take a cent of rounding.
    const gross = net.plus(withheld);
    const share = Decimal.parse(rate[1] ?? "0").dividedBy(
      Decimal.fromInteger(100),
    );
    if (withheld.minus(gross.times(share)).abs().greaterThan(CENT)) {
      block("dividendInconsistent", { broker: ETORO, ...at, mismatch: "rate" });
      continue;
    }
    if (pair === undefined) {
      block("dividendInconsistent", {
        broker: ETORO,
        ...at,
        mismatch: onDay === 0 && anyDay > 0 ? "date" : "pairing",
      });
      continue;
    }
    // The payment date is the dividend's (ADR 0020 §7). Booked near
    // midnight, its time could put it on the day before or after: a
    // warning, unless that day is in another tax year.
    const [early, late] =
      pair.at?.instant === undefined || pair.at.instant === null
        ? [null, null]
        : bandOf(pair.at.instant);
    if (
      early === null ||
      late === null ||
      early.slice(0, 4) !== date.slice(0, 4) ||
      late.slice(0, 4) !== date.slice(0, 4)
    ) {
      block("dateUncertain", { broker: ETORO, ...at });
      continue;
    }
    if (early !== date || late !== date) nearMidnight += 1;
    const security = securityOf(isin, quote.ticker, type);
    // The net amount too: a position paid twice on one day (a regular and
    // a special dividend) is two dividends, never one key twice.
    const key = keyOf("dividend", [id, date, net]);
    const clock = { instant: null, brokerDate: date };
    events.push({
      kind: "dividend",
      key,
      broker: ETORO,
      account,
      source: payment.source,
      at: clock,
      date,
      security,
      gross: { amount: gross, currency: USD },
    });
    if (withheld.isPositive()) {
      events.push({
        kind: "withholding",
        key: keyOf("withholding", [id, date, net]),
        broker: ETORO,
        account,
        source: payment.source,
        at: clock,
        date,
        isin,
        dividendKey: key,
        amount: { amount: withheld, currency: USD },
      });
    }
  }

  // Account Activity's other rows: a closed list (ADR 0020 §9).
  for (const row of activity) {
    const block = blockAt(row.source);
    const type = row.type ?? "";
    if (type === OPEN || type === CLOSE) {
      // Read with their position above; one without a valid ID is not.
      if (!row.idValid || row.id === null) {
        block("invalidNumber", { column: "Position ID" });
      }
      continue;
    }
    if (type === DIVIDEND) {
      if (!paid.has(row)) {
        block("dividendInconsistent", { broker: ETORO, mismatch: "unpaired" });
      }
      continue;
    }
    if (row.at === null) {
      block("invalidTime", {});
      continue;
    }
    const cash = CASH.get(type);
    if (cash !== undefined) {
      ignore(row.source, cash);
    } else if (type === INTEREST) {
      ignore(row.source, "interest");
      interest += 1;
    } else {
      block("unknownAction", { broker: ETORO, action: untrusted(type) });
    }
  }

  if (derivatives > 0) {
    diagnostics.push(
      diagnostic("warning", "derivativesNotCovered", {
        broker: ETORO,
        count: derivatives,
      }),
    );
  }
  if (interest > 0) {
    diagnostics.push(
      diagnostic("warning", "interestNotCovered", {
        broker: ETORO,
        count: interest,
      }),
    );
  }
  if (assumed > 0) {
    diagnostics.push(
      diagnostic("warning", "openPositionsAssumed", {
        broker: ETORO,
        count: assumed,
      }),
    );
  }
  if (nearMidnight > 0) {
    diagnostics.push(
      diagnostic("warning", "dividendDatesUncertain", {
        broker: ETORO,
        count: nearMidnight,
      }),
    );
  }
  for (const [name, part] of SKIPPED) {
    if (positions.has(name)) {
      ignore({ fileId: context.fileId, row: 1, part }, "summary");
    }
  }
  const lastDate = days.reduce<IsoDate | null>(
    (latest, day) => (latest === null || day > latest ? day : latest),
    null,
  );
  return done(lastDate === null ? [] : [{ account, lastDate }]);
}

/** Rows of Account Activity by the position they name. */
function group(rows: readonly Activity[]): Map<string, Activity[]> {
  const byId = new Map<string, Activity[]>();
  for (const row of rows) {
    if (row.id === null) continue;
    // Appended in place: copying the list per row would make a file that
    // names one position on many rows quadratic.
    const list = byId.get(row.id);
    if (list === undefined) byId.set(row.id, [row]);
    else list.push(row);
  }
  return byId;
}

/**
 * Whether `value` is `expected` give or take what rounding leaves: a cent,
 * and a unit of the units' last decimal at `rate`.
 */
function near(value: Decimal, expected: Decimal, rate: Decimal): boolean {
  const tolerance = CENT.plus(rate.abs().times(UNITS_STEP));
  return !value.minus(expected).abs().greaterThan(tolerance);
}

/**
 * Whether a trade's day is the same wherever in UTC to UTC+3 its clock
 * is (ADR 0020 §7); its policy date, the UTC reading, is then certain.
 */
function certain(at: BrokerTime): boolean {
  if (at.instant === null) return false;
  const [early, late] = bandOf(at.instant);
  return early !== null && early === late;
}

function securityOf(isin: string, ticker: string, type: string): SecurityRef {
  return {
    isin,
    symbol: ticker,
    ...(type === "ETF" ? { isFund: true } : {}),
  };
}

/**
 * A purchase or sale of a position, keyed by eToro's ID for it and the
 * side (ADR 0020 §3): the same position read from another statement has
 * the same key, and its open and close never share one.
 */
function trade(
  account: AccountScope,
  source: SourceRef,
  at: BrokerTime,
  date: IsoDate,
  id: string,
  side: "buy" | "sell",
  lot: {
    readonly security: SecurityRef;
    readonly units: Decimal;
    readonly price: Decimal;
  },
): LedgerEvent {
  return {
    kind: "trade",
    key: keyOf("trade", [side === "buy" ? "open" : "close", id]),
    broker: ETORO,
    account,
    source,
    at,
    side,
    date,
    security: lot.security,
    quantity: lot.units,
    price: { amount: lot.price, currency: USD },
  };
}

/** The five sheets an English account statement has, each by its name. */
const SHEETS = [...READ.keys(), ...SKIPPED.keys()];

/**
 * eToro's account statement: recognized when all five of its sheets are
 * there, by exact name, so that one it adds is refused by name in `read`
 * rather than going unrecognized.
 */
export const etoro: XlsxAdapter = {
  broker: ETORO,
  matches: (book: WorkbookInfo) =>
    SHEETS.every((name) => book.sheets.some((s) => s.name === name)),
  read,
};
