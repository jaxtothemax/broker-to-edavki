/**
 * Trade Republic's transaction export (CSV), in the two revisions known
 * (docs/research/07-brokers-eu-and-others.md §4.2; ADR 0015, ADR 0019).
 *
 * What it reads, and why:
 *
 * - **Recognized by an exact header and its delimiter**: the 23 columns
 *   with `mcc_code`, written with commas, quoted or not; or the 23 with
 *   `value_date` in its place, written with semicolons. A revision that
 *   adds or drops a column, or a known header with the other delimiter (a
 *   re-save in another locale), is no export this knows, not read on a
 *   guess until it has its own fixture.
 * - **Dates by the one date policy.** In the comma revision `datetime` is a
 *   UTC instant, which the ledger keeps, and `date` the Berlin calendar
 *   date, which is the Ljubljana one too: the two must agree. In the
 *   semicolon revision `datetime` is no time, only the date at midnight UTC
 *   on every row, so `date` alone dates it. `value_date` is a settlement
 *   date, never a tax date. A row that cannot be dated is refused, unless
 *   its type refuses it first, for what it is.
 * - **Trades** (`BUY`, `SELL`, a savings plan's `SAVINGS_PLAN_EXECUTED`) of
 *   shares and funds, at `price` in `currency`; a sale's `shares` are
 *   negative, a purchase's positive. Fees, tax and the cash `amount` are
 *   never used as values, only checked: costs are covered by the normed
 *   costs, as for every broker (04 §4.2). `asset_class` says which security
 *   is a fund. Trades of derivatives are left out with a warning: they go
 *   on D-IFI, as Interactive Brokers' do.
 * - **Cash rows** that are part of neither return (deposits, withdrawals,
 *   card spending and its Saveback cash, gifts of cash) are ignored by
 *   reason; interest is ignored with a warning, as it belongs on Doh-Obr.
 *   German tax rows (a tax refund, the Vorabpauschale) are ignored in their
 *   known shape, an amount of 0 and a tax, and counted with taxed sales in
 *   one warning: no Slovenian figure uses them, but they show Trade
 *   Republic taxed the account as German.
 * - **Refused, not guessed:** dividends and fund distributions, until a
 *   real export confirms what `tax` holds for a Slovenian resident (07
 *   §4.2); returns of capital; free shares; corporate actions, deliveries
 *   and migrations; bonds and their coupons, private markets, crypto and
 *   gold; a child's (`JUNIOR`) account, another taxpayer's, once per file;
 *   and any row this adapter does not know.
 * - **Keys** by `transaction_id` and the trade's date, assumed never reused
 *   (ADR 0015), and without an ordinal (ADR 0011 §5): the same row in an
 *   overlapping export is read once, and a row repeated inside one file
 *   blocks as a repeat instead of counting twice. The date, not the
 *   instant, so that a trade keys alike in both revisions.
 * - **A trade's figures are checked:** its cash `amount` must be its
 *   quantity times its price, give or take its fee and a cent, and a trade
 *   with a foreign leg (`original_amount`, `original_currency`, `fx_rate`)
 *   is refused until a real export shows which currency its price is in.
 * - **One account:** `account_type` names the kind of account, and only
 *   `DEFAULT` is the taxpayer's. Every file is taken for the one taxpayer's
 *   account, so overlapping exports are read once, whatever the user
 *   answers about other brokers' unnamed accounts; a second person's export
 *   added by mistake would be read as the same account (ADR 0011 §4,
 *   ADR 0015).
 *
 * File text reaches a finding only as an unknown type, category, class or
 * account type, wrapped as untrusted: never a description, a name or an
 * IBAN, which the cash rows carry.
 */
import {
  accountScope,
  Decimal,
  diagnostic,
  isIsin,
  isIsoDate,
  keyOf,
  LIMITS,
  taxDate,
  untrusted,
  type BrokerTime,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticParams,
  type IgnoredReason,
  type IsoDate,
  type LedgerEvent,
  type SecurityRef,
  type SourceRef,
} from "@taxreporter/core";

import type { CsvAdapter, ImportResult, ReadContext } from "./adapter.js";
import type { CsvDelimiter, CsvRow, CsvTable } from "./csv.js";
import { fromUtcStamp } from "./time.js";

export const TRADE_REPUBLIC = "traderepublic";

