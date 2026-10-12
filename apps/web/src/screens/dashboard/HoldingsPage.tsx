/**
 * The shares still held (ADR 0018, #47): one disclosure per security, across
 * every account, holding its open first-in, first-out lots oldest first, the
 * order a sale consumes them. Each lot shows its cost at the Banka Slovenije
 * rate of its purchase date and the day its next, lower holding rate is
 * certain. Everything is "as of" the last day the files cover, never today,
 * and there are no market prices: the only network call the app makes is
 * the rate snapshot.
 *
 * The page does no arithmetic: every figure comes from the worker
 * (`toPreview`, ADR 0006).
 */
import { BankIcon, CaretDownIcon, InfoIcon } from "@phosphor-icons/react";

import { explain } from "../../explain/anchors";
import { formatDate, formatMoney, formatNumber } from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import type {
  AccountSummary,
  HeldLotRow,
  HeldSecurity,
  HoldingsPreview,
} from "../../model/preview";
import { bucketLabel, Eur, RateText, SourceText } from "../../ui/bits";
import { Button, Chip, DataTable, Note, SecurityMark } from "../../ui/kit";
import { AccountStrip } from "./AccountParts";
import { accountName, lotKey } from "./names";

/** A security's name on the screen: its ticker, or its ISIN without one. */
const labelOf = (security: HeldSecurity) =>
  security.symbol === "" ? security.isin : security.symbol;

/** The day the next, lower rate is certain, or why there is none. */
function NextRate({ lot }: { readonly lot: HeldLotRow }) {
  const { locale, t } = useI18n();
  if (lot.next === null) {
    return (
      <span className="muted small">
        {lot.bucket === "0"
          ? t.held.nextZero(bucketLabel(lot.bucket, locale))
          : t.held.nextNone}
      </span>
    );
  }
  return (
    <span className="num nowrap" {...explain("held.next")}>
      {t.held.nextFrom(
        bucketLabel(lot.next.bucket, locale),
        formatDate(lot.next.from, locale),
      )}
    </span>
  );
}

