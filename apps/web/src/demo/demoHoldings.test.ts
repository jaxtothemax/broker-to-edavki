/**
 * The demo's holdings are written down, not computed in the page. They are
 * checked here two ways: against the engine run over the demo's own ledger
 * (so the demo shows what the app would work out), and by exact arithmetic
 * from the lots' own prices and rates, so a cost is not just the engine's
 * word for itself.
 */
import { fileIdOf, validateLedger, type AccountScope } from "@taxreporter/core";
import { buildHoldings } from "@taxreporter/pipeline";
import { describe, expect, it } from "vitest";

import { holdingsPreview } from "../engine/toPreview";
import { loadRates } from "../engine/rates";
import type { HeldLotRow, HoldingsPreview } from "../model/preview";
import { demoLedgerEvents } from "./demoLedger";
import { demoPreview } from "./demoPreview";

const demo = demoPreview.holdings;
if (demo === null) throw new Error("the demo has holdings");

/** The engine's holdings for the demo's ledger and files, as the page gets them. */
async function engineHoldings(): Promise<HoldingsPreview> {
  const ledger = validateLedger(demoLedgerEvents());
  expect(ledger.diagnostics).toEqual([]);
  const fileId = (name: string) => fileIdOf(new TextEncoder().encode(name));
  const scopes = new Map<string, AccountScope>();
  for (const event of ledger.events) scopes.set(event.broker, event.account);
  const reach = demoPreview.files.map((file) => {
    const account = scopes.get(file.broker);
    if (account === undefined) throw new Error(`no ${file.broker} events`);
    return { account, lastDate: file.lastDate, fileId: fileId(file.name) };
  });
  const names = demoPreview.files.map((file) => file.name);
  const byId = new Map(names.map((name, i) => [fileId(name), i] as const));
  const holdings = buildHoldings({ ledger, rates: await loadRates(), reach });
  const shown = holdingsPreview(holdings, { names, byId });
  if (shown === null) throw new Error("the engine's holdings are not shown");
  return shown;
}

/** A lot without the row it came from, which the demo numbers on its own. */
const withoutSource = (lot: HeldLotRow) => ({ ...lot, source: undefined });
const withoutSources = (holdings: HoldingsPreview) => ({
  ...holdings,
  securities: holdings.securities.map((s) => ({
    ...s,
    lots: s.lots.map(withoutSource),
  })),
});

// Exact rationals over BigInt, as demoPreview.test.ts does.
interface Q {
  readonly n: bigint;
  readonly d: bigint;
}
const q = (s: string): Q => {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (m === null) throw new Error(`bad decimal ${s}`);
  const frac = m[3] ?? "";
  const n = BigInt(`${m[2] ?? "0"}${frac}`) * (m[1] === "-" ? -1n : 1n);
  return { n, d: 10n ** BigInt(frac.length) };
};
const mul = (a: Q, b: Q): Q => ({ n: a.n * b.n, d: a.d * b.d });
const div = (a: Q, b: Q): Q => ({ n: a.n * b.d, d: a.d * b.n });
const add = (a: Q, b: Q): Q => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const sum = (xs: Q[]): Q => xs.reduce(add, q("0"));
/** Rounds half up (the values here are positive) to `scale` decimals. */
function round(x: Q, scale: number): string {
  const unit = 10n ** BigInt(scale);
  const num = x.n * unit;
  let r = num / x.d;
  if ((num % x.d) * 2n >= x.d) r += 1n;
  const digits = r.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}
/** The same value written with trailing zeros dropped, as quantities are. */
const plain = (value: string) =>
  value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

