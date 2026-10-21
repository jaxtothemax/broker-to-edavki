# eToro fixtures

The eToro adapter (`packages/brokers/src/etoro.ts`, ADR 0020) is **unverified** for
everything that reads a row. Its tests run mostly on synthetic account statements written
at test time by `packages/brokers/src/testing/etoro.ts` through `makeWorkbook`. No trade
or dividend row comes from a real account. Position IDs are made up, and the holder's name
is a canary that must never reach a finding. The one round trip and dividend with
real-looking figures (Apple, 300 USD, 1.650619 units, a 0.11 dividend with 0.0122
withheld) copy the example statement research 07 §4.1 describes, under made-up IDs and
dates.

| Statement                                  | Sheets and revisions                                                                                                                              | Source                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ROUND_TRIP` and its variants (generated)  | Closed Positions 2025.2.15 (with and without Profit(EUR)), Account Activity 2025.2, Dividends 2024 and 2025.11 (with and without the EUR columns) | `masbug/etoro-edavki` at `5f607d9`, quoted in research 07 §4.1               |
| `2026-10-no-activity.xlsx` (real, no rows) | The five sheets and a Glossary; Closed Positions 2025.2.15 with Profit(EUR), Account Activity 2025.2, Dividends 2025.11 with the EUR columns      | A contributor's account, exported 2026-10-21 for 1 to 20 October, anonymized |

**`2026-10-no-activity.xlsx`.** A real statement of an account that has never had any
activity, downloaded with the XLS icon and never opened in a spreadsheet program. Every
amount in it is 0, and its three data sheets hold only their header rows. It was
anonymized by a script that rewrote one part, `xl/sharedStrings.xml`, replacing three
strings: the Account Summary's name (B3, now `Account Holder`), username (B4, now
`anonymized`) and account creation date (B6, now `15/03/2021 09:00:00`). Every other part
is byte for byte as eToro wrote it, in the same order and compression; only the archive
was written again. The script checked, rather than anyone looking, that every other part
is unchanged and that neither the three strings replaced nor any word of three letters or
more in them is left in any part. Every amount was checked to be 0. The export's own
timestamps (the archive's entry times and the core properties' `created` and `modified`)
are kept as written. It settles the sheets (a sixth, Glossary, ADR 0020 decision 1) and
the headers, and that an empty sheet keeps its header row. It says nothing about trades,
dividends, cell kinds in the data sheets or the statement's clock.

**What this directory still waits for.** One real, untouched account statement with
trades and dividends, from the account's opening to the export day, exported as XLSX from
eToro and not opened or saved in a spreadsheet program, then anonymized:

- the Account Summary sheet's name, username and creation date replaced;
- position IDs renumbered consistently across all three sheets;
- amounts scaled.

ADR 0014's Consequences ask for one before an XLSX adapter ships, and the adapter is not
released until it passes here. Add it beside this README with a row in the table, and
keep every other test passing. A statement with a partial close, a UK share, a trade near
midnight or a corporate action would also settle ADR 0020's open questions.
