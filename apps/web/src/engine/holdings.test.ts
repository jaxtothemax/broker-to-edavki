/**
 * The shares still held, as the worker hands them to the page (ADR 0018): a
 * view beside the returns that never fails a reply, and names accounts by
 * broker and number, never by anything of the account.
 */
import { accountGroup, accountScope, Decimal } from "@taxreporter/core";
import type { Holdings } from "@taxreporter/pipeline";
import { describe, expect, it } from "vitest";

import { engineReplies } from "../testing/ownFiles";
import { isHoldings, isReply } from "./protocol";
import { holdingsPreview } from "./toPreview";

const { prepared } = await engineReplies();
const holdings = prepared.preview.holdings;
if (holdings === null) throw new Error("the fixtures have holdings");

/** An engine's holdings with the one thing a test changes. */
function engines(
  label: { key: string; broker: string; ordinal: number },
  extra: Partial<Holdings["accounts"][number]> = {},
): Holdings {
  return {
    accounts: [
      {
        label,
        asOf: "2026-09-30",
        files: [],
        transferred: false,
        refusedRows: false,
        positions: [],
        ...extra,
      },
    ],
    securities: [],
  };
}
const index = { names: [], byId: new Map() };

describe("the holdings of a real reply", () => {
  it("name each account by its broker and a number, saying the number where a broker has two", () => {
    // Two Trading 212 files of one account, and an IBKR statement of two.
    expect(holdings.accounts.map((a) => [a.id, a.showOrdinal])).toEqual([
      ["ibkr-1", true],
      ["ibkr-2", true],
      ["trading212-1", false],
    ]);
    expect(holdings.accounts.map((a) => a.files)).toEqual([
      ["ibkr.xml"],
      ["ibkr.xml"],
      ["t212-2025.csv", "t212-2026.csv"],
    ]);
  });

  it("belong to the reply, and the reply is taken with them or without", () => {
    expect(isReply(prepared)).toBe(true);
    expect(
      isReply({
        ...prepared,
        preview: { ...prepared.preview, holdings: null },
      }),
    ).toBe(true);
  });

  it("leave no account scope, hash or ID anywhere in the reply", () => {
    const text = JSON.stringify(prepared);
    // The scopes of the fixtures' accounts, and the IDs they come from.
    const ids = ["U16000001", "U16000002"];
    const hashed = ids.map((id) => accountScope("ibkr", id));
    for (const scope of [...hashed, accountGroup("trading212", 1)]) {
      expect(text).not.toContain(scope);
    }
    // Nor an IBKR hash alone, which an account number's few values give away.
    for (const scope of hashed) {
      const hash = scope.slice(scope.indexOf(":") + 1);
      expect(hash.length).toBeGreaterThan(8);
      expect(text).not.toContain(hash);
    }
    for (const id of ids) expect(text).not.toContain(id);
  });

  it("add up: every lot is in a security's accounts, and the totals follow from the lots", () => {
    const known = new Set(holdings.accounts.map((a) => a.id));
    const lots = holdings.securities.flatMap((s) => s.lots);
    for (const security of holdings.securities) {
      const ofLots = new Set(security.lots.map((l) => l.account.id));
      expect(new Set(security.accounts.map((a) => a.id))).toEqual(ofLots);
      for (const id of ofLots) expect(known.has(id)).toBe(true);
    }
    expect(holdings.totals.securities).toBe(holdings.securities.length);
    expect(holdings.totals.lots).toBe(lots.length);
    expect(holdings.totals.costEur).toBe(
      Decimal.sum(
        lots.flatMap((l) =>
          l.costEur === null ? [] : [Decimal.parse(l.costEur)],
        ),
      ).toFixed(2, "halfUp"),
    );
    expect(holdings.totals.withoutRate).toBe(
      lots.filter((l) => l.costEur === null).length,
    );
  });
});

describe("holdingsPreview", () => {
  it("is null when the engine had none", () => {
    expect(holdingsPreview(null, index)).toBeNull();
  });

  it("shows an account the page can name, saying nothing of its scope", () => {
    const shown = holdingsPreview(
      engines({ key: "ibkr-1", broker: "ibkr", ordinal: 1 }),
      index,
    );
    expect(shown?.accounts.map((a) => [a.id, a.showOrdinal, a.asOf])).toEqual([
      ["ibkr-1", false, "2026-09-30"],
    ]);
    expect(shown?.totals).toEqual({
      securities: 0,
      lots: 0,
      costEur: "0.00",
      withoutRate: 0,
      asOfFirst: null,
      asOfLast: null,
    });
  });

  it("is null, not a failed reply, for an account at a broker the page cannot name", () => {
    // The engine labels an account it cannot place "unknown".
    expect(
      holdingsPreview(
        engines({ key: "unknown-1", broker: "unknown", ordinal: 1 }),
        index,
      ),
    ).toBeNull();
  });

  it("is null for a shape the page would refuse, and for a file outside the request", () => {
    // A label with no number: the page's own check refuses it.
    expect(
      holdingsPreview(
        engines({ key: "ibkr-0", broker: "ibkr", ordinal: 0 }),
        index,
      ),
    ).toBeNull();
    const file = "0123456789abcdef" as never;
    expect(
      holdingsPreview(
        engines(
          { key: "ibkr-1", broker: "ibkr", ordinal: 1 },
          { files: [file] },
        ),
        index,
      ),
    ).toBeNull();
  });
});

describe("the page's check of holdings", () => {
  const good = holdings;
  const first = good.securities[0];
  const lot = first?.lots[0];
  if (first === undefined || lot === undefined) {
    throw new Error("the fixtures hold a security with a lot");
  }
  const broken: [string, unknown][] = [
    [
      "an account named by a scope",
      {
        ...good,
        accounts: [{ ...good.accounts[0], id: "ibkr:0123456789abcdef" }],
      },
    ],
    [
      "an account id that is not its broker and number",
      { ...good, accounts: [{ ...good.accounts[0], id: "ibkr-9" }] },
    ],
    [
      "a broker the page cannot name",
      { ...good, accounts: [{ ...good.accounts[0], broker: "etoro" }] },
    ],
    [
      "a position that is not a decimal",
      {
        ...good,
        accounts: [
          {
            ...good.accounts[2],
            positions: [{ ...good.accounts[2]?.positions[0], quantity: "1e3" }],
          },
        ],
      },
    ],
    [
      "a lot with a missing rate the snapshot gives no reason for",
      {
        ...good,
        securities: [{ ...first, lots: [{ ...lot, missingRate: "because" }] }],
      },
    ],
    [
      "a lot in a bucket that is none",
      { ...good, securities: [{ ...first, lots: [{ ...lot, bucket: "9" }] }] },
    ],
    [
      "a next bucket with no day",
      {
        ...good,
        securities: [
          {
            ...first,
            lots: [{ ...lot, next: { bucket: "20", from: "2026-02-30" } }],
          },
        ],
      },
    ],
    [
      "totals that are not counts",
      { ...good, totals: { ...good.totals, lots: -1 } },
    ],
  ];

  it("takes the engine's own, and none with a field broken", () => {
    expect(isHoldings(good)).toBe(true);
    for (const [what, bad] of broken) {
      expect(isHoldings(bad), what).toBe(false);
    }
  });

  it("refuses the whole reply that carries a broken one", () => {
    for (const [what, bad] of broken) {
      expect(
        isReply({
          ...prepared,
          preview: { ...prepared.preview, holdings: bad },
        }),
        what,
      ).toBe(false);
    }
  });
});
