/**
 * The web UI's view of a prepared return. The dashboard renders only this
 * shape; the engine worker maps the pipeline's output onto it
 * (engine/toPreview.ts), so the screens never depend on parser or lot-engine
 * internals, and nothing but plain data crosses from the worker (ADR 0013).
 *
 * Every amount is a plain decimal string ("1234.56", "-427.50"), never a JS
 * number: the UI formats values, it never does arithmetic on them (ADR 0006).
 */
import type { DiagnosticCode } from "@taxreporter/core";

/**
 * The name a return is saved under: the same for the demo's and the user's,
 * and what the tour says the download is called. Here, not in a screen, so
 * the engine chunk that writes the demo's files can use it too.
 */
export function formFileName(form: "kdvp" | "div", taxYear: number): string {
  return `${form === "kdvp" ? "Doh_KDVP" : "Doh_Div"}_${String(taxYear)}.xml`;
}

/** Brokers the dashboard can show, in display order. */
export const BROKERS = ["trading212", "ibkr", "traderepublic"] as const;
export type BrokerId = (typeof BROKERS)[number];

/** ISO 8601 calendar date, e.g. "2026-03-12". */
export type IsoDate = string;

/** A plain decimal string, e.g. "1234.56" or "-0.5". */
export type DecimalString = string;

export interface Money {
  readonly amount: DecimalString;
  /** ISO 4217 code, e.g. "USD". */
  readonly currency: string;
}

/** Where a converted amount's exchange rate came from (ADR 0005). */
export interface RateProvenance {
  readonly currency: string;
  /** Units of `currency` per 1 EUR, exactly as Banka Slovenije published it. */
  readonly rate: DecimalString;
  /** The BSI list used: the event date, or the last list before it. */
  readonly listDate: IsoDate;
  readonly source: "bsi-daily" | "bsi-monthly" | "euro-changeover";
}

export interface SourceRef {
  /** The name the file was added under, unique within the session. */
  readonly file: string;
  /** 1-based row (CSV), or record within its section (XML), in that file. */
  readonly row: number;
  /**
   * The section the row is in, where a file numbers rows per section: an
   * IBKR statement's "Trades" or "CashTransactions" (the adapter's own
   * names, never file text).
   */
  readonly part?: string;
}

/** One row of a Doh-KDVP inventory list (popisni list). */
export interface KdvpRow {
  readonly kind: "purchase" | "sale";
  /** Trade (contract) date, never the settlement date. */
  readonly date: IsoDate;
  readonly quantity: DecimalString;
  /** Price per unit in the instrument's currency, split-adjusted. */
  readonly price: Money;
  /** null when the price is already in EUR. */
  readonly rate: RateProvenance | null;
  /** Price per unit in EUR at the form's 8-decimal scale. */
  readonly priceEur: DecimalString;
  readonly broker: BrokerId;
  readonly source: SourceRef;
  /** Set when a corporate action changed the quantity and price shown. */
  readonly splitAdjusted?: { readonly ratio: string; readonly date: IsoDate };
}

/**
 * Holding-period tax rate buckets in percent, shortest holding first: 25% under
 * 5 years, then 20%, 15%, and 0% after 15 years (ZDoh-2 Art. 96 and 132; see
 * docs/research/04-si-tax-rules.md).
 */
export const HOLDING_BUCKETS = ["25", "20", "15", "0"] as const;
export type HoldingBucket = (typeof HOLDING_BUCKETS)[number];

/** A sale matched against one purchase lot, FIFO per ISIN across brokers. */
export interface MatchedLot {
  readonly purchaseDate: IsoDate;
  readonly saleDate: IsoDate;
  readonly quantity: DecimalString;
  readonly acquisitionEur: DecimalString;
  readonly disposalEur: DecimalString;
  /** disposalEur minus acquisitionEur. */
  readonly gainEur: DecimalString;
  /** 1% of acquisition plus 1% of disposal, capped at the gain; 0 for a loss. */
  readonly normedCostsEur: DecimalString;
  readonly yearsHeld: number;
  readonly bucket: HoldingBucket;
}

export interface SecurityResult {
  readonly isin: string;
  readonly symbol: string;
  readonly name: string;
  /**
   * The importer recognized it as a fund (`IsFond` on Doh-KDVP). Only a fund
   * shows a fund house's wordmark: a company whose name starts with the same
   * word is not that fund house.
   */
  readonly isFund: boolean;
  readonly brokers: readonly BrokerId[];
  readonly rows: readonly KdvpRow[];
  readonly lots: readonly MatchedLot[];
  readonly quantitySold: DecimalString;
  readonly proceedsEur: DecimalString;
  readonly costEur: DecimalString;
  readonly gainEur: DecimalString;
}