/** The comma revision's columns, in the order it writes them (07 §4.2). */
export const TRADE_REPUBLIC_COLUMNS = [
  "datetime",
  "date",
  "account_type",
  "category",
  "type",
  "asset_class",
  "name",
  "symbol",
  "shares",
  "price",
  "amount",
  "fee",
  "tax",
  "currency",
  "original_amount",
  "original_currency",
  "fx_rate",
  "description",
  "transaction_id",
  "counterparty_name",
  "counterparty_iban",
  "payment_reference",
  "mcc_code",
] as const;

/**
 * The semicolon revision's columns, in the order it writes them: the same,
 * with `value_date` after `transaction_id` and no `mcc_code` (07 §4.2).
 */
export const TRADE_REPUBLIC_VALUE_DATE_COLUMNS = [
  ...TRADE_REPUBLIC_COLUMNS.slice(0, 19),
  "value_date",
  ...TRADE_REPUBLIC_COLUMNS.slice(19, 22),
] as const;

/**
 * The columns both revisions have, the only ones read: neither `mcc_code`
 * nor `value_date` can reach a figure.
 */
type Column = Exclude<(typeof TRADE_REPUBLIC_COLUMNS)[number], "mcc_code">;

interface Revision {
  readonly format: string;
  readonly columns: readonly string[];
  readonly delimiter: CsvDelimiter;
  /** Whether `datetime` is a time, or only the date at midnight UTC. */
  readonly timed: boolean;
}

/** Each header, tied to the delimiter it was seen with (ADR 0019). */
const REVISIONS: readonly Revision[] = [
  {
    format: "traderepublic-csv-2026",
    columns: TRADE_REPUBLIC_COLUMNS,
    delimiter: ",",
    timed: true,
  },
  {
    format: "traderepublic-csv-value-date",
    columns: TRADE_REPUBLIC_VALUE_DATE_COLUMNS,
    delimiter: ";",
    timed: false,
  },
];

function revisionOf(
  header: readonly string[],
  delimiter: CsvDelimiter,
): Revision | undefined {
  return REVISIONS.find(
    (r) =>
      r.delimiter === delimiter &&
      header.length === r.columns.length &&
      r.columns.every((name) => header.includes(name)),
  );
}

/** The taxpayer's own account, the one account a known export names. */
const ACCOUNT_TYPE = "DEFAULT";

/** A child's account (07 §4.2): another taxpayer's, never pooled. */
const JUNIOR = "JUNIOR";

const BUYS = new Set(["BUY", "SAVINGS_PLAN_EXECUTED"]);
const SELLS = new Set(["SELL"]);

/** Securities whose purchase and sale go on Doh-KDVP: shares and funds. */
const ASSET_CLASSES = new Set(["STOCK", "FUND"]);

/** Derivatives: their trades go on D-IFI, left out with a warning. */
const DERIVATIVE = "DERIVATIVE";

/**
 * Classes known and refused, by the names a finding gives them: bonds,
 * private markets, crypto, gold certificates (`SYNTHETIC`, reported by a
 * parser of real exports, 07 §4.2), and the cash of derivatives.
 */
const REFUSED_CLASSES = new Set([
  "BOND",
  "PRIVATE_FUND",
  "CRYPTO",
  "SYNTHETIC",
  DERIVATIVE,
]);

/** Cash movements, part of neither return. */
const CASH: ReadonlyMap<string, IgnoredReason> = new Map([
  ["CUSTOMER_INBOUND", "deposit"],
  ["CUSTOMER_INPAYMENT", "deposit"],
  ["TRANSFER_IN", "deposit"],
  ["TRANSFER_INBOUND", "deposit"],
  ["TRANSFER_INSTANT_INBOUND", "deposit"],
  ["CUSTOMER_OUTBOUND_REQUEST", "withdrawal"],
  ["TRANSFER_OUT", "withdrawal"],
  ["TRANSFER_INSTANT_OUTBOUND", "withdrawal"],
  // A direct debit charges the account, whatever its name says (07 §4.2).
  ["TRANSFER_DIRECT_DEBIT_INBOUND", "withdrawal"],
  ["CARD_TRANSACTION", "cardSpending"],
  ["CARD_TRANSACTION_INTERNATIONAL", "cardSpending"],
  ["GIFT", "gift"],
  // Saveback paid as cash is card cashback; the shares it buys come in a
  // purchase row of their own (07 §4.2).
  ["BENEFITS_SAVEBACK", "cardSpending"],
]);

/** Interest: taxable, but on Doh-Obr, which this version does not build. */
const INTEREST = "INTEREST_PAYMENT";

/**
 * German tax rows (07 §4.2), ignored only in their known shape, an amount
 * of 0 and a tax: a tax refund or charge on the cash account, and the
 * Vorabpauschale (InvStG §18) or its tax base on a fund.
 */
