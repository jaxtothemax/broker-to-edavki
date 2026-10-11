/**
 * The dashboard's panels rendered on their own, inside the provider the app gives
 * them, so each can be checked with edge-case data.
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { demoPreview } from "../../demo/demoPreview";
import type { Locale } from "../../i18n/format";
import { I18nProvider } from "../../i18n/i18n";
import { en, sl } from "../../i18n/messages";
import { RateText, SourceText } from "../../ui/bits";
import { DividendsPanel } from "./DividendsPanel";
import { GainsPanel } from "./GainsPanel";
import { NotesPanel } from "./NotesPanel";

function render(node: ReactNode, locale: Locale = "en"): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
  );
}

function failMissing(): never {
  throw new Error("the demo has no dividends");
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

describe("GainsPanel", () => {
  const html = render(
    <GainsPanel
      securities={demoPreview.securities}
      estimate={demoPreview.gainsEstimate}
      open={new Set()}
      onToggle={() => undefined}
    />,
    "sl",
  );

  it("shows every inventory-list row with its rate provenance and source", () => {
    expect(html.match(/<details/g)).toHaveLength(demoPreview.securities.length);
    expect(text(html)).toContain("1 EUR = 1,1188 USD");
    expect(text(html)).toContain("tečajnica BS z dne 14. 8. 2019");
    expect(text(html)).toContain("ibkr-flex-2019-2026.xml, vrstica 14");
  });

  it("shows BSI rates with the digits BSI published", () => {
    // NVDA's sale used 1.1900, which must not shrink to "1,19".
    expect(text(html)).toContain("1 EUR = 1,1900 USD");
  });

  it("opens exactly the securities its view names", () => {
    const [first, second] = demoPreview.securities;
    if (first === undefined || second === undefined) {
      throw new Error("the demo sells fewer than two securities");
    }
    const opened = render(
      <GainsPanel
        securities={demoPreview.securities}
        estimate={demoPreview.gainsEstimate}
        open={new Set([second.isin])}
        onToggle={() => undefined}
      />,
    );
    expect(
      opened.match(/<details class="security"[^>]* open=""/g),
    ).toHaveLength(1);
    expect(html).not.toMatch(/<details class="security"[^>]* open=""/);
  });

  it("says which rows a split adjusted", () => {
    expect(text(html)).toContain(
      "Prilagojeno za delitev 4:1 z dne 31. 8. 2020",
    );
  });

  it("shows a loss as negative and explains the estimate step by step", () => {
    expect(text(html)).toContain("−427,50 €");
    expect(text(html)).toContain(sl.review.netBase);
    expect(text(html)).toContain("1770,04 €");
  });
});

describe("DividendsPanel", () => {
  const html = render(
    <DividendsPanel
      dividends={demoPreview.dividends}
      totals={demoPreview.dividendsEstimate}
    />,
  );

  it("lists one row per payment plus a total", () => {
    expect(html.match(/<tr/g)).toHaveLength(demoPreview.dividends.length + 2);
    expect(text(html)).toContain("€182.59");
  });

  it("lists payments in date order", () => {
    const dates = [
      ...html.matchAll(/<th[^>]*class="[^"]*num nowrap[^"]*"[^>]*>([^<]+)</g),
    ].map((m) => m[1] ?? "");
    expect(dates[0]).toBe("15 Jan 2026");
    expect(dates.at(-1)).toBe("13 Aug 2026");
    expect(dates).toHaveLength(demoPreview.dividends.length);
  });

  it("flags the credit capped at the treaty rate", () => {
    expect(text(html)).toContain("Credit capped at the treaty rate of 15%");
    expect(text(html)).toContain("Germany");
  });

  it("shows the holiday fallback list for the 1 May payment", () => {
    expect(text(html)).toContain("BSI list of 30 Apr 2026");
  });

  describe("the security column", () => {
    // A broker that holds the shares is the payer on the form; the company
    // whose dividend it was must still be readable.
    const row = {
      ...(demoPreview.dividends[0] ?? failMissing()),
      symbol: "TSTA",
      name: "Examplecorp Holdings Ltd",
      isin: "US0000000002",
      payer: "TRADING 212",
      broker: "trading212" as const,
    };
    const panel = (dividends: typeof demoPreview.dividends, locale?: Locale) =>
      render(
        <DividendsPanel
          dividends={dividends}
          totals={demoPreview.dividendsEstimate}
        />,
        locale,
      );

    it("names the company and its ticker apart from the payer", () => {
      const html = panel([row]);
      expect(text(html)).toContain("Security");
      expect(text(html)).toContain("Payer");
      expect(html).toContain(
        '<span class="security-symbol">TSTA</span><span class="security-name">Examplecorp Holdings Ltd</span>',
      );
      expect(html).toContain('<span class="strong">TRADING 212</span>');
      expect(html).toContain('class="ticker"');
    });

    it("does not repeat the broker when the broker is the payer", () => {
      expect(text(panel([row]))).not.toContain("Trading 212 ");
      const other = text(panel([{ ...row, payer: "Examplecorp Holdings" }]));
      expect(other).toContain("Examplecorp Holdings Trading 212");
    });

    it("falls back to the name, then the ISIN, when the export has no ticker", () => {
      const noTicker = panel([{ ...row, symbol: "" }]);
      expect(noTicker).toContain(
        '<span class="security-symbol">Examplecorp Holdings Ltd</span></span>',
      );
      const bare = panel([{ ...row, symbol: "", name: "" }]);
      expect(bare).toContain('<span class="security-symbol">US0000000002<');
    });

    it("shows a fund house's wordmark on every fund it issues", () => {
      const fund = panel([
        { ...row, name: "Vanguard Test World (Acc)", symbol: "TSTB" },
      ]);
      expect(fund).toContain("logo-wordmark");
      expect(fund).not.toContain('class="ticker"');
    });

    it("keeps the total row under the first four columns", () => {
      expect(panel([row])).toContain('<th scope="row" colSpan="4">');
    });

    it("is worded in Slovenian too", () => {
      expect(text(panel([row], "sl"))).toContain(sl.review.colSecurity);
    });
  });
});

describe("NotesPanel", () => {
  const notes = (findings = demoPreview.findings, locale: Locale = "en") =>
    text(
      render(
        <NotesPanel
          findings={findings}
          symbols={demoPreview.symbols}
          fileNames={["trading212-2026.csv", "ibkr.xml"]}
        />,
        locale,
      ),
    );

  it("groups notes by severity and confirms nothing blocks the download", () => {
    const html = notes();
    expect(html).toContain(en.review.noneBlocking);
    expect(html).toContain(en.review.severity.warning);
    expect(html).toContain(en.review.severity.info);
    expect(html).not.toContain(en.review.severity.blocking);
  });

  it("puts a blocking note first and drops the all-clear", () => {
    const html = notes([
      {
        severity: "blocking",
        code: "payerUnknown",
        params: { isin: "US1912161007" },
      },
      ...demoPreview.findings,
    ]);
    expect(html).not.toContain(en.review.noneBlocking);
    expect(html.indexOf(en.review.severity.blocking)).toBeLessThan(
      html.indexOf(en.review.severity.warning),
    );
  });

  it("writes every demo note as a full sentence in both languages", () => {
    for (const locale of ["en", "sl"] as const) {
      const html = notes(demoPreview.findings, locale);
      expect(html).not.toMatch(/undefined|NaN|\{|\}/);
    }
    expect(notes(demoPreview.findings, "sl")).toContain("Nemčija");
    expect(notes()).toContain("ALV (DE0008404005), 8 May 2026:");
  });

  it("names the file and row a note comes from", () => {
    const html = notes([
      {
        severity: "blocking",
        code: "duplicateKeyInFile",
        params: {},
        source: { file: 1, row: 42 },
      },
    ]);
    expect(html).toContain("ibkr.xml, row 42");
  });
});

describe("empty and edge states", () => {
  it("says there is nothing to file instead of showing empty tables", () => {
    const gains = text(
      render(
        <GainsPanel
          securities={[]}
          estimate={demoPreview.gainsEstimate}
          open={new Set()}
          onToggle={() => undefined}
        />,
      ),
    );
    expect(gains).toContain(en.review.noSales);
    const dividends = text(
      render(
        <DividendsPanel
          dividends={[]}
          totals={demoPreview.dividendsEstimate}
        />,
      ),
    );
    expect(dividends).toContain(en.review.noDividends);
  });

  it("never groups the digits of a source row number", () => {
    const html = text(
      render(<SourceText source={{ file: "a.csv", row: 1234 }} />),
    );
    expect(html).toContain("a.csv, row 1234");
  });

  it("reminds that foreign tax needs proof, only where tax was withheld", () => {
    const withTax = text(
      render(
        <DividendsPanel
          dividends={demoPreview.dividends}
          totals={demoPreview.dividendsEstimate}
        />,
      ),
    );
    const proof = en.review.foreignTaxProof.split("'")[0] ?? "";
    expect(withTax).toContain(proof);
    const none = text(
      render(
        <DividendsPanel
          dividends={demoPreview.dividends.map((d) => ({
            ...d,
            foreignTaxEur: "0.00",
          }))}
          totals={demoPreview.dividendsEstimate}
        />,
      ),
    );
    expect(none).not.toContain(proof);
  });
});

describe("RateText", () => {
  it("names a legacy currency's fixed euro rate, not a list of a day", () => {
    const html = text(
      render(
        <RateText
          rate={{
            currency: "SIT",
            rate: "239.64",
            listDate: "2006-12-29",
            source: "euro-changeover",
          }}
        />,
      ),
    );
    expect(html).toContain(en.review.rateFixed);
    expect(html).not.toContain("BSI list of");
  });
});

describe("RateText and SourceText", () => {
  it("names the monthly list a currency the daily list lacks is converted at", () => {
    const html = text(
      render(
        <RateText
          rate={{
            currency: "TWD",
            rate: "35.12",
            listDate: "2026-02-01",
            source: "bsi-monthly",
          }}
        />,
      ),
    );
    expect(html).toContain("BSI monthly list of February 2026");
    expect(html).not.toContain("BSI list of");
  });

  it("says which section of a statement a row is in", () => {
    const html = text(
      render(
        <SourceText source={{ file: "ibkr.xml", row: 3, part: "Trades" }} />,
      ),
    );
    expect(html).toContain("ibkr.xml, Trades, row 3");
  });
});

describe("GainsPanel without a ticker", () => {
  it("names a security by its ISIN where the export gave no ticker to show", () => {
    const [first] = demoPreview.securities;
    if (first === undefined) throw new Error("the demo sells nothing");
    const html = text(
      render(
        <GainsPanel
          securities={[{ ...first, symbol: "" }]}
          estimate={demoPreview.gainsEstimate}
          open={new Set()}
          onToggle={() => undefined}
        />,
      ),
    );
    expect(html).toContain(`${first.isin}: ${en.review.rowsTitle}`);
    expect(html).toContain(`${first.isin}: ${en.review.lotsTitle}`);
    // No caption left with an empty name before its colon.
    expect(html).not.toContain(` : ${en.review.rowsTitle}`);
  });
});

describe("NotesPanel with many notes", () => {
  it("shows the first of each severity and says how many more there are", () => {
    const many = Array.from({ length: 130 }, () => ({
      severity: "info" as const,
      code: "fundFromName" as const,
      params: { isin: "IE00BK5BQT80" },
    }));
    const html = text(
      render(
        <NotesPanel findings={many} omitted={7} symbols={{}} fileNames={[]} />,
      ),
    );
    expect(html.match(/marked as a fund/g)).toHaveLength(100);
    expect(html).toContain("30 more notes are not shown.");
    expect(html).toContain("7 more notes are not shown.");
  });
});
