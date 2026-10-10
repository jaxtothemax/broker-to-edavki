# Trade Republic fixtures

Synthetic transaction exports, one per header revision known
(`docs/research/07-brokers-eu-and-others.md` §4.2, ADR 0015, ADR 0019). No row
comes from a real account: transaction IDs are placeholders, amounts are made
up, and the only securities are a world equity fund, Apple and LVMH, bought and
sold at invented prices. Every trade's `amount` is gross, its quantity times its
price, with the fee beside it, as the exports that look real give it.

| File                             | Revision                                            | Header source                                       |
| -------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `tr-transactions-2026.csv`       | Comma revision, with `mcc_code`, every field quoted | The research's header, quoted exactly               |
| `tr-transactions-value-date.csv` | Semicolon revision, with `value_date`, unquoted     | The header of export 01 the research cites, exactly |

What they show:

- `tr-transactions-2026.csv`: savings-plan purchases of a fund, a purchase and a
  sale of a share, a sale at 22:40 UTC that falls on the next day in Ljubljana,
  a deposit, a card payment and interest.
- `tr-transactions-value-date.csv`: purchases of a fund (written as `BUY`, as
  this revision writes savings plans) and of a share, a sale of the fund that
  takes two lots, a deposit, interest and a withdrawal. Every `datetime` is the
  date at midnight UTC, `value_date` two business days later on a trade, and
  descriptions hold commas, as the revision writes them.

The comma revision unquoted, and the row types beyond these, are built in the
tests row by row. The research rates both revisions from exports that look real
but are a third party's test data. They still have to be checked against a
real, anonymized export before the adapter ships: add one beside these files
when it is available, and keep them all passing. A Slovenian resident's export
with a dividend would also settle what `tax` holds on a dividend row, which the
adapter refuses until then.
