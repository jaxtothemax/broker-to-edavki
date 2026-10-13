/**
 * The checks a refreshed rate snapshot must pass before it can replace the
 * committed one (ADR 0005, "Daily refresh in CI"). Both are tax-rule
 * events, so a finding stops the refresh and nothing is proposed until a
 * person has looked:
 *
 * - **History.** A rate already in the snapshot converts amounts in returns
 *   people may already have filed. Banka Slovenije does not revise its
 *   lists, so a list that changes or disappears is either a fault in the
 *   download or a correction that needs a primary source in
 *   docs/research/ (CLAUDE.md, "Tax correctness").
 * - **ECB.** BSI's daily list republishes the ECB reference rates; only six
 *   days since 2007 differ, and they are written down (KNOWN_DISCREPANCIES,
 *   research 03 §8). A new difference is either a BSI error the user must
 *   be told about or a fault in the download, and the law names BSI's value
 *   either way, so a person decides which.
 *
 * Values are compared as decimals, never floats: BSI writes "0.578200"
 * where the ECB writes "0.5782", and that is the same rate.
 */
import { Decimal } from "@taxreporter/core";

import { KNOWN_DISCREPANCIES } from "./rates.js";
import { parseSnapshotCsv, type SnapshotTable } from "./snapshot.js";

/** A rate already in the snapshot that the refresh would change or drop. */
export interface HistoryChange {
  readonly list: "daily" | "monthly";
  /** The row's date (daily) or `valid_from` (monthly). */
  readonly key: string;
  readonly currency: string;
  readonly before: string;
  /** null where the refreshed snapshot no longer has it. */
  readonly after: string | null;
}

/** A day on which BSI's daily rate differs from the ECB's, not yet known. */
export interface EcbDifference {
  readonly date: string;
  readonly currency: string;
  readonly bsi: string;
  readonly ecb: string;
}

/** The largest ECB history file accepted (the 2026 one is about 1.5 MB). */
const MAX_ECB_LENGTH = 16 * 1024 * 1024;
const ECB_RATE = /^\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every cell of a snapshot table, by row key and currency. */
function cells(table: SnapshotTable): Map<string, Map<string, string>> {
  const byKey = new Map<string, Map<string, string>>();
  for (const row of table.rows) {
    const values = new Map<string, string>();
    table.codes.forEach((code, i) => {
      const rate = row.rates[i];
      if (rate !== undefined) values.set(code, rate);
    });
    byKey.set(row.key, values);
  }
  return byKey;
}

const same = (a: string, b: string) =>
  Decimal.parse(a).equals(Decimal.parse(b));

/**
 * The rates dated on or before `through` (the old snapshot's
 * `completeThrough`) that the refreshed snapshot changes or drops. Rows
 * after `through` are new and free to appear.
 */
export function historyChanges(
  list: "daily" | "monthly",
  oldCsv: string,
  newCsv: string,
  through: string,
): HistoryChange[] {
  const before = cells(parseSnapshotCsv(oldCsv, list));
  const after = cells(parseSnapshotCsv(newCsv, list));
  const changes: HistoryChange[] = [];
  for (const [key, rates] of before) {
    if (key > through) continue;
    const now = after.get(key);
    for (const [currency, rate] of rates) {
      const value = now?.get(currency);
      if (value === undefined) {
        changes.push({ list, key, currency, before: rate, after: null });
      } else if (!same(rate, value)) {
        changes.push({ list, key, currency, before: rate, after: value });
      }
    }
  }
  return changes;
}

/**
 * The ECB's reference-rate history (`eurofxref-hist.csv`): a header of
 * `Date` and currency codes, one row per day, "N/A" where a currency had no
 * rate. Read by its header, never by column position.
 */
export function parseEcbHistory(
  text: string,
): Map<string, Map<string, string>> {
  if (text.length > MAX_ECB_LENGTH) {
    throw new Error("ECB history larger than expected");
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = (lines[0] ?? "").split(",").map((cell) => cell.trim());
  if (header[0] !== "Date") throw new Error("Not an ECB rate history");
  const byDate = new Map<string, Map<string, string>>();
  for (const line of lines.slice(1)) {
    const row = line.split(",").map((cell) => cell.trim());
    const date = row[0] ?? "";
    if (!ISO_DATE.test(date)) throw new Error("Bad date in ECB history");
    const rates = new Map<string, string>();
    header.forEach((code, i) => {
      const value = row[i];
      if (i === 0 || code === "" || value === undefined) return;
      if (value === "" || value === "N/A") return;
      if (!ECB_RATE.test(value)) throw new Error("Bad rate in ECB history");
      rates.set(code, value);
    });
    byDate.set(date, rates);
  }
  return byDate;
}

/**
 * The days on which BSI's daily rate differs from the ECB's, other than the
 * ones already known. Only a day and currency both publish is compared.
 */
export function ecbDifferences(
  dailyCsv: string,
  ecbCsv: string,
  known: readonly {
    readonly date: string;
    readonly currency: string;
  }[] = KNOWN_DISCREPANCIES,
): EcbDifference[] {
  const bsi = cells(parseSnapshotCsv(dailyCsv, "daily"));
  const ecb = parseEcbHistory(ecbCsv);
  const differences: EcbDifference[] = [];
  for (const [date, rates] of bsi) {
    const reference = ecb.get(date);
    if (reference === undefined) continue;
    for (const [currency, rate] of rates) {
      const theirs = reference.get(currency);
      if (theirs === undefined || same(rate, theirs)) continue;
      if (known.some((k) => k.date === date && k.currency === currency)) {
        continue;
      }
      differences.push({ date, currency, bsi: rate, ecb: theirs });
    }
  }
  return differences;
}