const GERMAN_TAX_CASH = new Set(["TAX_OPTIMIZATION"]);
const GERMAN_TAX_FUND = new Set(["EARNINGS", "PRE_DETERMINED_TAX_BASE"]);

/**
 * Rows known and refused, each named by this list, never by the file:
 * returns of capital, which lower a cost basis; free shares and gifts of
 * securities, whose cost basis is a tax question; moves of securities, and
 * the cash of bonds and derivatives, which are not read on a guess (07
 * §4.2).
 */
const UNSETTLED = new Set([
  "DIVIDEND_EQUIVALENT_PAYMENT",
  "BENEFITS_SAVEBACK",
  "STOCKPERK",
  "BONUS",
  "GIFT",
  "MIGRATION",
  "REDEMPTION",
  "FINAL_MATURITY",
  "PRIVATE_MARKET_BUY",
  "SEC_ACCOUNT",
  "TILG",
]);

/** Categories whose every row is a corporate action or a delivery. */
const UNSETTLED_CATEGORIES = new Set(["CORPORATE_ACTION", "DELIVERY"]);

/**
 * Dividends and fund distributions: their treatment is settled, but not
 * what `tax` holds on them for a Slovenian resident, which no source
 * confirms yet (07 §4.2).
 */
const UNCONFIRMED = new Set(["DIVIDEND", "DISTRIBUTION"]);

/** A plain decimal, an optional minus, as Trade Republic writes them. */
const NUMBER = new RegExp(
  `^-?\\d{1,${String(LIMITS.numberWholeDigits)}}(?:\\.\\d{1,${String(LIMITS.numberDecimals)}})?$`,
);
const CURRENCY = /^[A-Z]{3}$/;
const CENT = Decimal.parse("0.01");

const isZero = (text: string) =>
  NUMBER.test(text) && Decimal.parse(text).isZero();
const isNonZero = (text: string) =>
  NUMBER.test(text) && !Decimal.parse(text).isZero();

/** What a row is, from its category, type and class, before its date. */
type Verdict =
  | { readonly kind: "trade"; readonly side: "buy" | "sell" }
  | {
      readonly kind: "ignore";
      readonly reason: IgnoredReason;
      readonly counted?: "interest" | "derivative" | "brokerTax";
    }
  | {
      readonly kind: "refuse";
      readonly code: "unsupportedAction" | "unconfirmedAction";
      /** From this adapter's own lists, or a known export token. */
      readonly action: string;
    }
  /** Unknown file text, which a finding carries only wrapped. */
  | { readonly kind: "unknown"; readonly text: string };

function classify(cell: (column: Column) => string): Verdict {
  const category = cell("category");
  const type = cell("type");
  const assetClass = cell("asset_class");
  // Cash only as cash: the cash category, no security and no shares.
  const isCash =
    category === "CASH" && cell("symbol") === "" && cell("shares") === "";

  if (UNSETTLED_CATEGORIES.has(category)) {
    return { kind: "refuse", code: "unsupportedAction", action: category };
  }
  if (category === "CASH") {
    const cash = CASH.get(type);
    if (cash !== undefined && isCash) return { kind: "ignore", reason: cash };
    if (type === INTEREST && isCash) {
      return { kind: "ignore", reason: "interest", counted: "interest" };
    }
    if (GERMAN_TAX_CASH.has(type) || GERMAN_TAX_FUND.has(type)) {
      // By shape, never by name or description: an amount of 0 and a tax.
      // Anything else under these types could move money, and is not
      // guessed at.
      const shaped =
        isZero(cell("amount")) &&
        isNonZero(cell("tax")) &&
        (GERMAN_TAX_CASH.has(type)
          ? isCash
          : assetClass === "FUND" && isIsin(cell("symbol")));
      return shaped
        ? {
            kind: "ignore",
            reason: "brokerTaxSettlement",
            counted: "brokerTax",
          }
        : { kind: "refuse", code: "unconfirmedAction", action: type };
    }
    if (UNCONFIRMED.has(type)) {
      return { kind: "refuse", code: "unconfirmedAction", action: type };
    }
    if (UNSETTLED.has(type)) {
      return { kind: "refuse", code: "unsupportedAction", action: type };
    }
    // A bond's coupon, or other cash of a refused class: its class says
    // why.
    if (REFUSED_CLASSES.has(assetClass)) {
      return { kind: "refuse", code: "unsupportedAction", action: assetClass };
    }
    return { kind: "unknown", text: type };
  }
  if (UNSETTLED.has(type)) {
    return { kind: "refuse", code: "unsupportedAction", action: type };
  }
  if (category !== "TRADING") return { kind: "unknown", text: category };
  const side = BUYS.has(type) ? "buy" : SELLS.has(type) ? "sell" : null;
  if (side === null) return { kind: "unknown", text: type };
  if (ASSET_CLASSES.has(assetClass)) return { kind: "trade", side };
  if (assetClass === DERIVATIVE) {
    return { kind: "ignore", reason: "derivative", counted: "derivative" };
  }
  if (REFUSED_CLASSES.has(assetClass)) {
    return { kind: "refuse", code: "unsupportedAction", action: assetClass };
  }
  return { kind: "unknown", text: assetClass };
}

