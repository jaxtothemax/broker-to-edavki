# 20. eToro account statement (XLSX)

**Date:** 2026-10-11
**Status:** Proposed

> **Implementation status (2026-10-11):** written on `feat/8-etoro-adapter-xlsx-account-statement`
> for #8, in `packages/brokers/src/etoro.ts`, with core codes in
> `packages/core/src/diagnostics.ts`, the `crypto` ignored reason, the pipeline's
> `secondStatement` check (`packages/pipeline/src/prepare.ts`) and the web app's wiring.
> **Unverified:** no untouched eToro export has been read. The tests run on synthetic
> statements written at test time (`packages/brokers/src/testing/etoro.ts`). ADR 0014's
> Consequences ask for one real, anonymized export before an XLSX adapter ships, and that
> precondition stands. The adapter is not to be released until such an export passes, or
> shows which of the decisions below are wrong.

## Context

eToro is the broker Slovenian investors use most (research 07 §2). It exports only an
account statement: an XLSX workbook of five sheets, Account Summary, Closed Positions,
Account Activity, Dividends and Financial Summary (research 07 §4.1). ADR 0014's reader
opens it. This ADR settles how the adapter reads it.

The evidence is thin, and it is collected in research 07 §4.1:

- the header revisions in `masbug/etoro-edavki` at commit `5f607d9` [H for the headers];
- other parsers' source code;
- one statement a third party published (`nra-assist.com`'s example). That statement
  was saved again by another program, it lacks the EUR columns, and it does not start
  at the account's opening.

Three things set eToro apart from the brokers before it:

- **Positions, not trades.** A Closed Positions row is a whole position, opened and
  closed. Slovenian FIFO runs per security across every account and broker (research 04
  §4.4). So a position eToro closes can sell shares that FIFO takes from an older,
  still-open position, or from another broker.
- **No ISIN on an open position.** Account Activity gives an open position only a
  ticker ("AAPL/USD").
- **An undocumented clock.** No source states the statement's time zone [L].

The architect's review of 2026-10-11 made decisions D1 to D12 and named three risks for
the owner. The owner has not answered them yet. This ADR records the decisions and the
conservative defaults taken for the risks; each default is one place in the code.

## Decision

1. **Recognition (D1).** The adapter matches a workbook that has all five sheets, by their
   exact English names.
   - It reads Closed Positions, Account Activity and Dividends.
   - It skips Account Summary and Financial Summary whole. Neither is ever inflated:
     Account Summary holds the holder's name and username. Each skipped sheet becomes one
     ignored row, with the reason `summary`.
   - Any other sheet, a chart sheet included, refuses the file (`unknownSheet`, by
     position). So does a read sheet that is hidden (`hiddenSheet`).
   - Hidden rows or columns in a read sheet raise a warning (`hiddenCells`).
   - A translated statement does not match and is `unknownFormat`.
2. **Headers and values (D1, D2).**
   - **Headers.** The header is row 1. Columns are found by their exact text, in any
     order, each once.
     - A column outside the revision's list refuses the file (`unknownColumn`), even
       when it is empty.
     - So does a missing column (`columnMissing`), a repeated one (`unreadableFile`,
       `duplicateHeaderName`), and a value under no header (`rowLength`).
   - **Revisions accepted.** Only the current ones:
     - Closed Positions 2025.2.15, with Profit(EUR) optional;
     - Account Activity 2025.2;
     - Dividends 2024 (with ISIN) or 2025.11 (its four added columns, all or none), with
       the EUR columns optional.
     Older revisions are refused, and the finding says to export the statement again.
   - **Numbers.** A number is a number cell, rounded to 15 significant digits (ADR 0014
     §8), or text in the plain grammar `-?d+(.d+)?`. A blank row (empty strings only) is
     skipped.
   - **Refused for the whole file** (`statementFormat`): a comma in a number column (a
     decimal comma, or a thousands separator such as `1,071.56`), brackets for a minus, a
     date written `31.12.2025`, or a date stored as a serial. Under a decimal-comma
     locale, `1.071` would be a thousand and seventy-one, so once one cell shows the
     locale, no number in the file can be trusted.
   - **Values that do not apply.** `-` is read as "does not apply" only in the FX
     columns, a cash row's Units and Position ID, and the franking columns.
   - **Withholding rate.** The rate is text, "10 %" or "15%", and is used only as a
     check.
   - **Position IDs.** A position ID is 1 to 15 digits, as text or a number cell.
3. **Account and keys (D3).**
   - The account is `accountGroup("etoro", n)`, as for Trading 212. The Username is never
     read.
   - Keys come from eToro's position ID, without an ordinal (ADR 0011 §5):
     - `keyOf("trade", ["open", id])` and `keyOf("trade", ["close", id])`, so a
       position's two trades never share a key;
     - `keyOf("dividend", [id, date])` and `keyOf("withholding", [id, date])`.
   - Every statement covers the account from its opening (decision 4), so the result
     carries `wholeHistory`, and the pipeline refuses a second such file of the same
     account (`secondStatement`, both files named). It asks the user to keep the latest,
     or to say in the account question that the files come from different accounts.
4. **The history gate (D4).** The file is refused (`historyIncomplete`) unless all three
   hold:
   - **start:** Account Activity's first row shows an empty account (Realized Equity
     minus Realized Equity Change is 0);
   - **order:** its rows are in time order;
   - **openRow:** every position ID in any sheet has exactly one `Open Position` row.

   Without this, a sale would be matched against the wrong lots, at eToro or another
   broker, and nothing would say so.