export interface DividendRow {
  readonly date: IsoDate;
  readonly symbol: string;
  /** The security's name as the export gives it, "" when it gives none. */
  readonly name: string;
  /** The importer recognized the security as a fund, as on SecurityResult. */
  readonly isFund: boolean;
  readonly payer: string;
  readonly isin: string;
  /** ISO 3166-1 alpha-2 country the income comes from, not the payer's. */
  readonly country: string;
  readonly gross: Money;
  readonly foreignTax: Money;
  readonly rate: RateProvenance | null;
  readonly grossEur: DecimalString;
  readonly foreignTaxEur: DecimalString;
  /** Foreign tax that can be credited: capped by the treaty rate and by Slovenian tax. */
  readonly creditEur: DecimalString;
  /** Treaty rate cap as a decimal fraction ("0.15"), or null when nothing was withheld. */
  readonly treatyRate: DecimalString | null;
  readonly broker: BrokerId;
  readonly source: SourceRef;
}

export type DiagnosticSeverity = "blocking" | "warning" | "info";

/**
 * A finding's parameter as it crosses from the worker: a value already in
 * the shape core checked, a file by its position in the request (never its
 * name), or text copied from a file, which the page shows as text only.
 */
export type FindingParam =
  string | number | { readonly file: number } | { readonly untrusted: string };

/**
 * A finding for the user: the engine's code and parameters (core's
 * `DiagnosticParams`). The page words it in the user's language from one
 * catalog, i18n/findings.ts, so a change of language needs no new read.
 */
export interface Finding {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly params: Readonly<Record<string, FindingParam>>;
  /** Where in the user's files: the file's position in the request, and the row. */
  readonly source?: {
    readonly file: number;
    readonly row: number;
    readonly part?: string;
  };
}

export interface ImportedFile {
  readonly name: string;
  readonly broker: BrokerId;
  readonly firstDate: IsoDate;
  readonly lastDate: IsoDate;
  readonly rowsRead: number;
}

/** The estimate shown next to the inventory lists; eDavki computes the real tax. */
export interface GainsEstimate {
  /** Positive bases after normed costs, per bucket. */
  readonly positiveByBucket: Readonly<Record<HoldingBucket, DecimalString>>;
  /** Sum of the losses (negative), offset against gains of the same year. */
  readonly lossesEur: DecimalString;
  readonly netBaseEur: DecimalString;
  /** The net base split pro rata across buckets. */
  readonly allocatedByBucket: Readonly<Record<HoldingBucket, DecimalString>>;
  readonly taxEur: DecimalString;
}

export interface DividendsEstimate {
  /**
   * The Slovenian tax on dividends as a fraction, "0.25": a final tax under
   * ZDoh-2 Art. 132(1) (docs/research/04-si-tax-rules.md §2.2).
   */
  readonly taxRate: DecimalString;
  readonly grossEur: DecimalString;
  readonly foreignTaxEur: DecimalString;
  readonly creditEur: DecimalString;
  /** 25% Slovenian tax minus the creditable foreign tax, summed per payment. */
  readonly taxDueEur: DecimalString;
}

/** Totals over every matched lot, for the headline figures. */
export interface GainsTotals {
  readonly proceedsEur: DecimalString;
  readonly costEur: DecimalString;
  /** proceedsEur minus costEur, before normed costs. */
  readonly gainEur: DecimalString;
}

/** Gross dividends per calendar month of the tax year ("2026-03"). */
export interface MonthlyAmount {
  readonly month: string;
  readonly grossEur: DecimalString;
}

/**
 * An account as the dashboard names it: its broker and a number at that
 * broker, never an account number or the scope the engine keys it by (an
 * IBKR scope is a hash of a short account ID: ADR 0018 §5).
 */
export interface AccountRef {
  /** "ibkr-1": unique in the session, and nothing of the account in it. */
  readonly id: string;
  readonly broker: BrokerId;
  /** From 1 at that broker, the account with the earliest event first. */
  readonly ordinal: number;
  /** "account N" is said only where the broker has two accounts or more. */
  readonly showOrdinal: boolean;
}

/** The shares one account holds of one security, by its own count. */
export interface PositionRow {
  readonly isin: string;
  readonly symbol: string;
  readonly name: string;
  /** Whether it is a fund, for the mark beside it (a fund house's wordmark). */
  readonly isFund: boolean;
  /** Signed: negative where the files sell more than they buy. */
  readonly quantity: DecimalString;
}