/**
 * A row's broker clock and tax date, or null when it cannot be dated. In
 * the comma revision the instant's Ljubljana date must be `date`. In the
 * semicolon revision `datetime` must be `date` at midnight UTC, written as
 * every row of that revision writes it, and `date` alone dates the row:
 * its `value_date` is the settlement, two days later on a purchase (07
 * §4.2), and never a tax date.
 */
function dateOf(
  datetime: string,
  brokerDate: string,
  timed: boolean,
): { readonly at: BrokerTime; readonly date: IsoDate } | null {
  if (!isIsoDate(brokerDate)) return null;
  if (!timed) {
    return datetime === `${brokerDate}T00:00:00.000000Z`
      ? { at: { instant: null, brokerDate }, date: brokerDate }
      : null;
  }
  const stamp = fromUtcStamp(datetime);
  if (stamp === null) return null;
  const at = { instant: stamp.instant, brokerDate };
  const dated = taxDate(at);
  return dated === null || dated.moved ? null : { at, date: dated.date };
}

function read(table: CsvTable, context: ReadContext): ImportResult {
  const revision = revisionOf(table.header, table.delimiter);
  if (revision === undefined) {
    throw new Error("tradeRepublic: read a table its matches refuses");
  }
  const account = accountScope(TRADE_REPUBLIC, ACCOUNT_TYPE);
  const events: LedgerEvent[] = [];
  const diagnostics: Diagnostic[] = [];
  // Every column is there: the header matched them all.
  const text = (row: CsvRow, column: Column) => {
    const index = table.column(column);
    return index === undefined ? "" : (row.cells[index] ?? "");
  };
  const counts = { interest: 0, derivative: 0, brokerTax: 0 };
  let junior: SourceRef | null = null;
  // Widened, not narrowed to null: `reached` assigns it from a closure.
  let lastDate = null as IsoDate | null;
  const reached = (date: IsoDate) => {
    if (lastDate === null || date > lastDate) lastDate = date;
  };

  for (const row of table.rows) {
    const source: SourceRef = { fileId: context.fileId, row: row.row };
    const block = <C extends DiagnosticCode>(
      code: C,
      params: DiagnosticParams[C],
    ) => {
      diagnostics.push(diagnostic("blocking", code, params, source));
    };
    const cell = (column: Column) => text(row, column);

    const accountType = cell("account_type");
    if (accountType === JUNIOR) {
      // Another taxpayer's rows: one finding for the file, at the first.
      junior ??= source;
      continue;
    }
    // The date, where the rule gives one. A row refused for what it is
    // needs none, and moves the file's reach only when it has one: a
    // reach a row cannot vouch for would weaken the 30-day rule's check.
    const dated = dateOf(cell("datetime"), cell("date"), revision.timed);
    if (accountType !== ACCOUNT_TYPE) {
      if (dated !== null) reached(dated.date);
      block("unknownAction", {
        broker: TRADE_REPUBLIC,
        action: untrusted(accountType),
      });
      continue;
    }
    const verdict = classify(cell);
    if (verdict.kind === "refuse") {
      if (dated !== null) reached(dated.date);
      block(verdict.code, { broker: TRADE_REPUBLIC, action: verdict.action });
      continue;
    }
    if (verdict.kind === "unknown") {
      if (dated !== null) reached(dated.date);
      block("unknownAction", {
        broker: TRADE_REPUBLIC,
        action: untrusted(verdict.text),
      });
      continue;
    }
    if (dated === null) {
      block("invalidTime", {});
      continue;
    }
    const { at, date } = dated;
    reached(date);
    if (verdict.kind === "ignore") {
      if (verdict.counted !== undefined) counts[verdict.counted] += 1;
      events.push({
        kind: "ignored",
        reason: verdict.reason,
        broker: TRADE_REPUBLIC,
        account,
        source,
      });
      continue;
    }

    const side = verdict.side;
    const isin = cell("symbol");
    if (!isIsin(isin)) {
      block("invalidIsin", {});
      continue;
    }
    const sharesText = cell("shares");
    const priceText = cell("price");
    if (!NUMBER.test(sharesText)) {
      block("invalidNumber", { column: "shares" });
      continue;
    }
    if (!NUMBER.test(priceText)) {
      block("invalidNumber", { column: "price" });
      continue;
    }
    const shares = Decimal.parse(sharesText);
    // A sale's shares leave the account, so they are written negative.
    if (shares.isZero() || shares.isNegative() !== (side === "sell")) {
      block("unexpectedSign", { column: "shares" });
      continue;
    }
    const price = Decimal.parse(priceText);
    if (!price.isPositive()) {
      block("invalidPrice", {});
      continue;
    }
    const currency = cell("currency");
    if (!CURRENCY.test(currency)) {
      block("invalidCurrency", {});
      continue;
    }
    // A foreign leg: the price may then be in another currency than
    // `currency` says, which no source settles yet (07 §4.2).
    if (
      cell("original_amount") !== "" ||
      cell("original_currency") !== "" ||
      cell("fx_rate") !== ""
    ) {
      block("unconfirmedAction", {
        broker: TRADE_REPUBLIC,
        action: "FOREIGN_CURRENCY_TRADE",
      });
      continue;
    }
    const amountText = cell("amount");
    const feeText = cell("fee");
    const taxText = cell("tax");
    if (!NUMBER.test(amountText)) {
      block("invalidNumber", { column: "amount" });
      continue;
    }
    if (feeText !== "" && !NUMBER.test(feeText)) {
      block("invalidNumber", { column: "fee" });
      continue;
    }
    if (taxText !== "" && !NUMBER.test(taxText)) {
      block("invalidNumber", { column: "tax" });
      continue;
    }
    const quantity = shares.abs();
    // The cash moved is the quantity at the price, with or without the
    // fee: a price in another unit, or another trade's amount, shows here.
    // Real exports give `amount` gross with the tax beside it (ADR 0019),
    // so a tax never widens the check.
    const fee = feeText === "" ? Decimal.ZERO : Decimal.parse(feeText).abs();
    const off = quantity
      .times(price)
      .minus(Decimal.parse(amountText).abs())
      .abs();
    if (off.greaterThan(fee.plus(CENT))) {
      block("tradeInconsistent", { isin, date, check: "amount" });
      continue;
    }
    // A sale Trade Republic taxed shows German tax, as the rows above do:
    // the sale is read, and counted in their warning.
    if (side === "sell" && isNonZero(taxText)) counts.brokerTax += 1;
    const name = cell("name");
    const security: SecurityRef = {
      isin,
      ...(name === "" ? {} : { name }),
      ...(cell("asset_class") === "FUND" ? { isFund: true } : {}),
    };
    events.push({
      kind: "trade",
      key: keyOf("trade", [
        cell("transaction_id"),
        cell("type"),
        date,
        isin,
        quantity,
        price,
        currency,
      ]),
      broker: TRADE_REPUBLIC,
      account,
      source,
      at,
      side,
      date,
      security,
      quantity,
      price: { amount: price, currency },
    });
  }

  if (junior !== null) {
    diagnostics.push(
      diagnostic(
        "blocking",
        "juniorAccount",
        { broker: TRADE_REPUBLIC },
        junior,
      ),
    );
  }
  if (counts.interest > 0) {
    diagnostics.push(
      diagnostic("warning", "interestNotCovered", {
        broker: TRADE_REPUBLIC,
        count: counts.interest,
      }),
    );
  }
  if (counts.derivative > 0) {
    diagnostics.push(
      diagnostic("warning", "derivativesNotCovered", {
        broker: TRADE_REPUBLIC,
        count: counts.derivative,
      }),
    );
  }
  if (counts.brokerTax > 0) {
    diagnostics.push(
      diagnostic("warning", "brokerTaxSettled", {
        broker: TRADE_REPUBLIC,
        count: counts.brokerTax,
      }),
    );
  }

  return {
    broker: TRADE_REPUBLIC,
    format: revision.format,
    events,
    diagnostics,
    reach: lastDate === null ? [] : [{ account, lastDate }],
  };
}

/**
 * Trade Republic's transaction export: one of its exact headers, in any
 * column order, with the delimiter that header is written with.
 */
export const tradeRepublic: CsvAdapter = {
  broker: TRADE_REPUBLIC,
  matches: (header, delimiter) => revisionOf(header, delimiter) !== undefined,
  read,
};