describe("the demo's holdings", () => {
  it("are what the engine works out from the demo's own ledger", async () => {
    expect(withoutSources(demo)).toEqual(
      withoutSources(await engineHoldings()),
    );
  });

  it("name the same source row as the gains page where a lot is also listed there", () => {
    for (const held of demo.securities) {
      const listed = demoPreview.securities.find((s) => s.isin === held.isin);
      for (const lot of held.lots) {
        const row = listed?.rows.find(
          (r) =>
            r.kind === "purchase" &&
            r.date === lot.purchaseDate &&
            r.broker === lot.account.broker,
        );
        expect(row, `${held.symbol} ${lot.purchaseDate}`).toBeDefined();
        expect(lot.source, `${held.symbol} ${lot.purchaseDate}`).toEqual(
          row?.source,
        );
      }
    }
  });

  it("cost each lot as the form costs a purchase: price at the rate of its date, to 8 decimals, times the shares, in cents", () => {
    for (const held of demo.securities) {
      for (const lot of held.lots) {
        const unit =
          lot.rate === null
            ? q(lot.price.amount)
            : div(q(lot.price.amount), q(lot.rate.rate));
        const unitEur = round(unit, 8);
        expect(plain(unitEur), `${held.symbol} unit ${lot.purchaseDate}`).toBe(
          lot.unitCostEur,
        );
        expect(
          round(mul(q(lot.quantity), q(unitEur)), 2),
          `${held.symbol} cost ${lot.purchaseDate}`,
        ).toBe(lot.costEur);
      }
    }
  });

  it("add up: a security's shares and cost, and the card's totals", () => {
    for (const held of demo.securities) {
      expect(plain(round(sum(held.lots.map((l) => q(l.quantity))), 8))).toBe(
        held.quantity,
      );
      expect(round(sum(held.lots.map((l) => q(l.costEur ?? "0"))), 2)).toBe(
        held.costEur,
      );
    }
    const lots = demo.securities.flatMap((s) => s.lots);
    expect(demo.totals.securities).toBe(demo.securities.length);
    expect(demo.totals.lots).toBe(lots.length);
    expect(round(sum(lots.map((l) => q(l.costEur ?? "0"))), 2)).toBe(
      demo.totals.costEur,
    );
    expect(demo.totals.withoutRate).toBe(
      lots.filter((l) => l.costEur === null).length,
    );
    expect(demo.totals.asOfFirst).toBe(
      [...demo.securities.map((s) => s.asOf)].sort()[0],
    );
  });

  it("show the two views differing where a security is held at two brokers and sold at one", () => {
    const positions = (isin: string) =>
      demo.accounts.map((a) => [
        a.id,
        a.positions.find((p) => p.isin === isin)?.quantity ?? null,
      ]);
    // NVIDIA: 20 by Trading 212's count, minus 10 by IBKR's; the lot left
    // is IBKR's 10, since the sale at IBKR used the Trading 212 lot first.
    expect(positions("US67066G1040")).toEqual([
      ["ibkr-1", "-10"],
      ["trading212-1", "20"],
    ]);
    const nvda = demo.securities.find((s) => s.isin === "US67066G1040");
    expect(nvda?.quantity).toBe("10");
    expect(nvda?.lots.map((l) => l.account.id)).toEqual(["ibkr-1"]);
    // One account each elsewhere: its count and the lots agree.
    for (const isin of ["US0378331005", "IE00BK5BQT80"]) {
      const lots = demo.securities.find((s) => s.isin === isin);
      const held = demo.accounts
        .flatMap((a) => a.positions)
        .filter((p) => p.isin === isin);
      expect(held.map((p) => p.quantity)).toEqual([lots?.quantity]);
    }
  });

  it("flag the account the transfer is in, and no other, and keep the as-of day of each", () => {
    expect(demo.accounts.map((a) => [a.id, a.transferred, a.asOf])).toEqual([
      ["ibkr-1", true, "2026-08-13"],
      ["trading212-1", false, "2026-06-18"],
    ]);
    // NVIDIA is held by both, so its lots are as of the earlier day.
    expect(demo.securities.find((s) => s.symbol === "NVDA")?.asOf).toBe(
      "2026-06-18",
    );
  });
});
