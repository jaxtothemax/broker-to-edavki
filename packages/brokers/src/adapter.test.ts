/**
 * The CSV family's choice of adapter (ADR 0004, ADR 0019): each header an
 * adapter knows matches that adapter alone, and only with the delimiter it
 * is written with.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CSV_ADAPTERS, type CsvAdapter } from "./adapter.js";
import type { CsvDelimiter } from "./csv.js";
import {
  TRADE_REPUBLIC_COLUMNS,
  TRADE_REPUBLIC_VALUE_DATE_COLUMNS,
  tradeRepublic,
} from "./trade-republic.js";
import { trading212, trading212Cfd } from "./trading212.js";

/** A fixture's header line, split on its delimiter. */
function headerOf(path: string, delimiter: CsvDelimiter): string[] {
  const text = readFileSync(
    new URL(`../test/fixtures/${path}`, import.meta.url),
    "utf8",
  );
  return (text.split("\n")[0] ?? "")
    .split(delimiter)
    .map((name) => name.replaceAll('"', "").trim());
}

/** A header, the delimiter it is written with, and the adapter reading it. */
type Known = readonly [string, readonly string[], CsvDelimiter, CsvAdapter];

/** Every header known. */
const KNOWN: readonly Known[] = [
  ...[
    "t212-invest-v1-2022.csv",
    "t212-invest-v2-2024.csv",
    "t212-invest-v3-2025.csv",
    "t212-invest-v4-2026.csv",
  ].map((file): Known => [
    file,
    headerOf(`trading212/${file}`, ","),
    ",",
    trading212,
  ]),
  [
    "trading212 CFD",
    ["RecordType", "Time", "Ticker", "Quantity"],
    ",",
    trading212Cfd,
  ],
  ["traderepublic comma", TRADE_REPUBLIC_COLUMNS, ",", tradeRepublic],
  [
    "traderepublic semicolon",
    TRADE_REPUBLIC_VALUE_DATE_COLUMNS,
    ";",
    tradeRepublic,
  ],
];

describe("CSV_ADAPTERS", () => {
  it("lists every adapter this test knows headers for", () => {
    // A new CSV adapter adds its headers to KNOWN, so the checks below
    // cover it.
    expect(new Set(KNOWN.map(([, , , adapter]) => adapter))).toEqual(
      new Set(CSV_ADAPTERS),
    );
  });

  it("match each known header with one adapter, and with its own delimiter only", () => {
    for (const [name, header, delimiter, adapter] of KNOWN) {
      const other: CsvDelimiter = delimiter === "," ? ";" : ",";
      expect(
        CSV_ADAPTERS.filter((a) => a.matches(header, delimiter)),
        name,
      ).toEqual([adapter]);
      expect(
        CSV_ADAPTERS.filter((a) => a.matches(header, other)),
        `${name} with ${other}`,
      ).toEqual([]);
    }
  });
});