5. **Lots (D5).**
   - **A closed position** is a purchase at Open Rate and a sale at Close Rate, in US
     dollars, of its units, on the times of its two Account Activity rows. It is refused
     (`tradeInconsistent`) unless:
     - Units × Open Rate is the Amount;
     - Units × Close Rate is the Amount plus Profit(USD) (`closeAmount`);
     - its Open and Close Date are its activity rows' times (`dates`);
     - its units are the same in all three rows, read at 15 digits (`units`);
     - it has exactly one closing row (`activity`).
   - **Tolerance.** Each check allows a cent, plus a millionth of the rate. Units are
     written to 6 decimals (research 07 §4.1), so this is twice what rounding can leave.
     A margin, a price in pence or a price in another currency is out by far more.
   - **Partial closes.** Two Closed Positions rows, or two closing rows, for one ID are
     refused as partial closes (`unsupportedAction`, `partialClose`). Their shape is not
     known.
   - **A position still open** is a purchase of its activity row's units at Amount ÷
     Units.
     - Its ISIN comes from its ticker, through the Closed Positions and Dividends rows
       that give both.
     - A ticker with no ISIN in the file is refused (`isinUnresolved`, `missing`), and
       so is one with two ISINs (`ambiguous`).
     - The price is kept exact: `Decimal` holds 200 ÷ 1.1 as a fraction until a form
       field rounds it. Tests run such a lot through `validateLedger`, the returns, the
       holdings, the CLI's `--json` report and the web preview, and nothing calls
       `toString` on it. So it is not rounded to 15 digits.
   - **FIFO.** FIFO matches lots per ISIN across every broker. A test shows an older
     still-open lot taken before a closed position's own, and a Trading 212 lot of the
     same ISIN taken before both.
   - **Open rows of a closed position** are ignored as `pairedRow`.
6. **Currency (D6).** Only US dollars are read.
   - A closed position needs both of these, or it is refused (`unconfirmedAction`,
     `nonUsd`; GBX included):
     - its opening row's Details ends in `/USD`;
     - both FX columns are `-`.
   - A position still open and a dividend need `/USD`. In the 2025.11 layout, a
     dividend's Currency must also be `USD`.
   - The FX columns and Profit(EUR) are never values. Every amount is converted at the
     Banka Slovenije rate (research 03).
