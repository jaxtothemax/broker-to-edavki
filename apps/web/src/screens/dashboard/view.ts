/**
 * What the dashboard shows: its page and the securities opened on it. Held
 * by the app frame, not the dashboard, so the guided tour can show a page or
 * a row of its own and leave the user's choice untouched underneath (ADR
 * 0016). Nothing here is stored: leaving the dashboard resets it.
 */

/**
 * The pages every dashboard has, in the order the navigation lists them. A
 * page for each broker account comes besides them (`account`), only where
 * there are two accounts or more: with one, the holdings page says all.
 */
export const DASH_PAGES = [
  "overview",
  "gains",
  "dividends",
  "holdings",
  "notes",
] as const;
export type DashPage = (typeof DASH_PAGES)[number] | "account";

export interface DashboardView {
  readonly page: DashPage;
  /** The account on show, by `AccountRef.id`, when `page` is "account". */
  readonly account: string | null;
  /** The sold securities opened on the gains page, by ISIN. */
  readonly sold: ReadonlySet<string>;
  /** The held securities opened on the holdings page, by ISIN. */
  readonly held: ReadonlySet<string>;
}

/** The dashboard as it opens: the overview, every security closed. */
export const initialDashboardView: DashboardView = Object.freeze({
  page: "overview",
  account: null,
  sold: new Set<string>(),
  held: new Set<string>(),
});
