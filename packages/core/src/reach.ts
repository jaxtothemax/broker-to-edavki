/**
 * Which of one year's returns a blocking finding from reading the files can
 * change (ADR 0017, amending ADR 0013 §9). Most such findings could bear on
 * anything, so they withhold both returns of every year. A refusal whose
 * adapter states the security, the date and what the row does to the
 * holding is scoped to the returns it can reach: a takeover paid in shares
 * booked in 2025 changes no figure of a 2026 return in which neither
 * security is sold, and must not withhold it. A purchase whose security the
 * file does not name is scoped without a security: it holds back only the
 * Doh-KDVP of years with a sale of any security from 30 days before it on.
 */
import { compareText } from "./compare.js";
import { isIsoDate, type IsoDate } from "./dates.js";
import {
  diagnostic,
  type Diagnostic,
  type RefusedShares,
} from "./diagnostics.js";
import { addDays } from "./holding.js";
import { isIsin } from "./isin.js";
import type { ValidatedLedger } from "./validate.js";
import { WASH_SALE_DAYS } from "./wash-sale.js";

/**
 * How long after an event a broker may book it. Trading 212 booked a
 * takeover and a special dividend several days after they happened, so a
 * row's date is its booking, not the event (research 06 §4.3). A month
 * keeps an event of late December booked in January on December's year.
 */
export const BOOKING_LAG_DAYS = 31;

/** One year's view of the ledger's findings. */
export interface LedgerScope {
  /** Blocking findings from reading the files that withhold Doh-KDVP. */
  readonly kdvp: readonly Diagnostic[];
  /** Blocking findings from reading the files that withhold Doh-Div. */
  readonly div: readonly Diagnostic[];
  /**
   * The ledger's findings as this year's review shows them, in order: a
   * refusal that can change neither return is a note that says so instead.
   */
  readonly findings: readonly Diagnostic[];
  /**
   * Any list of the same findings, such as one file's, as this year shows
   * it: each refusal the year's view replaced, replaced the same way.
   */
  readonly view: (findings: readonly Diagnostic[]) => Diagnostic[];
}

interface Scoped {
  readonly isin: string;
  readonly date: IsoDate;
  readonly shares: RefusedShares;
}

/**
 * Every effect a refusal may state, as a record the compiler checks against
 * `RefusedShares`: one added there and missing here does not compile (#15's
 * class), where a copied list would quietly withhold everything.
 */
const SHARES = {
  out: true,
  in: true,
  rights: true,
} as const satisfies Record<RefusedShares, true>;

/**
 * A refusal the rule can scope: one of the codes an adapter marks, with a
 * real ISIN, a real date and a known effect. Anything else is null, and
 * withholds everything, as before ADR 0017.
 */
function scopedOf(finding: Diagnostic): Scoped | null {
  if (
    finding.severity !== "blocking" ||
    (finding.code !== "unsupportedAction" && finding.code !== "invalidPrice")
  ) {
    return null;
  }
  const { isin, date, shares } = finding.params;
  if (
    isin === undefined ||
    !isIsin(isin) ||
    date === undefined ||
    !isIsoDate(date) ||
    shares === undefined ||
    !Object.hasOwn(SHARES, shares)
  ) {
    return null;
  }
  return { isin, date, shares };
}

/**
 * A purchase whose security the file does not name: `isinUnresolved` with
 * `side: "buy"` and a real date. Anything else is null and withholds
 * everything, as before (ADR 0017 §3, the bullet on a purchase the file does
 * not name). Its cause, missing or ambiguous, only words the finding.
 */
function unresolvedBuyOf(
  finding: Diagnostic,
): { readonly broker: string; readonly date: IsoDate } | null {
  if (finding.severity !== "blocking" || finding.code !== "isinUnresolved") {
    return null;
  }
  const { broker, date, side } = finding.params;
  if (side !== "buy" || date === undefined || !isIsoDate(date)) {
    return null;
  }
  return { broker, date };
}

/** One row's refusal, the same in the ledger and in its file's findings. */
function rowOf(finding: Diagnostic): string | null {
  const { source } = finding;
  return source === undefined
    ? null
    : [finding.code, source.fileId, source.part ?? "", String(source.row)].join(
        " ",
      );
}

/** Before every date: a holding with no purchase on record reaches any year. */
const DAWN = "0000-01-01";

