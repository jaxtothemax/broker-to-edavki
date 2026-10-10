# 19. Trade Republic: the export revisions and row types real files show

**Date:** 2026-10-10
**Status:** Proposed

> **Implementation status (2026-10-10):** the decision is still Proposed, but its
> implementation lands with it in the pull request for #55: `packages/brokers/src/csv.ts`
> (`CsvTable.delimiter`), `packages/brokers/src/adapter.ts` (`CsvAdapter.matches`),
> `packages/brokers/src/trade-republic.ts`, `packages/brokers/src/trading212.ts` (tied to the
> comma), and in `packages/core` two ignored reasons, two findings and the reason record of
> `validate.ts`. Accepting it changes no code.
>
> **Supersedes in part [ADR 0015](0015-trade-republic-transaction-export.md):** decision 1
> (one exact header), decision 2 (every row dated by its instant), decision 4 (only `DEFAULT`
> known), decision 5 (the cash rows read) and decision 7 (keys with the instant). The rest of
> 0015 stands.

## Context

ADR 0015 built the Trade Republic adapter from one header that research 07 had at medium
confidence, with no real export read. Portfolio Performance's importer is tested on six
exports that look real, pinned at
[`96f6040`](https://github.com/portfolio-performance/portfolio/tree/96f6040818d5b5e8aeaca63e60e7e6857b4befa2/name.abuchen.portfolio.tests/src/name/abuchen/portfolio/datatransfer/traderepublic)
(EPL-1.0: read for evidence, never copied). Run through the adapter of `main` on 2026-10-10,
they show five gaps (research 07 §4.2, issue #55):

- **A second revision.** Export 01 (339 rows, 2021 to 2026) is written with **semicolons**,
  unquoted, and has `value_date` after `transaction_id` where the known header has
  `mcc_code`. Its descriptions hold commas, so the comma-only reader refused the file as
  unreadable (`rowLength`).
- **No time in it.** Every `datetime` of export 01 is `<date>T00:00:00.000000Z`: a placeholder,
  not an instant. Its `value_date` is the settlement: on 148 of 162 purchases two business days
  after `date` (two to six calendar days, over weekends and holidays), on the 14 of crypto the
  same day, and before `date` on the tax-base rows.
- **Dates that disagree.** In export 04, dividend corrections booked at 12:17 UTC on
  28 March carry `date` 27 March. They were refused as an unreadable time before their type
  was looked at, the wrong reason, as `0E-10` once was for Trading 212.
- **Row types and classes not known:** cash transfers under four more names, cash gifts,
  Saveback paid as cash, German tax rows (a tax refund, the Vorabpauschale of
  [InvStG §18](https://www.gesetze-im-internet.de/invstg_2018/__18.html) and its tax base),
  fund distributions, a "Capital Distribution" (`DIVIDEND_EQUIVALENT_PAYMENT`), bond coupons
  and settlements, derivative trades and redemptions, splits, warrant exercises; the classes
  `CRYPTO`, `DERIVATIVE` and (reported by
  [libtraderepublic](https://github.com/aritzmmartinez/libtraderepublic)) `SYNTHETIC`; and
  the account type `JUNIOR`, a child's account.
- **German tax.** These are German residents' exports: the tax rows, and `tax` on five fund
  sales (German capital-gains tax beside a gross `amount`), are Trade Republic settling German
  tax. No Slovenian figure depends on them, but refusing them would block every year: ADR 0017
  scopes no Trade Republic refusal, so a refused row withholds every return of every year,
  which for someone who moved from Germany would be forever.

## Decision

1. **The CSV reader takes its delimiter from the header line**, before any row is read: a
   comma outside quotes chooses the comma, as before; a header with only semicolons outside
   quotes chooses the semicolon. One linear pass, quotes respected, past the byte-order mark
   and empty lines as the reader skips them. A wrong choice cannot misread a file, because
   adapters match exact header names; it ends in an unknown format or a row of the wrong
   length. The table carries the delimiter (`CsvTable.delimiter`).
2. **Every header is tied to the delimiter it was seen with.** `CsvAdapter.matches` receives
   the delimiter. Trade Republic's comma revision (`traderepublic-csv-2026`, quoted or not)
   and its semicolon revision (`traderepublic-csv-value-date`) each match only with their
   own; Trading 212's revisions only with the comma, so a Trading 212 file reads exactly as
   before. A file re-saved by a spreadsheet in another locale, whose numbers and dates may
   have changed with its delimiter, fails as a whole instead of row by row.
3. **The semicolon revision is dated by `date` alone.** Its `datetime` must be that date at
   midnight UTC, exactly as the revision writes it, or the row cannot be dated; the ledger
   keeps no instant for it. `value_date` is never read: it is a settlement date, and the tax
   date is the trade date (ADR 0011 §7). The comma revision keeps ADR 0015's rule.
4. **Trades are keyed by `transaction_id` and the trade's date**, not its instant, so the same
   trade keys alike in both revisions and overlapping exports of either read it once.
5. **What a row is comes before its date.** A row refused for its type, category, class or
   account type gives that reason even when it cannot be dated; it moves the file's reach only
   when it can be, since a reach no row vouches for would weaken the check of the 30-day rule.
   Every row read as an event, an ignored one included, must still be dated.
6. **The new rows are classified explicitly:**

   | Rows | Outcome |
   |---|---|
   | `TRANSFER_IN`, `TRANSFER_INBOUND` | ignored, `deposit` |
   | `TRANSFER_OUT`, `TRANSFER_DIRECT_DEBIT_INBOUND` (a direct debit, money out) | ignored, `withdrawal` |
   | `GIFT` of cash | ignored, `gift` (new) |
   | `BENEFITS_SAVEBACK` of cash | ignored, `cardSpending` (cashback; its shares come in a purchase row) |
   | `GIFT` or `BENEFITS_SAVEBACK` of a security | refused, `unsupportedAction` |
   | `DISTRIBUTION` | refused with dividends, `unconfirmedAction` |
   | `DIVIDEND_EQUIVALENT_PAYMENT` (a return of capital), `SEC_ACCOUNT`, `TILG` | refused, `unsupportedAction` |
   | Cash of a bond (a coupon) | refused by its class, `BOND` |
   | A trade of a `DERIVATIVE` | ignored, `derivative`, with the `derivativesNotCovered` warning, as Interactive Brokers' are |
   | A trade of `SYNTHETIC` (gold) | refused, `unsupportedAction` |
   | Every cash type, only on a row with no security and no shares | otherwise `unknownAction`, as before |

7. **German tax rows are ignored by their shape, never by name alone.** `TAX_OPTIMIZATION` on
   a cash row, and `EARNINGS` or `PRE_DETERMINED_TAX_BASE` on a fund with a valid ISIN, are
   ignored as `brokerTaxSettlement` (new) only when `amount` is exactly 0 and `tax` a non-zero
   number. In any other shape they could move money, and are refused (`unconfirmedAction`). A
   sale with a non-zero `tax` is read as any sale. Both are counted in one warning,
   `brokerTaxSettled`, which says what they are and that no Slovenian figure depends on them.
   The reason's name says whose tax it is: never the foreign tax of Doh-Div, never a row's
   withholding.
8. **A `JUNIOR` account is refused once per file** (`juniorAccount`, new), at its first row,
   and none of its rows is read: a child's account is the child's, another taxpayer. A
   separate account scope would not keep it apart, since FIFO pools every account of the
   ledger. The taxpayer's own rows in the same file are still read.
9. **The amount check does not widen for a tax.** Every share, fund and crypto trade of the
   exports (174 of 179 in export 01) gives `amount` gross, quantity times price within a cent,
   with the fee and tax beside it; only bond purchases differ, by their accrued interest, and
   bonds are refused. The check stays quantity times price within the fee and a cent. Only a
   parser's documentation reports `tax` on purchases, with no shape.
10. **The ignored reasons are a typed record** (`IGNORED_REASONS satisfies
    Record<IgnoredReason, true>`), so a reason added to the union and missing from the check
    does not compile (#15).

File text reaches a finding only as an unknown type, category, class or account type,
wrapped as untrusted; descriptions, counterparty names and IBANs never do.

## Open questions

- **What `tax` holds on a Slovenian resident's dividend.** The exports confirm that `amount`
  is the gross in euros at Trade Republic's rate (`original_amount` × `fx_rate`, e.g.
  34.51 × 0.857265 = 29.58), `original_amount` the gross in the paying currency, and `fx_rate`
  euros per unit of it. But in German residents' files `tax` includes German tax, so dividends
  stay refused (ADR 0015 decision 6, #12).
- **Does `transaction_id` survive from one export to the next?** The same bookings carry
  different IDs in exports 04 and 05, but 04's may be an anonymizer's; unsettled (#12).
- **Is `date` the trade date?** `value_date` two business days after `date` on 148 of 162
  purchases is evidence that it is, for the semicolon revision; ADR 0015's first open question stays open
  until a real export and its confirmation PDF settle it.

## Consequences

- **A Trade Republic user with the older semicolon export** gets their purchases and sales
  read, where the whole file was refused before.
- **Fewer rows block a whole history:** transfers, cash gifts, Saveback cash, German tax rows
  and derivative trades are set aside with a reason, and the rest name what they are.
- **A refusal still blocks every year** for Trade Republic: dividends, crypto, bonds and the
  other refused rows state no reach under ADR 0017 (#52).
- **The semicolon revision has no time of day.** FIFO orders such a day as it does for any
  untimed trade: purchases before sales, then by key. Where a day has purchases at different
  prices and a sale ends partway through them, the engine warns that the order decided which
  shares the sale used (`sameDayLotOrder`); nothing blocks.
- **A spreadsheet re-save** of a Trade Republic or Trading 212 export with semicolons is no
  export either adapter knows, as it was not before semicolons were read: it fails whole.
- **The format strings** are `traderepublic-csv-2026` and `traderepublic-csv-value-date`; the
  first is unchanged.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0019`, and by hand for the spelling
      `ADR 0019`.
- [ ] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a dated
      correction note.
