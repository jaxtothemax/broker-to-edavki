/**
 * What the dashboard shows: its page and the securities opened on it. Held
 * by the app frame, not the dashboard, so the guided tour can show a page or
 * a row of its own and leave the user's choice untouched underneath (ADR
 * 0016). Nothing here is stored: leaving the dashboard resets it.
 */

/** The dashboard's pages, in the order the navigation lists them. */
export const DASH_PAGES = ["overview", "gains", "dividends", "notes"] as const;
export type DashPage = (typeof DASH_PAGES)[number];

export interface DashboardView {
  readonly page: DashPage;
  /** The sold securities opened on the gains page, by ISIN. */
  readonly sold: ReadonlySet<string>;
}

/** The dashboard as it opens: the overview, every security closed. */
export const initialDashboardView: DashboardView = Object.freeze({
  page: "overview",
  sold: new Set<string>(),
});