export interface AccountSummary extends AccountRef {
  /** The last day its files cover; null for an account with no dated row. */
  readonly asOf: IsoDate | null;
  /** The names of the files that hold its rows. */
  readonly files: readonly string[];
  /** Its files move shares in or out, which are not read yet (#48). */
  readonly transferred: boolean;
  /** A row of its files was refused, so its positions may be missing it. */
  readonly refusedRows: boolean;
  /** Quantities only: a broker's own cost is not the FIFO cost. */
  readonly positions: readonly PositionRow[];
}

/** Why the Banka Slovenije snapshot has no rate for a purchase. */
export const MISSING_RATES = [
  "invalidDate",
  "metal",
  "unknownCurrency",
  "beforeSnapshot",
  "afterSnapshot",
  "noRate",
] as const;
export type MissingRate = (typeof MISSING_RATES)[number];

/** One open FIFO lot, whichever account bought it. */
export interface HeldLotRow {
  readonly account: AccountRef;
  readonly purchaseDate: IsoDate;
  /** In shares as of the security's `asOf`. */
  readonly quantity: DecimalString;
  /** Price per share as of `asOf`, in the instrument's currency. */
  readonly price: Money;
  /** A split since the purchase restated the quantity and the price. */
  readonly splitAdjusted: boolean;
  /** null where the price is in EUR, or where `missingRate` says why. */
  readonly rate: RateProvenance | null;
  readonly missingRate?: MissingRate;
  /** EUR per share at the form's 8 decimals; null without a rate. */
  readonly unitCostEur: DecimalString | null;
  /** The lot's cost in cents, at the rate of its purchase date. */
  readonly costEur: DecimalString | null;
  /** The holding bucket on the security's `asOf`. */
  readonly bucket: HoldingBucket;
  /**
   * The next, lower bucket and the first day it is certain, the day after
   * the anniversary (research 04 §4.5); null once exempt.
   */
  readonly next: {
    readonly bucket: HoldingBucket;
    readonly from: IsoDate;
  } | null;
  readonly source: SourceRef;
}

/** A security still held, across every account of the taxpayer. */
export interface HeldSecurity {
  readonly isin: string;
  readonly symbol: string;
  readonly name: string;
  /** Whether it is a fund, for the mark beside it (a fund house's wordmark). */
  readonly isFund: boolean;
  /** The day its lots are as of: the earliest among the accounts holding it. */
  readonly asOf: IsoDate;
  readonly quantity: DecimalString;
  /** The lots' costs together; null when any lot has none. */
  readonly costEur: DecimalString | null;
  /** The files sell more than they buy: an earlier export is missing. */
  readonly incomplete: boolean;
  /** The accounts the lots were bought in, in lot order. */
  readonly accounts: readonly AccountRef[];
  /** Oldest first: the order a sale consumes them. */
  readonly lots: readonly HeldLotRow[];
}

/** What the "still held" card says, summed in the worker (ADR 0006). */
export interface HoldingsTotals {
  readonly securities: number;
  readonly lots: number;
  /** The cost of the lots that have one; `withoutRate` lots are not in it. */
  readonly costEur: DecimalString;
  readonly withoutRate: number;
  /** The earliest and latest of the securities' as-of days; null if none. */
  readonly asOfFirst: IsoDate | null;
  readonly asOfLast: IsoDate | null;
}

/**
 * The shares still held (ADR 0018): each account's own positions, and the
 * open FIFO lots across accounts. Holdings never block a return, and are
 * null when they could not be worked out.
 */
export interface HoldingsPreview {
  readonly accounts: readonly AccountSummary[];
  readonly securities: readonly HeldSecurity[];
  readonly totals: HoldingsTotals;
}

export interface ReturnPreview {
  readonly taxYear: number;
  readonly files: readonly ImportedFile[];
  readonly securities: readonly SecurityResult[];
  readonly dividends: readonly DividendRow[];
  readonly findings: readonly Finding[];
  /** Findings left out of `findings`, the least severe first (engine/toPreview.ts). */
  readonly omittedFindings: number;
  /** The ticker of every security the files name, by ISIN, for the findings. */
  readonly symbols: Readonly<Record<string, string>>;
  readonly gainsTotals: GainsTotals;
  readonly gainsEstimate: GainsEstimate;
  readonly dividendsEstimate: DividendsEstimate;
  /**
   * The two estimates together, the dashboard's headline: the gains tax
   * plus the dividend tax still due, each as its card shows it, so the parts
   * on screen add up to it. An estimate like its parts; eDavki computes the
   * real tax.
   */
  readonly taxToPayEur: DecimalString;
  /** The shares still held; null when they could not be worked out. */
  readonly holdings: HoldingsPreview | null;
  /** All twelve months, zero where nothing was paid. */
  readonly dividendsByMonth: readonly MonthlyAmount[];
}
