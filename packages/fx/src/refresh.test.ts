import { describe, expect, it } from "vitest";

import { ecbDifferences, historyChanges, parseEcbHistory } from "./refresh.js";

const DAILY_OLD = [
  "date,CYP,NOK,USD",
  "2025-10-22,,11.6000,1.1600",
  "2025-10-23,,11.8529,1.1610",
  "2025-10-24,,11.6100,1.1620",
  "",
].join("\n");

const MONTHLY_OLD = [
  "valid_from,date,TWD",
  "2025-10-01,2025-09-30,35.5",
  "2025-11-01,2025-10-31,35.7",
  "",
].join("\n");

describe("a refreshed snapshot's history", () => {
  it("may add lists after the old snapshot's last day", () => {
    const added = `${DAILY_OLD}2025-10-27,,11.6200,1.1630\n`;
    expect(historyChanges("daily", DAILY_OLD, added, "2025-10-24")).toEqual([]);
  });

  it("may write a rate with other trailing zeros, which is the same rate", () => {
    const zeros = DAILY_OLD.replace("1.1600", "1.16");
    expect(historyChanges("daily", DAILY_OLD, zeros, "2025-10-24")).toEqual([]);
  });

  it("reports a rate it changes on or before that day", () => {
    const changed = DAILY_OLD.replace("11.8529", "11.5829");
    expect(historyChanges("daily", DAILY_OLD, changed, "2025-10-24")).toEqual([
      {
        list: "daily",
        key: "2025-10-23",
        currency: "NOK",
        before: "11.8529",
        after: "11.5829",
      },
    ]);
  });

  it("reports a list or a rate it drops", () => {
    const dropped = DAILY_OLD.replace("2025-10-24,,11.6100,1.1620\n", "");
    expect(
      historyChanges("daily", DAILY_OLD, dropped, "2025-10-24").map(
        (c) => `${c.key} ${c.currency} ${String(c.after)}`,
      ),
    ).toEqual(["2025-10-24 NOK null", "2025-10-24 USD null"]);
    const noUsd = "date,CYP,NOK\n2025-10-22,,11.6000\n";
    expect(
      historyChanges("daily", DAILY_OLD, noUsd, "2025-10-22").map(
        (c) => c.currency,
      ),
    ).toEqual(["USD"]);
  });

  it("ignores a change after the old snapshot's last day", () => {
    const changed = DAILY_OLD.replace("11.6100", "11.7000");
    expect(historyChanges("daily", DAILY_OLD, changed, "2025-10-23")).toEqual(
      [],
    );
  });

  it("checks the monthly list by the month it is valid from", () => {
    const changed = MONTHLY_OLD.replace("35.5", "35.6");
    expect(
      historyChanges("monthly", MONTHLY_OLD, changed, "2025-10-31").map(
        (c) => `${c.key} ${c.currency}`,
      ),
    ).toEqual(["2025-10-01 TWD"]);
  });
});

describe("the ECB cross-check", () => {
  const ecb = [
    "Date,USD,NOK,JPY,",
    "2025-10-24,1.162,11.61,N/A,",
    "2025-10-23,1.1610,11.5829,N/A,",
    "2025-10-22,1.1600,11.6000,175.1,",
    "",
  ].join("\n");

  it("passes where BSI copies the ECB, and on a known difference", () => {
    // NOK on 2025-10-23 is the known one (research 03 §8).
    expect(ecbDifferences(DAILY_OLD, ecb)).toEqual([]);
  });

  it("reports a difference that is not known", () => {
    expect(ecbDifferences(DAILY_OLD, ecb, [])).toEqual([
      { date: "2025-10-23", currency: "NOK", bsi: "11.8529", ecb: "11.5829" },
    ]);
    const off = DAILY_OLD.replace("1.1620", "1.1700");
    expect(ecbDifferences(off, ecb)).toEqual([
      { date: "2025-10-24", currency: "USD", bsi: "1.1700", ecb: "1.162" },
    ]);
  });

  it("compares only a day and a currency both publish", () => {
    const extra = `${DAILY_OLD}2025-10-27,,11.6200,1.1630\n`;
    expect(ecbDifferences(extra, ecb)).toEqual([]);
  });

  it("reads the history by its header, with N/A as no rate", () => {
    const parsed = parseEcbHistory(ecb);
    expect(parsed.get("2025-10-24")?.get("USD")).toBe("1.162");
    expect(parsed.get("2025-10-24")?.has("JPY")).toBe(false);
  });

  it("refuses a file that is not an ECB history", () => {
    expect(() => parseEcbHistory("date,USD\n2025-10-24,1.1\n")).toThrow(
      /Not an ECB/,
    );
    expect(() => parseEcbHistory("Date,USD\n2025-10-24,1,1\n")).not.toThrow();
    expect(() => parseEcbHistory("Date,USD\n2025-10-24,abc\n")).toThrow(
      /Bad rate/,
    );
    expect(() => parseEcbHistory("Date,USD\n24.10.2025,1.1\n")).toThrow(
      /Bad date/,
    );
  });
});
