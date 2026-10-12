/**
 * What an account looks like wherever it is shown (ADR 0018, #47): its day,
 * its files and the reasons its count may not match its broker's. The
 * account's own page adds its positions; the holdings page of a lone
 * account adds its name and a line to check it against the broker's app.
 */
import { InfoIcon } from "@phosphor-icons/react";

import { explain } from "../../explain/anchors";
import { formatDate, formatNumber } from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import type { AccountSummary } from "../../model/preview";
import { Button, Chip, DataTable, Note, SecurityMark } from "../../ui/kit";
import { accountName } from "./names";

/** Whether a position is below zero: its files sell more than they buy. */
export const isShort = (quantity: string) => quantity.startsWith("-");

/** The account's day, its files and whatever may make its count wrong. */
export function AccountFacts({
  account,
  onShowNotes,
}: {
  readonly account: AccountSummary;
  readonly onShowNotes: () => void;
}) {
  const { locale, t } = useI18n();
  return (
    <div className="account-facts">
      <div className="account-meta">
        <Chip
          size="md"
          tone={account.asOf === null ? "neutral" : "accent"}
          explain={explain("acct.asOf", account.id)}
        >
          {account.asOf === null
            ? t.acct.noDate
            : t.acct.asOf(formatDate(account.asOf, locale))}
        </Chip>
        <ul className="account-files" role="list" aria-label={t.acct.files}>
          {account.files.map((file) => (
            <li key={file}>
              <code className="code-badge">{file}</code>
            </li>
          ))}
        </ul>
      </div>
      {account.transferred ? (
        <Note
          tone="warn"
          explain={explain("acct.flag", `${account.id}:transferred`)}
        >
          {t.acct.transferred}
        </Note>
      ) : null}
      {account.refusedRows ? (
        <Note
          tone="warn"
          explain={explain("acct.flag", `${account.id}:refused`)}
          action={
            <Button variant="ghost" size="sm" onClick={onShowNotes}>
              {t.review.showNotes}
            </Button>
          }
        >
          {t.acct.refused}
        </Note>
      ) : null}
    </div>
  );
}

/** One account's own count of each security, quantities only. */
export function PositionsTable({
  account,
}: {
  readonly account: AccountSummary;
}) {
  const { locale, t } = useI18n();
  if (account.positions.length === 0) {
    return <p className="muted">{t.acct.none}</p>;
  }
  return (
    <DataTable caption={t.acct.positions(accountName(t, account))}>
      <thead>
        <tr>
          <th scope="col">{t.acct.colSecurity}</th>
          <th scope="col" className="end">
            {t.acct.colShares}
          </th>
        </tr>
      </thead>
      <tbody>
        {account.positions.map((position) => (
          <tr
            key={position.isin}
            {...explain("acct.position", `${account.id}:${position.isin}`)}
          >
            <th scope="row">
              <span className="security-id">
                <SecurityMark
                  isin={position.isin}
                  symbol={position.symbol}
                  name={position.name}
                  isFund={position.isFund}
                  labelled
                />
                <span className="security-names">
                  <span className="security-symbol">
                    {position.symbol === "" ? position.isin : position.symbol}
                  </span>
                  <span className="security-name">{position.name}</span>
                  {/* Under the name, not beside the count: on a phone the
                      count stays in view. */}
                  {isShort(position.quantity) ? (
                    <span className="position-flag">
                      <Chip tone="warn">{t.acct.short}</Chip>
                    </span>
                  ) : null}
                </span>
              </span>
            </th>
            <td className="end num">
              {formatNumber(position.quantity, locale, { maxFraction: 8 })}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/** The holdings page of a lone account: what it says, to check against the app. */
export function AccountStrip({
  account,
  onShowNotes,
}: {
  readonly account: AccountSummary;
  readonly onShowNotes: () => void;
}) {
  const { locale, t } = useI18n();
  const name = accountName(t, account);
  return (
    <section
      className="card account-strip"
      aria-label={name}
      {...explain("acct.card", account.id)}
    >
      <h2 className="account-strip-title">{name}</h2>
      <AccountFacts account={account} onShowNotes={onShowNotes} />
      {account.asOf === null ? null : (
        <p className="with-icon muted small">
          <InfoIcon size={16} weight="bold" aria-hidden />
          {t.held.loneAccount(name, formatDate(account.asOf, locale))}
        </p>
      )}
    </section>
  );
}

/** An account's own page: its facts, and its count of every security. */
export function AccountCard({
  account,
  onShowNotes,
}: {
  readonly account: AccountSummary;
  readonly onShowNotes: () => void;
}) {
  return (
    <section
      className="card account-card"
      aria-label={undefined}
      {...explain("acct.card", account.id)}
    >
      <AccountFacts account={account} onShowNotes={onShowNotes} />
      <PositionsTable account={account} />
    </section>
  );
}
