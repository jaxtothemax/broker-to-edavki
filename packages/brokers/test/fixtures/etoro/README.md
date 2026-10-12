# eToro fixtures

There is no file here yet, and that is on purpose.

The eToro adapter (`packages/brokers/src/etoro.ts`, ADR 0020) is **unverified**. Its
tests run on synthetic account statements written at test time by
`packages/brokers/src/testing/etoro.ts` through `makeWorkbook`, not on binary files. No
row comes from a real account. Position IDs are made up, and the holder's name is a
canary that must never reach a finding. The one round trip and dividend with real-looking
figures (Apple, 300 USD, 1.650619 units, a 0.11 dividend with 0.0122 withheld) copy the
example statement research 07 §4.1 describes, under made-up IDs and dates.

| Statement (generated)         | Sheets and revisions                                                                                                                              | Header source                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `ROUND_TRIP` and its variants | Closed Positions 2025.2.15 (with and without Profit(EUR)), Account Activity 2025.2, Dividends 2024 and 2025.11 (with and without the EUR columns) | `masbug/etoro-edavki` at `5f607d9`, quoted in research 07 §4.1 |

**What this directory waits for.** One real, untouched account statement, from the
account's opening to the export day, exported as XLSX from eToro and not opened or saved
in a spreadsheet program, then anonymized:

- the Account Summary sheet's name and username replaced;
- position IDs renumbered consistently across all three sheets;
- amounts scaled.

ADR 0014's Consequences ask for one before an XLSX adapter ships, and the adapter is not
released until it passes here. Add it beside this README with a row in the table, and
keep every synthetic test passing. A statement with a partial close, a UK share, a trade
near midnight or a corporate action would also settle ADR 0020's open questions.