/** The index of the first date not before `date`, in dates sorted as text. */
function firstFrom(dates: readonly IsoDate[], date: IsoDate): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareText(dates[middle] ?? "", date) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function scopeLedger(
  ledger: ValidatedLedger,
  taxYear: number,
): LedgerScope {
  // A malformed year would compare as text and scope every refusal away,
  // so it is refused here as the builders refuse it.
  if (!Number.isInteger(taxYear) || taxYear < 2013 || taxYear > 9999) {
    throw new RangeError("taxYear must be a whole year from 2013");
  }
  const yearStart = `${String(taxYear)}-01-01`;
  const yearEnd = `${String(taxYear)}-12-31`;
  const overlaps = (from: IsoDate, to: IsoDate) =>
    compareText(from, yearEnd) <= 0 && compareText(to, yearStart) >= 0;

  // Every file and account together: FIFO and the 30-day rule run across
  // all of a taxpayer's holdings (research 04 §4.4, §5.3). Indexed once, so
  // each refusal is looked up, not scanned for.
  const lastSale = new Map<string, IsoDate>();
  const saleDates: IsoDate[] = [];
  const firstBuy = new Map<string, IsoDate>();
  for (const event of ledger.events) {
    if (event.kind !== "trade") continue;
    const { isin } = event.security;
    if (event.side === "sell") {
      if (!overlaps(event.date, event.date)) continue;
      saleDates.push(event.date);
      const seen = lastSale.get(isin);
      if (seen === undefined || compareText(event.date, seen) > 0) {
        lastSale.set(isin, event.date);
      }
    } else {
      const seen = firstBuy.get(isin);
      if (seen === undefined || compareText(event.date, seen) < 0) {
        firstBuy.set(isin, event.date);
      }
    }
  }
  saleDates.sort(compareText);
  const anySaleBetween = (from: IsoDate, to: IsoDate) => {
    const at = saleDates[firstFrom(saleDates, from)];
    return at !== undefined && compareText(at, to) <= 0;
  };

  const kdvp: Diagnostic[] = [];
  const div: Diagnostic[] = [];
  const findings: Diagnostic[] = [];
  const replaced = new Map<string, Diagnostic>();
  /** Shows `note` in place of `finding`, in the review and in its file. */
  const replaceWith = (finding: Diagnostic, note: Diagnostic) => {
    findings.push(note);
    const row = rowOf(finding);
    if (row !== null) replaced.set(row, note);
  };
  for (const finding of ledger.diagnostics) {
    const bought = unresolvedBuyOf(finding);
    if (bought !== null) {
      // The lot is missing from the ledger and its security is unknown, so
      // no key is safe: another broker's rows may lack a ticker or write it
      // differently, and a missed match would release a return the lot can
      // change. Any later sale, of any security, can take it under FIFO
      // however long after the purchase (research 04 §4.4); and a loss sale
      // reads a purchase 30 days either side (ZDoh-2 art. 97(5), 04 §5.3),
      // so a sale from 30 days before the purchase on is reached. An earlier
      // sale can neither take the lot nor be replaced by it. The date is the
      // trade's, not a booking's, so no BOOKING_LAG_DAYS. Doh-Div reads no
      // lots, and a purchase is no income: it is never withheld here.
      if (anySaleBetween(addDays(bought.date, -WASH_SALE_DAYS), yearEnd)) {
        kdvp.push(finding);
        findings.push(finding);
      } else {
        replaceWith(
          finding,
          diagnostic(
            "info",
            "unresolvedElsewhere",
            {
              broker: bought.broker,
              date: bought.date,
              year: String(taxYear),
            },
            finding.source,
          ),
        );
      }
      continue;
    }
    const scoped = scopedOf(finding);
    if (scoped === null) {
      if (finding.severity === "blocking") {
        kdvp.push(finding);
        div.push(finding);
      }
      findings.push(finding);
      continue;
    }
    const { isin, date, shares } = scoped;
    // The event happened on the booking day or up to a month before it.
    const happened = addDays(date, -BOOKING_LAG_DAYS);
    // A sale of the same security from 30 days before the event on: FIFO
    // takes its lots with or without the refused row, and the 30-day rule
    // reads a purchase or a right 30 days either side of a loss sale
    // (ZDoh-2 art. 97(5), research 04 §5.3).
    const reach = addDays(happened, -WASH_SALE_DAYS);
    const last = lastSale.get(isin);
    let onKdvp = last !== undefined && compareText(last, reach) >= 0;
    let onDiv = false;
    if (shares === "out") {
      // A disposal belongs to the year it happened, and that can be earlier
      // than its booking by more than a month: one reading dates a merger by
      // its agreement (research 04 §9.1). So every year from the first
      // purchase it gives up, or any year if none is on record.
      const bought = firstBuy.get(isin);
      const from =
        bought === undefined || compareText(bought, date) > 0 ? DAWN : bought;
      onKdvp ||= overlaps(
        compareText(from, happened) < 0 ? from : happened,
        date,
      );
    } else {
      // Shares or rights received might be income in their own year.
      onDiv = overlaps(happened, date);
      if (shares === "rights") {
        // A right to buy counts as acquiring capital of the same kind, for
        // a loss sale of any security it could be a right to (art.
        // 97(5)(1)); the row names only the right, so any sale reaches it.
        onKdvp ||= anySaleBetween(reach, addDays(date, WASH_SALE_DAYS));
      }
    }
    if (onKdvp) kdvp.push(finding);
    if (onDiv) div.push(finding);
    if (onKdvp || onDiv) {
      findings.push(finding);
      continue;
    }
    replaceWith(
      finding,
      diagnostic(
        "info",
        "refusedElsewhere",
        { isin, date, year: String(taxYear), shares },
        finding.source,
      ),
    );
  }
  const view = (list: readonly Diagnostic[]) =>
    list.map((finding) => {
      const row = rowOf(finding);
      return (row === null ? undefined : replaced.get(row)) ?? finding;
    });
  return { kdvp, div, findings, view };
}
