/**
 * What the dashboard calls an account and a page: shared by the navigation,
 * the page headers, the tab title and the tour, so each says the same.
 */
import type { Messages } from "../../i18n/messages";
import type {
  AccountRef,
  HeldLotRow,
  ReturnPreview,
} from "../../model/preview";
import type { DashboardView } from "./view";

/** "Interactive Brokers", or "Interactive Brokers · account 2" where a broker has two. */
export function accountName(t: Messages, account: AccountRef): string {
  const broker = t.brokers[account.broker];
  return account.showOrdinal
    ? t.acct.label(broker, String(account.ordinal))
    : broker;
}

/** The short mark beside an account, as a ticker tile has. */
export const BROKER_MARK: Readonly<Record<AccountRef["broker"], string>> = {
  trading212: "T212",
  ibkr: "IBKR",
  traderepublic: "TR",
};

/**
 * The account a view shows, if its page is an account's and the preview has
 * it. An account that is gone (the files changed) is no page.
 */
export function shownAccount(
  preview: ReturnPreview | null,
  view: DashboardView,
) {
  if (view.page !== "account") return undefined;
  return preview?.holdings?.accounts.find((a) => a.id === view.account);
}

/** The name of the page a view shows: the tab title and the page's heading. */
export function pageTitle(
  t: Messages,
  preview: ReturnPreview | null,
  view: DashboardView,
): string {
  if (view.page !== "account") return t.dash[view.page];
  const account = shownAccount(preview, view);
  return account === undefined ? t.dash.overview : accountName(t, account);
}

/** A lot's key for its anchor: its source row, which no other lot shares. */
export const lotKey = (lot: HeldLotRow) =>
  lot.source.part === undefined
    ? `${lot.source.file}:${String(lot.source.row)}`
    : `${lot.source.file}:${lot.source.part}:${String(lot.source.row)}`;
