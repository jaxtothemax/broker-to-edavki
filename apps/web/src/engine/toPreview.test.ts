/**
 * The mapper's own rules, on small inputs: how many findings a reply
 * carries, and what of a file's text the screen may show.
 */
import {
  Decimal,
  validateLedger,
  type AccountScope,
  type DividendEvent,
  type EventKey,
  type FileId,
  type LedgerEvent,
  type TradeEvent,
} from "@taxreporter/core";
import { buildReturns, type ReadExports } from "@taxreporter/pipeline";
import { describe, expect, it } from "vitest";

import type { Finding } from "../model/preview";
import { loadRates } from "./rates";
import {
  bounded,
  fileIndex,
  MAX_FINDINGS,
  payerPrompts,
  summarize,
  symbolsOf,
  taxToPay,
  toPreview,
} from "./toPreview";

const finding = (severity: Finding["severity"], row: number): Finding => ({
  severity,
  code: "duplicateKeyInFile",
  params: {},
  source: { file: 0, row },
});

describe("bounded", () => {
  it("sends every finding of an ordinary session", () => {
    const few = [finding("info", 1), finding("blocking", 2)];
    expect(bounded(few)).toEqual({ findings: few, omitted: 0 });
  });

  it("keeps the blocking ones first when a file raises too many", () => {
    // One repeated row, a hundred thousand times over, and two real problems.
    const flood = Array.from({ length: 100_000 }, (_, i) => finding("info", i));
    const all = [
      ...flood.slice(0, 50_000),
      finding("blocking", -1),
      ...flood.slice(50_000),
      finding("warning", -2),
    ];
    const { findings, omitted } = bounded(all);
    expect(findings).toHaveLength(MAX_FINDINGS);
    expect(omitted).toBe(all.length - MAX_FINDINGS);
    // Both kept, in the order they came, among the first notes.
    expect(findings.filter((f) => f.severity !== "info")).toEqual([
      finding("blocking", -1),
      finding("warning", -2),
    ]);
    expect(findings[0]).toEqual(finding("info", 0));
  });
});

const dividend = (
  isin: string,
  symbol: string,
  name: string,
): DividendEvent => ({
  kind: "dividend",
  key: "0".repeat(32) as EventKey,
  broker: "trading212",
  account: "trading212:1" as AccountScope,
  source: { fileId: "0123456789abcdef" as FileId, row: 2 },
  at: { instant: null, brokerDate: "2026-04-01" },
  date: "2026-04-01",
  security: { isin, symbol, name },
  gross: { amount: Decimal.parse("1"), currency: "USD" },
});

describe("symbolsOf and payerPrompts", () => {
  const events: LedgerEvent[] = [
    dividend("US1912161007", "KO\u202e", "Coca\u200b-Cola\u2028Company"),
    dividend("US0378331005", "MSFT (US5949181045)", "Apple"),
  ];

  it("show a ticker cleaned, and none that could pass for something else", () => {
    expect(symbolsOf(events)).toEqual({ US1912161007: "KO" });
  });

  it("preset payers with names cleaned of what displays as something else", () => {
    expect(
      payerPrompts(events, 2026).map((p) => [p.isin, p.symbol, p.name]),
    ).toEqual([
      // By ticker, or by ISIN where there is none to show.
      ["US1912161007", "KO", "Coca -Cola Company"],
      ["US0378331005", "", "Apple"],
    ]);
  });

  it("name the broker that paid, or none when several did", () => {
    const paid = (broker: string) => ({
      ...dividend("US1912161007", "KO", "Coca-Cola"),
      broker,
    });
    const brokers = (...names: string[]) =>
      payerPrompts(names.map(paid), 2026).map((p) => p.broker);
    expect(brokers("trading212", "trading212")).toEqual(["trading212"]);
    // A mix is named by no broker, whichever order it comes in.
    expect(brokers("trading212", "ibkr")).toEqual([""]);
    expect(brokers("ibkr", "trading212", "trading212")).toEqual([""]);
  });
});

describe("taxToPay", () => {
  it("adds the cents each card shows, never rounds the sum again", () => {
    // Each half cent rounds up on its card: 0.01 + 0.01. Rounding the
    // exact sum, 0.01, would show a headline the parts do not add up to.
    expect(taxToPay(Decimal.parse("0.005"), Decimal.parse("0.005"))).toBe(
      "0.02",
    );
    expect(taxToPay(Decimal.parse("1770.044"), Decimal.parse("21.334"))).toBe(
      "1791.37",
    );
  });
});

describe("toPreview, an eToro lot", () => {
  it("names eToro, and shows a price with no finite expansion rounded", async () => {
    // A position still open is bought at its amount over its units, 200 /
    // 1.1, kept exact by the adapter (ADR 0020 §5); a later sale takes it.
    const fileId = "0123456789abcdef" as FileId;
    const account = "etoro:1" as AccountScope;
    const security = { isin: "US0378331005", symbol: "AAPL" };
    const buy: TradeEvent = {
      kind: "trade",
      key: "1".repeat(32) as EventKey,
      broker: "etoro",
      account,
      source: { fileId, row: 3, part: "accountActivity" },
      at: { instant: "2024-01-08T15:00:00Z", brokerDate: "2024-01-08" },
      side: "buy",
      date: "2024-01-08",
      security,
      quantity: Decimal.parse("1.1"),
      price: {
        amount: Decimal.parse("200").dividedBy(Decimal.parse("1.1")),
        currency: "USD",
      },
    };
    const sale: TradeEvent = {
      ...buy,
      key: "2".repeat(32) as EventKey,
      source: { fileId, row: 2, part: "closedPositions" },
      at: { instant: "2024-02-20T15:00:00Z", brokerDate: "2024-02-20" },
      side: "sell",
      date: "2024-02-20",
      price: { amount: Decimal.parse("190"), currency: "USD" },
    };
    const read: ReadExports = {
      imports: [
        {
          file: "etoro.xlsx",
          fileId,
          result: {
            broker: "etoro",
            format: "etoro-xlsx-2025.2.15",
            events: [buy, sale],
            diagnostics: [],
            reach: [{ account, lastDate: "2024-02-20" }],
            wholeHistory: true,
          },
        },
      ],
      repeats: [],
      clashes: [],
      notRead: [],
      ledger: validateLedger([buy, sale]),
    };
    const prepared = buildReturns(read, {
      taxYear: 2024,
      taxpayer: { taxNumber: "12345678" },
      rates: await loadRates(),
      payers: new Map(),
    });
    const index = fileIndex(read, ["etoro.xlsx"]);
    const files = summarize(read, index, prepared.scope.view);
    expect(files.map((f) => [f.status, f.broker, f.unnamedAccount])).toEqual([
      ["read", "etoro", true],
    ]);
    const preview = toPreview(prepared, 2024, new Map(), index, files);
    const purchase = preview.securities[0]?.rows.find(
      (row) => row.kind === "purchase",
    );
    expect(purchase?.price).toEqual({
      amount: "181.81818182",
      currency: "USD",
    });
    expect(purchase?.broker).toBe("etoro");
  });
});