function HeldLots({ security }: { readonly security: HeldSecurity }) {
  const { locale, t } = useI18n();
  const asOf = formatDate(security.asOf, locale);
  return (
    <DataTable
      caption={t.held.lotsTitle(labelOf(security))}
      explain={explain("held.lots")}
    >
      <thead>
        <tr>
          <th scope="col">{t.held.colBought}</th>
          <th scope="col">{t.held.colAccount}</th>
          <th scope="col" className="end">
            {t.held.colShares}
          </th>
          <th scope="col" className="end">
            {t.held.colPrice}
          </th>
          <th scope="col">{t.held.colRate}</th>
          <th scope="col" className="end">
            {t.held.colCost}
          </th>
          <th scope="col">{t.held.colRateOn(asOf)}</th>
          <th scope="col">{t.held.colNext}</th>
          <th scope="col">{t.held.colSource}</th>
        </tr>
      </thead>
      <tbody>
        {security.lots.map((lot) => (
          <tr key={lotKey(lot)} {...explain("held.lot", lotKey(lot))}>
            <th scope="row" className="num nowrap">
              {formatDate(lot.purchaseDate, locale)}
            </th>
            <td>
              <span {...explain("held.account")}>
                <Chip>{accountName(t, lot.account)}</Chip>
              </span>
            </td>
            <td className="end num">
              {formatNumber(lot.quantity, locale, { maxFraction: 8 })}
            </td>
            <td className="end">
              <span className="stack-tight">
                <span className="num nowrap">
                  {formatMoney(lot.price.amount, lot.price.currency, locale)}
                </span>
                {lot.splitAdjusted ? (
                  <span className="muted small">{t.held.splitAdjusted}</span>
                ) : null}
              </span>
            </td>
            <td>
              {lot.missingRate === undefined ? (
                <RateText rate={lot.rate} />
              ) : (
                <span className="stack-tight">
                  <span>{t.held.noRate}</span>
                  <span className="muted small">
                    {t.held.missingRate(lot.missingRate, lot.price.currency)}
                  </span>
                </span>
              )}
            </td>
            <td className="end">
              {lot.costEur === null ? (
                <span className="muted small">{t.held.noRate}</span>
              ) : (
                <Eur value={lot.costEur} />
              )}
            </td>
            <td>
              <Chip>{bucketLabel(lot.bucket, locale)}</Chip>
            </td>
            <td>
              <NextRate lot={lot} />
            </td>
            <td>
              <SourceText source={lot.source} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function HeldItem({
  security,
  open,
  showAccounts,
  onToggle,
}: {
  readonly security: HeldSecurity;
  readonly open: boolean;
  /** Whether to name the accounts: not where there is only one. */
  readonly showAccounts: boolean;
  readonly onToggle: (isin: string, open: boolean) => void;
}) {
  const { locale, t } = useI18n();
  const hint = `held-hint-${security.isin}`;
  return (
    <details
      className="security"
      {...explain("held.item", security.isin)}
      open={open}
      // The element's own state, read when the event runs: toggle events are
      // queued, so one can arrive after the view it answered has changed.
      onToggle={(event) => {
        onToggle(security.isin, event.currentTarget.open);
      }}
    >
      <summary aria-describedby={hint} {...explain("held.summary")}>
        <span id={hint} className="visually-hidden" aria-hidden>
          {t.held.showLots(labelOf(security))}
        </span>
        <span className="security-id">
          <SecurityMark
            isin={security.isin}
            symbol={security.symbol}
            name={security.name}
            isFund={security.isFund}
          />
          <span className="security-names">
            <span className="security-symbol">{labelOf(security)}</span>
            <span className="security-name">{security.name}</span>
          </span>
        </span>
        <span className="security-brokers">
          {showAccounts
            ? security.accounts.map((account) => (
                <Chip key={account.id}>{accountName(t, account)}</Chip>
              ))
            : null}
          {security.incomplete ? (
            <Chip tone="warn">{t.held.incomplete}</Chip>
          ) : null}
        </span>
        <span className="security-figures">
          <span className="fig">
            <span className="fig-label">{t.held.statShares}</span>
            <span className="num">
              {formatNumber(security.quantity, locale, { maxFraction: 8 })}
            </span>
          </span>
          <span className="fig">
            <span className="fig-label">{t.held.statCost}</span>
            {security.costEur === null ? (
              <span className="muted small">{t.held.noRate}</span>
            ) : (
              <Eur value={security.costEur} />
            )}
          </span>
          <span className="fig">
            <span className="fig-label">{t.held.statLots}</span>
            <span className="num">
              {formatNumber(String(security.lots.length), locale)}
            </span>
          </span>
          <span className="fig">
            <span className="fig-label">{t.held.statAsOf}</span>
            <span className="num nowrap" {...explain("held.asOf")}>
              {formatDate(security.asOf, locale)}
            </span>
          </span>
        </span>
        <CaretDownIcon
          size={18}
          weight="bold"
          aria-hidden
          className="security-caret"
        />
      </summary>
      <div className="security-body">
        {security.incomplete ? (
          <Note tone="warn">
            {t.held.incompleteBody(
              labelOf(security),
              formatDate(security.asOf, locale),
            )}
          </Note>
        ) : null}
        <HeldLots security={security} />
      </div>
    </details>
  );
}

/**
 * The accounts, as buttons to their pages: at the top of the holdings page
 * where the sidebar has no room for them (a tablet's rail, a phone's bar).
 * The sidebar's Accounts group takes their place on a desktop, so the
 * stylesheet shows one or the other; both are buttons, neither a second
 * navigation.
 */
function AccountLinks({
  accounts,
  onOpen,
}: {
  readonly accounts: readonly AccountSummary[];
  readonly onOpen: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <section className="card held-accounts" aria-labelledby="held-accounts">
      <h2 id="held-accounts" className="sub-title">
        {t.held.accountsLabel}
      </h2>
      <ul className="held-account-list" role="list">
        {accounts.map((account) => (
          <li key={account.id}>
            <Button
              variant="ghost"
              onClick={() => {
                onOpen(account.id);
              }}
            >
              <BankIcon size={18} weight="bold" aria-hidden />
              <span>{accountName(t, account)}</span>
              <span className="muted small">
                {account.asOf === null
                  ? t.acct.noDate
                  : t.acct.asOf(formatDate(account.asOf, locale))}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HoldingsPage({
  holdings,
  open,
  onToggle,
  onOpenAccount,
  onShowNotes,
}: {
  readonly holdings: HoldingsPreview | null;
  /** The held securities opened, by ISIN. */
  readonly open: ReadonlySet<string>;
  readonly onToggle: (isin: string, open: boolean) => void;
  readonly onOpenAccount: (id: string) => void;
  readonly onShowNotes: () => void;
}) {
  const { t } = useI18n();
  if (holdings === null) {
    return <Note tone="neutral">{t.held.failed}</Note>;
  }
  const several = holdings.accounts.length > 1;
  const lone = holdings.accounts.length === 1 ? holdings.accounts[0] : null;
  return (
    <>
      <ul className="fine-print" role="list">
        <li className="with-icon muted small">
          <InfoIcon size={16} weight="bold" aria-hidden />
          {t.held.noPrices}
        </li>
        <li className="with-icon muted small">
          <InfoIcon size={16} weight="bold" aria-hidden />
          {t.held.history}
        </li>
        {several ? (
          <li className="with-icon muted small">
            <InfoIcon size={16} weight="bold" aria-hidden />
            {t.held.whyDiffer}
          </li>
        ) : null}
      </ul>
      {several ? (
        <AccountLinks accounts={holdings.accounts} onOpen={onOpenAccount} />
      ) : null}
      {lone === null || lone === undefined ? null : (
        <AccountStrip account={lone} onShowNotes={onShowNotes} />
      )}
      {holdings.securities.length === 0 ? (
        <div className="card empty-card">
          <h2>{t.held.emptyTitle}</h2>
          <p className="muted">{t.held.emptyBody}</p>
        </div>
      ) : (
        <>
          <div className="security-list">
            {holdings.securities.map((security) => (
              <HeldItem
                key={security.isin}
                security={security}
                open={open.has(security.isin)}
                showAccounts={several}
                onToggle={onToggle}
              />
            ))}
          </div>
          <p className="with-icon muted small">
            <InfoIcon size={16} weight="bold" aria-hidden />
            {t.held.nextNote}
          </p>
        </>
      )}
    </>
  );
}