7. **Dates (D7).**
   - **Trades.** A trade's time is taken as UTC [L] (market opens show as 14:31 for New
     York and 07:01 for Paris, research 07 §4.1). Its tax date is the Ljubljana date
     (`taxDate`).
     - **Band guard.** The trade is refused (`dateUncertain`) when the Ljubljana date
       differs anywhere in a band of clocks from UTC+0 to UTC+3 (`ZONE_BAND_HOURS`, one
       constant). Checking the band's two ends covers it, since the date never goes back
       as the instant moves on.
     - **Known answers:** in winter, 22:30 is read and 01:30 refused; in summer, 22:30 is
       refused and 01:30 read.
     - **Consequence.** A trade the guard passes is never moved off its UTC date, so no
       eToro trade raises `dateMovedToLjubljana`.
   - **Dividends.**
     - A dividend is dated by its Date of Payment, with no instant.
     - It must be the UTC date of its Account Activity row, or it is refused
       (`dividendInconsistent`, `date`).
     - If the band could move that row onto another day, one warning per file counts such
       dividends (`dividendDatesUncertain`). Nearly every dividend in the statement seen
       was booked between 00:03 and 00:45.
     - If the band could move it into another year, it is refused (`dateUncertain`).
8. **Derivatives and crypto (D8).**
   - **Derivatives.** Types CFD, OPT, FUT, FOP and Crypto Margin are ignored as
     `derivative`, with one `derivativesNotCovered` warning that counts them. This covers
     closed and still-open positions, and a dividend of that type.
   - **Crypto.** Crypto held long without leverage is ignored with a new reason,
     `crypto`. That reason is also in `IGNORED_REASONS` (#15).
   - **Short or leveraged.** Stocks, ETF or Crypto that is short, or has leverage other
     than 1, is refused (`unsupportedAction`, `short` or `leveraged`).
   - **Unknown types.** An unknown Type, or a Long / Short value other than those two, is
     refused (`unknownAction`).
   - **Copy trading** is read like any other position.
9. **Account Activity types (D9), a closed list:**

   | Type | Becomes |
   |---|---|
   | `Open Position` | a purchase (still open), or `pairedRow`, `derivative` or `crypto` with its position |
   | `Position closed` | `pairedRow` (or as above) with its Closed Positions row; refused without one |
   | `Dividend` | `pairedRow` with its Dividends row; refused unpaired (`dividendInconsistent`, `unpaired`) |
   | `Interest Payment` | `interest`, with one `interestNotCovered` warning |
   | `Deposit` | `deposit` |
   | `Withdraw Request` | `withdrawal` |
   | `Withdraw Fee`, `Withdrawal Conversion Fee`, `Overnight fee`, `Overnight refund`, `SDRT` | `fee`: costs, which the normed costs cover (research 04 §4.2) |
   | anything else | refused (`unknownAction`), the type shown only through `untrusted()` |

   Types seen in other parsers but not in D9 are refused until a source says what they
   carry: `Adjustment`, `Commission`, `corp action: Split`, `Staking`, `AirDrop`,
   `Withdraw Request Cancelled`, `Withdraw Fee Cancelled` and `Edit Stop Loss`.
   `Withdrawal Conversion Fee` is in research 07's list [M] and is a fee.
10. **Dividends (D10).**
    - **One event per row.** Merging rows per payer and day is open (research 07 §3,
      rule 5).
    - **Gross.** The gross is Net Dividend Received (USD) plus Withholding Tax Amount
      (USD). eToro's dividends are net [M]. The tax becomes a withholding event when it is
      positive.
    - **Rate check.** The tax must be the stated rate of the gross, within a cent
      (`dividendInconsistent`, `rate`). Known answer: 0.11 net, 0.0122 tax ("10 %") gives
      a gross of 0.1222.
    - **Pairing.** Each row pairs with exactly one Account Activity `Dividend` row: same
      position, same amount, same day. Otherwise it is refused (`pairing`, `date`).
    - **The 2025.11 layout.** Currency must be USD, Net dividends must equal the dollar
      amount (`netAmount`), and the franking columns must be empty or `-` (else
      `unsupportedAction`, `franked`).
    - **Required.** An ISIN is required.
    - **Payer.** The payer's details come from the payers table, as for every broker.
11. **Reach (D11).** Every eToro refusal is unscoped (ADR 0017). The adapter never sets
    `shares`, so a refusal withholds both returns of every year. A test checks this on
    `isinUnresolved` for a year the row is not in.
12. **Findings (D12).** New codes, each in English and Slovenian:
    - for the sheets: `unknownSheet`, `hiddenSheet`, `hiddenCells`;
    - for the statement: `columnMissing`, `statementFormat`, `historyIncomplete`,
      `dateUncertain`, `dividendDatesUncertain`, `openPositionsAssumed`,
      `isinUnresolved`, `dividendInconsistent`;
    - for the pipeline: `secondStatement`.

    `tradeInconsistent` gains the checks `closeAmount`, `dates`, `units` and `activity`.
    A finding names no position ID, `Copied From`, `Notes` or cash row's Details. Sheet
    names never appear in one either: sheets are named by position. Sheet `part` IDs are
    letters only (`closedPositions`, `accountActivity`, `dividends`, `accountSummary`,
    `financialSummary`).

### The owner's open risks, and the defaults taken

- **R1, no real export.** The adapter was built in full on synthetic statements made by
  `makeWorkbook` at test time, with no binary fixture. It is marked unverified here and in
  `packages/brokers/test/fixtures/etoro/README.md`. ADR 0014's precondition is not set
  aside: it waits for one real, untouched export before it ships.
- **R2, a position still open with no ISIN in the file: option (a).** It is refused,
  blocking and unscoped (`isinUnresolved`), and withholds every return. `core/reach.ts` is
  unchanged. Option (b), withholding only Doh-KDVP of years in which another account sells
  the same security, would be a new rule in `scopeLedger`. Option (c), asking the user,
  would be a new question in the app.
- **R3, short or leveraged shares.** They are refused (`unsupportedAction`, `short` and
  `leveraged`).

### Where the spec left a gap, and what was chosen

- **A position still open has no Long / Short or Leverage column** in Account Activity.
  - **Default.** Following D5, it is taken as a long, unleveraged purchase, and one
    warning per file says so (`openPositionsAssumed`).
  - **Overnight fees.** eToro charges an overnight fee only on a leveraged or short
    position, so an open Stocks or ETF position that paid one or had one refunded is
    refused (`unsupportedAction`, `leveragedOrShort`).
  - **Residual risk.** A leveraged or short position opened too recently to pay a fee
    would be read wrongly.
- **ADR 0014 §7 cites eToro's `1,071.56`** as text an adapter might accept. D2 refuses
  thousands separators. The refusal was kept.
- **Version.** `docs/spec/v0.1.md` puts eToro in v0.2, while the start screen says
  "planned after v0.1". No version is claimed: the roadmap keeps eToro under Planned, in
  the future tense.

## Consequences

- A user whose statement starts at the account's opening, holds only US-dollar shares and
  ETFs held long, and has no partial closes gets both returns. A positions-only CFD
  account gets warnings and no figures.
- Everyone else is refused with a finding that says why. That covers a statement that
  starts later, a partial close, a UK or EU share, a short, and a trade near midnight.
  That is a lot of refusals; the first real exports will show which to lift.
- A second statement of the same account is refused rather than merged. A user with two
  eToro accounts answers the account question.
- Account Summary is never read, so no name or username can reach the ledger, a finding
  or an export. A canary test checks it.

## Open questions

- **Time zone.** Is the statement's clock UTC? An untouched export with a trade at a
  known exchange time would settle it, and `ZONE_BAND_HOURS` could then shrink to 0.
- **Partial closes.** How does eToro record them? Two Closed Positions rows, one row with
  the closed units, or a new position ID for the rest? All three are refused now: the
  third fails the history gate.
- **Instruments not in dollars.** Is Open Rate in pence for GBX? Do the FX columns
  convert to USD? A UK or EU share would settle both.
- **Dividend merging.** Should eToro's per-position rows of one corporate payment become
  one Doh-Div record (research 02 §5, research 07 §3, rule 5)?
- **Cell kinds.** Which cells are numbers and which are text in an untouched export? The
  statement seen mixes them, after another program saved it. Both are read today.
- **Does Profit(USD) include fees?** If it includes fees or dividends, the close check
  would refuse real positions.
- **Asset type.** Does Account Activity's Asset type use Closed Positions' Type
  vocabulary (Stocks, ETF, CFD)?
- **The owner's answers.** R1 to R3 above.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0020`
- [ ] Any issue carrying pre-ADR scope rewritten (title and body), led by a dated
      correction note. Record the count here, including zero.
