/**
 * The results dashboard (#47) rendered on its own, inside the provider the
 * app gives it: its navigation, its states, and the returns on its
 * overview, each checked with edge-case data.
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { demoPreview } from "../../demo/demoPreview";
import type { BuiltReturns } from "../../engine/demoReturns";
import type { Locale } from "../../i18n/format";
import { I18nProvider } from "../../i18n/i18n";
import { en } from "../../i18n/messages";
import type { ReturnPreview } from "../../model/preview";
import { DashboardShell } from "./DashboardShell";
import { FormRow, ReturnsCard } from "./ReturnsCard";
import { initialDashboardView, type DashPage } from "./view";
import { filingDeadline, type Writing } from "./writing";

function render(node: ReactNode, locale: Locale = "en"): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
  );
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const returns: BuiltReturns = {
  kdvp: {
    fileName: "Doh_KDVP_2026.xml",
    xml: "<x/>",
    blocking: 0,
    needed: true,
  },
  div: {
    fileName: "Doh_Div_2026.xml",
    xml: "<y/>",
    blocking: 0,
    needed: true,
  },
};
const ready = (built: BuiltReturns = returns): Writing => ({
  status: "ready",
  returns: built,
});

const card = (preview: ReturnPreview, writing: Writing, demo = false): string =>
  text(
    render(
      <ReturnsCard
        preview={preview}
        writing={writing}
        demo={demo}
        onShowNotes={() => undefined}
      />,
    ),
  );

const shell = (
  overrides: Partial<Parameters<typeof DashboardShell>[0]> = {},
  page: DashPage = "overview",
): string =>
  render(
    <DashboardShell
      preview={demoPreview}
      status="ready"
      fileNames={[]}
      forms={null}
      returns={returns}
      demo={false}
      view={{ ...initialDashboardView, page }}
      onViewChange={() => undefined}
      onBack={() => undefined}
      onRestart={() => undefined}
      onStartDemo={() => undefined}
      {...overrides}
    />,
  );

describe("ReturnsCard", () => {
  it("offers no row for a form with nothing in it", () => {
    const html = card(
      { ...demoPreview, dividends: [] },
      ready({ ...returns, div: { ...returns.div, needed: false } }),
    );
    expect(html).toContain("Download Doh-KDVP");
    expect(html).not.toContain("Download Doh-Div");
  });

  it("says there is nothing to file when the year needs neither form", () => {
    const html = card(
      { ...demoPreview, securities: [], dividends: [] },
      ready({
        kdvp: { ...returns.kdvp, xml: null, needed: false },
        div: { ...returns.div, xml: null, needed: false },
      }),
    );
    expect(html).toContain(en.download.nothingToFile);
    expect(html).not.toContain("Download Doh");
  });

  it("warns never to import the demo's files", () => {
    expect(card(demoPreview, ready(), true)).toContain(
      "These files hold the demo's made-up trades",
    );
  });

  it("names a withheld return that has no row to show (ADR 0013 §9)", () => {
    // A sale whose purchase is in an export not added: Doh-KDVP is needed
    // but withheld before it has a list; Doh-Div is ready.
    const withheld = card(
      { ...demoPreview, securities: [] },
      ready({ ...returns, kdvp: { ...returns.kdvp, xml: null, blocking: 2 } }),
    );
    expect(withheld).toContain("Download Doh-KDVP");
    expect(withheld).toContain(en.download.kdvpNone);
    expect(withheld).toContain(
      "Not written: 2 problems in the notes must be fixed first.",
    );
    expect(withheld).toContain("Download Doh-Div");
    const noPayments = card(
      { ...demoPreview, dividends: [] },
      ready({ ...returns, div: { ...returns.div, xml: null, blocking: 1 } }),
    );
    expect(noPayments).toContain(en.download.divNone);
  });

  it("asks the user to check their own returns, and gives no demo warning", () => {
    const own = card(demoPreview, ready());
    expect(own).toContain(en.download.ownFiles.split(";")[0] ?? "");
    expect(own).not.toContain("made-up trades");
    expect(own).toContain(en.download.readyChip);
  });

  it("keeps every download disabled while the files are written, and says so", () => {
    const html = render(
      <ReturnsCard
        preview={demoPreview}
        writing={{ status: "preparing" }}
        demo
        onShowNotes={() => undefined}
      />,
    );
    expect(html.match(/aria-describedby="download-status"/g)).toHaveLength(2);
    expect(text(html)).toContain(en.download.preparing);
  });

  it("says when the files could not be written", () => {
    expect(card(demoPreview, { status: "failed" })).toContain(
      en.download.failed.split(";")[0] ?? "",
    );
  });
});

describe("FormRow", () => {
  const row = (built: Parameters<typeof FormRow>[0]["built"]) =>
    render(
      <ul>
        <FormRow
          id="kdvp"
          form="Doh-KDVP"
          body="4 lists"
          fileName="Doh_KDVP_2026.xml"
          built={built}
          onShowNotes={() => undefined}
        />
      </ul>,
    );

  it("offers a written return for saving", () => {
    const html = row(returns.kdvp);
    expect(html).toMatch(/<button[^>]*>[^]*?Download Doh-KDVP/);
    expect(html).not.toContain("aria-disabled");
    expect(text(html)).toContain(en.download.readyChip);
    expect(text(html)).not.toContain(en.review.showNotes);
  });

  it("says why a return was not written, beside its disabled button and a way to the notes", () => {
    const html = row({ ...returns.kdvp, xml: null, blocking: 2 });
    expect(html).toContain('aria-describedby="kdvp-not-written"');
    expect(text(html)).toContain(
      "Not written: 2 problems in the notes must be fixed first.",
    );
    expect(text(html)).toContain(en.review.showNotes);
  });
});

describe("filingDeadline", () => {
  it("moves 28 February to the next working day", () => {
    expect(filingDeadline(2026)).toBe("2027-03-01"); // Sunday → Monday
    expect(filingDeadline(2025)).toBe("2026-03-02"); // Saturday → Monday
    expect(filingDeadline(2027)).toBe("2028-02-28"); // Monday stays
  });
});

describe("DashboardShell", () => {
  it("has one navigation, its current page marked, and one h1", () => {
    const html = shell({}, "gains");
    expect(html.match(/<nav /g)).toHaveLength(1);
    expect(html).toContain(`aria-label="${en.dash.navLabel}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>[^]*?Gains/);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text(html)).toContain(en.dash.gainsLead);
  });

  it("reads each page's count out after its name", () => {
    const html = text(shell());
    expect(html).toContain(", 4 securities sold");
    expect(html).toContain(", 9 payments");
  });

  it("leads the overview with the tax to pay, and both returns it comes from", () => {
    const html = text(shell());
    expect(html).toContain(en.dash.taxToPay("2026"));
    expect(html).toContain("€1,791.37");
    expect(html).toContain(`${en.dash.onGains} €1,770.04`);
    expect(html).toContain(`${en.dash.onDividends} €21.33`);
    expect(html).toContain(en.dash.downloadAll);
  });

  it("shows the current page's own rows, and hides the other three", () => {
    // What marks each page, and on no other page.
    const own: Record<DashPage, string> = {
      overview: 'id="returns-title"',
      gains: en.review.estimateTitle,
      dividends: en.review.dividendsCaption,
      notes: en.review.severity.warning,
    };
    for (const page of ["overview", "gains", "dividends", "notes"] as const) {
      const html = shell({}, page);
      expect(html.match(/class="dash-page" hidden=""/g), page).toHaveLength(3);
      // The one page not hidden, up to the next page's container.
      const shown = html
        .split('<div class="dash-page"')
        .slice(1)
        .find((part) => part.startsWith(">"));
      for (const [other, marker] of Object.entries(own)) {
        expect(shown?.includes(marker), `${page}: ${other}`).toBe(
          other === page,
        );
      }
    }
  });

  it("says a note stops both returns, and never hides the dashboard", () => {
    const html = text(
      shell({
        preview: {
          ...demoPreview,
          findings: [
            { severity: "blocking", code: "unknownEvent", params: {} },
          ],
        },
        forms: {
          kdvp: { xml: null, blocking: 1, needed: true },
          div: { xml: null, blocking: 1, needed: true },
        },
        // As the engine writes them then: both needed, neither written.
        returns: {
          kdvp: { ...returns.kdvp, xml: null, blocking: 1 },
          div: { ...returns.div, xml: null, blocking: 1 },
        },
      }),
    );
    expect(html).toContain(en.review.blocked);
    expect(html).toContain(en.dash.taxToPay("2026"));
    // Both rows stay, each saying it is not written; nothing to download.
    expect(
      html.split("Not written: 1 problem in the notes must be fixed first."),
    ).toHaveLength(3);
    expect(html).not.toContain(en.download.nothingToFile);
    expect(html).not.toContain(en.dash.downloadAll);
  });

  it("goes on with one return while a note stops only the other", () => {
    const html = text(
      shell({
        preview: {
          ...demoPreview,
          findings: [
            {
              severity: "blocking",
              code: "payerUnknown",
              params: { isin: "US1912161007" },
            },
          ],
        },
        forms: {
          kdvp: { xml: "<x/>", blocking: 0, needed: true },
          div: { xml: null, blocking: 1, needed: true },
        },
      }),
    );
    expect(html).toContain(en.review.blockedOne("Doh-Div"));
  });

  it("says the results are being prepared, then that they failed, with the navigation waiting", () => {
    const at = (status: "preparing" | "failed") =>
      shell({ preview: null, status, returns: null });
    expect(text(at("preparing"))).toContain(en.review.preparing);
    expect(text(at("failed"))).toContain(en.review.prepareFailed);
    for (const html of [at("preparing"), at("failed")]) {
      expect(html).toContain('aria-describedby="dash-status"');
      expect(html).not.toContain(en.dash.downloadAll);
      // Back to details stays reachable: the failure says to go there.
      expect(text(html)).toContain(en.dash.backToDetails);
    }
  });

  it("offers the demo where there is nothing to show, never a blank page", () => {
    const html = text(shell({ preview: null, returns: null }));
    expect(html).toContain(en.review.emptyTitle);
    expect(html).not.toContain(en.dash.downloadAll);
  });

  it("keeps the demo's tour on the page header, once", () => {
    const html = shell({ demo: true, onTour: () => undefined });
    expect(html.match(/id="demo-tour"/g)).toHaveLength(1);
    expect(text(html)).toContain(en.demoBanner.title);
  });

  it("keeps Back to details and Start over within reach on a phone, in every state", () => {
    // The sidebar's actions are hidden on a phone; the row after the page
    // takes their place, whatever the dashboard shows.
    for (const html of [
      shell(),
      shell({}, "notes"),
      shell({ preview: null, status: "preparing", returns: null }),
      shell({ preview: null, status: "failed", returns: null }),
      shell({ preview: null, returns: null }),
    ]) {
      expect(html).toMatch(/class="actions-row phone-actions"/);
      expect(text(html).split(en.dash.backToDetails)).toHaveLength(3);
    }
  });

  it("names the year while there is nothing yet to take it from", () => {
    const html = text(
      shell({ preview: null, status: "preparing", returns: null }),
    );
    expect(html).toContain(en.dash.eyebrowEstimate("2026"));
  });

  it("describes the waiting navigation by text that is there", () => {
    for (const html of [
      shell({ preview: null, status: "preparing", returns: null }),
      shell({ preview: null, returns: null }),
    ]) {
      expect(html).toContain('aria-describedby="dash-status"');
      expect(html).toContain('id="dash-status"');
    }
  });

  it("says when own results are ready, and nothing of the kind in the demo", () => {
    expect(text(shell())).toContain(en.dash.resultsReady);
    expect(text(shell({ demo: true }))).not.toContain(en.dash.resultsReady);
  });

  it("says only that the one return is withheld when the year needs no other", () => {
    const html = text(
      shell({
        preview: {
          ...demoPreview,
          dividends: [],
          findings: [
            { severity: "blocking", code: "unknownEvent", params: {} },
          ],
        },
        forms: {
          kdvp: { xml: null, blocking: 1, needed: true },
          div: { xml: null, blocking: 0, needed: false },
        },
        returns: {
          ...returns,
          kdvp: { ...returns.kdvp, xml: null, blocking: 1 },
          div: { ...returns.div, xml: null, needed: false },
        },
      }),
    );
    expect(html).toContain(en.review.blockedOnly("Doh-KDVP"));
    expect(html).not.toContain("The other return");
    // A headline that counts a withheld return says so beside it...
    expect(html).toContain(en.dash.partWithheld("Doh-KDVP"));
    // ...and no button leads to downloads there are none of.
    expect(html).not.toContain(en.dash.downloadAll);
  });

  it("says in words, not only in color, that notes ask for attention", () => {
    const html = render(
      <DashboardShell
        preview={{
          ...demoPreview,
          findings: [
            { severity: "blocking", code: "unknownEvent", params: {} },
          ],
          omittedFindings: 0,
        }}
        status="ready"
        fileNames={[]}
        forms={null}
        returns={returns}
        demo={false}
        view={initialDashboardView}
        onViewChange={() => undefined}
        onBack={() => undefined}
        onRestart={() => undefined}
        onStartDemo={() => undefined}
      />,
    );
    expect(html).toMatch(/class="nav-item is-danger"/);
    expect(text(html)).toContain(", 1 note, 1 needs your attention");
  });
});
