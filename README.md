# TaxReporter

**Turn your foreign broker's exports into XML you can import into FURS eDavki — on your own
computer, with every amount converted at the Banka Slovenije rate.**

If you are a Slovenian tax resident and invest through a foreign broker (Trading 212,
Interactive Brokers, Trade Republic, eToro, …), nobody reports your trades or dividends to
FURS for you. You file **Doh-KDVP** (gains from selling shares and ETFs) and **Doh-Div**
(dividends) yourself, by 28 February (or the next working day), with every purchase, sale and dividend converted
to euros at the Banka Slovenije rate for its own day. TaxReporter does that work from the files
your broker already gives you, on your own device, and shows you where every number came from.

> **Status: pre-alpha, no release yet.** Version 0.1 is being built for tax year 2026 (returns
> due by 1 March 2027), for Trading 212, Interactive Brokers and Trade Republic. The source can
> already read these brokers' exports and write both returns: see [Try it](#try-it). Treat what
> it writes as a draft to check, never as a finished return.

> [!IMPORTANT]
> **Check every figure before you file.** TaxReporter can be wrong. The return you file is your
> responsibility, not that of the people who make TaxReporter. Read
> [Known assumptions](#known-assumptions) and
> [Check every figure yourself](#check-every-figure-yourself) before you rely on it.

## Who it's for

- **Savers with a savings plan.** A monthly ETF purchase on Trading 212 or Trade Republic means
  dozens or hundreds of small purchases, each converted at its own day's rate and matched when
  you sell. TaxReporter does that from the export, and says in plain words, in Slovenian or
  English, when something needs your attention.
- **Active investors with more than one broker.** Sales are matched first in, first out per
  security across every broker and account you add, the way the law requires, not per file.
  Trades in dollars, pounds or francs, stock splits and dividends with foreign tax withheld are
  handled. A corporate action TaxReporter does not handle, such as a spin-off, is refused with
  an explanation instead of guessed.
- **Accountants preparing returns for clients.** The command-line tool writes the same XML for
  the same files every time, one client at a time, and client data never leaves the office
  computer.
- **Developers.** Adding a broker is a contained piece of work with a small interface and test
  fixtures to copy. See [Get involved](#get-involved).

Not covered yet: shares from an employer's plan (RSUs, ESPP), interest (Doh-Obr) and
derivatives such as options and CFDs (D-IFI). They are on the
[roadmap](website/src/content/docs/roadmap.md).

## How it works

```text
broker exports ─► read ─► one ledger ─► Banka Slovenije rates ─► FIFO ─► Doh-KDVP / Doh-Div XML ─► you check ─► eDavki
```

1. **You export your whole history** from each broker, from the day you opened the account.
   Sales are matched against your earliest purchases, so a missing year changes the result.
2. **Each file is read on your device.** TaxReporter recognizes a file by its content, never by
   its name. Every row becomes an event in one ledger, an ignored row with its reason (a
   deposit, for example), or a finding that stops the return until you resolve it. No row is
   dropped silently, and a row TaxReporter does not understand is refused, not guessed. The
   assumptions it does make are listed under [Known assumptions](#known-assumptions).
3. **Every amount is converted at the Banka Slovenije rate** valid on its day: the trade date for
   a purchase or sale (never the settlement date), the payment date for a dividend. A weekend or
   holiday uses the last list published before it, and a currency missing from the daily list
   uses the monthly one. The broker's own exchange rate is never used. Banka Slovenije's lists
   since 2007 come with the app, so converting needs no other server, and every converted
   amount keeps its rate, the list's date and its source. The lists included today run to
   7 October 2026; a later date stops with a finding until they are refreshed
   ([#21](https://github.com/jaxtothemax/broker-to-edavki/issues/21)).
4. **Sales are matched first in, first out (FIFO)** per security, by ISIN, across all your
   brokers and accounts. How long each purchase was held sets the rate on its part of the
   gain: 25%, falling to 20% after five years, 15% after ten and none after fifteen. The part of
   a loss that you bought back within 30 days before or after the sale does not count.
5. **Doh-KDVP and Doh-Div are written as eDavki XML** in the structure of FURS's published
   schemas, which the project's tests check every kind of return against. Before a file is
   written, it is checked against the rules the schemas leave out. Foreign tax withheld stays
   with its dividend. Brokers do not export a dividend payer's address, which Doh-Div needs, so
   you add it once per security (the web app starts Trading 212's dividends with Trading 212
   as the payer). A return is withheld, with the reason, while a finding blocks it. Some rows
   TaxReporter cannot read yet hold back only the returns they can change: a Trading 212
   takeover paid in shares in 2025, whose export books the new shares right after the sale,
   holds back 2025, and 2026 only if either security is sold in 2026 (ADR 0017). Other brokers' corporate actions still hold back every return until
   they are handled ([#52](https://github.com/jaxtothemax/broker-to-edavki/issues/52)).
6. **You check it, then import it into eDavki yourself.** TaxReporter shows an estimate of the
   tax and the source of every figure. It never files anything.

## What it reads today

From source, before the first release:

| Broker              | Export                                                                                                                 | Read                                                    | Refused, among others                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Trading 212         | History export, CSV (four header revisions)                                                                 | Purchases, sales, dividends with the tax withheld, splits | Payments in lieu of dividends, tax-exempt dividends, spin-offs, transfers, stock distributions                                          |
| Interactive Brokers | Activity Flex Query, XML ([how to set it up](website/src/content/docs/guides/run-from-source.md#setting-up-the-ibkr-flex-query)) | Trades, dividends with the tax withheld, splits that keep the ISIN | Payments in lieu of dividends, other corporate actions, cancellations and corrections, short sales, option exercises                             |
| Trade Republic      | Transaction export, CSV (offered since April 2026; both revisions, with commas or semicolons)                          | Purchases, sales, savings plans                         | Dividends and fund distributions, until a real export confirms their tax ([#12](https://github.com/jaxtothemax/broker-to-edavki/issues/12)); returns of capital; trades with a foreign-currency leg; free shares; corporate actions and deliveries; bonds, crypto and gold; Junior (child) accounts |
| eToro (not yet checked against a real export) | Account statement, XLSX, current layout, from the account's opening ([ADR 0020](docs/adr/0020-etoro-account-statement.md)) | US-dollar shares and ETFs held long, closed or still open; dividends with the tax withheld; CFDs and crypto left out with a note | A statement that starts later, older layouts, short or leveraged positions, partial closes, other currencies, a trade too near midnight to date |

The project's tests use synthetic exports that follow each format as far as the research
reconstructs it from public samples, not real accounts' data. Each reader still has to be
checked against real, anonymized exports before v0.1 ships ([#22](https://github.com/jaxtothemax/broker-to-edavki/issues/22),
[#12](https://github.com/jaxtothemax/broker-to-edavki/issues/12)). Both the browser app
and the command-line tool write the same XML for the same files and payer details (the browser app
starts Trading 212's dividend payers as Trading 212; the command line takes them from its payers
file, [#43](https://github.com/jaxtothemax/broker-to-edavki/issues/43)). Next, in
order of how many Slovenian investors use them: eToro, XTB, DEGIRO, Revolut, Lightyear, Saxo and
Robinhood. The spreadsheet (XLSX) reader that eToro, XTB and Saxo need is built. eToro's adapter
is written but stays unreleased until a real, untouched statement confirms it
([#8](https://github.com/jaxtothemax/broker-to-edavki/issues/8)); XTB's and Saxo's wait on real,
anonymized exports.

## Known assumptions

TaxReporter refuses what it does not understand, but it rests on a few assumptions that no
primary source has settled yet. These are the ones known today, each with an open issue that
says what would settle it. Check the parts of your return they touch.

- **Trade date ([#13](https://github.com/jaxtothemax/broker-to-edavki/issues/13)).** Where an
  export gives the time of a trade, TaxReporter dates the trade by the Ljubljana calendar date of
  that time, a design choice, because no FURS or ZDoh-2 text found says which date a trade near
  midnight has, so such a trade can land a day away from the date your broker shows, and on
  another day's exchange rate.
- **Funds ([#30](https://github.com/jaxtothemax/broker-to-edavki/issues/30)).** A Trading 212
  security counts as a fund (for Doh-KDVP and for the Doh-Div dividend type) only if its name
  contains "ETF" or "UCITS", so a fund named otherwise goes on the return as an ordinary share
  without any warning, and the other readers have not yet been checked for the same gap.
- **Cash instead of a fraction of a spin-off share
  ([#41](https://github.com/jaxtothemax/broker-to-edavki/issues/41)).** Trading 212 books it as
  `Dividend (Demerger)` and TaxReporter counts it as an ordinary dividend, with a warning on each
  row, although the research rates that as low confidence and it may instead be a partial sale of
  the old shares.
- **Dividend payer ([#44](https://github.com/jaxtothemax/broker-to-edavki/issues/44)).** The web
  app starts Trading 212's dividends with Trading 212 itself as the payer on Doh-Div, on the
  strength of one eDavki record, because no FURS text found says who the payer is when a foreign
  broker passes a dividend on, so check the payer of every dividend (the command line takes payers
  only from your payers file).

The research behind the tax rules was checked by an AI agent, and no tax professional has
reviewed it yet; its [README](docs/research/README.md) says so, and lists the
[open conflicts](docs/research/README.md#open-conflicts-to-settle-before-implementing) that remain.

## Check every figure yourself

TaxReporter prepares a **draft** for you to review. The return you submit in eDavki is yours: you
sign it, and you are responsible for what it says.

- **It can be wrong.** It is pre-release software. Brokers change their exports without notice,
  an export can itself be incomplete or wrong, and tax law has cases TaxReporter does not know.
- **Check before you import.** Compare the totals with your broker's own annual statement, check
  each sale's dates, quantity and values, look up a few rates on [bsi.si](https://www.bsi.si),
  and read every finding. The tax TaxReporter shows is an estimate; eDavki computes the real
  amount.
- **It is not tax advice**, and it is not affiliated with FURS, Banka Slovenije or any broker.
  When you are unsure, ask a tax adviser or FURS.
- **Nobody behind it accepts liability.** TaxReporter is free software, provided "as is",
  without any warranty. As far as the law allows, its authors and contributors are not
  responsible for errors in a return prepared with it, or for any tax, interest or penalty that
  follows. See sections 15 and 16 of the [license](LICENSE).

If a number looks wrong, please [open an issue](https://github.com/jaxtothemax/broker-to-edavki/issues)
and describe it, without attaching your files.

## Your data stays on your device

TaxReporter runs in your browser or as a command-line tool on your computer. There is no server,
no account and no tracking, and your broker files are never uploaded. In the browser, files are
read in a background worker: its network and storage functions are removed before it reads
anything, the app's strict Content Security Policy lets it load only the app's own files, and
closing the tab forgets them. A browser test
([`apps/web/e2e/no-outbound-requests.spec.ts`](apps/web/e2e/no-outbound-requests.spec.ts),
[#2](https://github.com/jaxtothemax/broker-to-edavki/issues/2)) fails if importing files or
reaching the results sends a request outside the app's own origin. See [ADR 0002](docs/adr/0002-local-first-processing-on-the-users-device.md)
and [Privacy and security](website/src/content/docs/guides/privacy-and-security.md).

An optional AI "second opinion" is planned: it will run only with your own API key, after you
have seen exactly what it sends, and it will never change a figure.

## Try it

There is no release to install yet. To run it from source you need Node.js 24 and pnpm 10:

```bash
git clone https://github.com/jaxtothemax/broker-to-edavki.git
cd broker-to-edavki
pnpm install --frozen-lockfile
pnpm run build                    # every package and both apps, the browser app included
pnpm --dir apps/web preview       # the browser app, at http://localhost:4173
```

### Run it on the synthetic fixtures

The repository holds made-up Trading 212 exports (no real account's data). From the folder you
just built, this writes both returns for tax year 2026 into a temporary folder and checks each
against FURS's schema:

```bash
demo="$(mktemp -d)"
cat > "$demo/payers.json" <<'EOF'
{
  "US1912161007": {
    "name": "The Coca-Cola Company",
    "address": "One Coca-Cola Plaza, Atlanta, GA 30313, United States",
    "country": "US"
  }
}
EOF
node apps/cli/dist/bin.js \
  packages/brokers/test/fixtures/trading212/t212-invest-v3-2025.csv \
  packages/brokers/test/fixtures/trading212/t212-invest-v4-2026.csv \
  --year 2026 --tax-number 12345678 --out "$demo/returns" --payers "$demo/payers.json"
xmllint --nonet --noout --schema packages/furs/schemas/Doh_KDVP_9.xsd "$demo/returns/Doh_KDVP_2026.xml"
xmllint --nonet --noout --schema packages/furs/schemas/Doh_Div_3.xsd "$demo/returns/Doh_Div_2026.xml"
```

The command-line tool prints a line for each return and the findings, and exits with 0.
`xmllint` prints `validates` for each file. `12345678` is a made-up tax number. Leave out
`--payers` and the tool exits with 1 and writes no Doh-Div, because a finding (`payerUnknown`)
blocks it until each dividend has a payer.

`xmllint` is part of libxml2: macOS has it, and Linux distributions package it, for example as
`libxml2-utils`. The project's own tests run this schema check on every golden XML file with an
`xmllint` compiled to WebAssembly, so they need no system copy: `pnpm vitest run packages/furs`.
A passing schema check says the XML has the shape FURS requires. It does not say the figures are
right, and the schema leaves out rules that TaxReporter checks itself.

[Run it from source](website/src/content/docs/guides/run-from-source.md) covers the command-line
tool, setting up the IBKR Flex Query, and the payer file Doh-Div needs. The full documentation is
at [jaxtothemax.github.io/broker-to-edavki](https://jaxtothemax.github.io/broker-to-edavki/).

## Get involved

TaxReporter is built in the open, and you do not need to be a tax expert to help. Each broker it
reads saves its users from converting hundreds of rows by hand or uploading their statements to
a paid service.

- **Try it on your own exports and tell us what breaks.** Open an issue that names the broker,
  the export and what went wrong. Paste only the header row, with every number, ID and name
  replaced by made-up values. Never attach the real file: issues are public.
- **Help confirm a broker's format.** Every reader still has to be checked against real
  exports. For Trade Republic ([#12](https://github.com/jaxtothemax/broker-to-edavki/issues/12)), the issue lists what we need to know,
  and you can answer most of it from your own file without sharing it. Trading 212 and IBKR
  ([#22](https://github.com/jaxtothemax/broker-to-edavki/issues/22)) and eToro ([#8](https://github.com/jaxtothemax/broker-to-edavki/issues/8)) need exports with every name, ID and
  identifying amount replaced first, as [CONTRIBUTING.md](CONTRIBUTING.md) describes.
- **Add a broker.** An adapter turns one export into ledger events; exchange rates, FIFO and the
  XML are shared, so it never touches them.
  [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-broker-adapter) lists what a new adapter needs,
  [packages/brokers/README.md](packages/brokers/README.md) shows the interface to implement and
  where to register it, and the Trading 212, IBKR, Trade Republic and eToro adapters are worked
  examples.
- **Check the tax rules.** Each rule cites its primary source (the law, FURS instructions and
  schemas, Banka Slovenije) in [docs/research/](docs/research/); where one is still missing, an
  open issue tracks it (the trade-date rule, [#13](https://github.com/jaxtothemax/broker-to-edavki/issues/13)). If you know Slovenian tax
  law, reviewing those notes and their open questions is one of the most useful things you can
  do.
- **Improve the docs**, including the planned Slovenian translation of the documentation site.

The [open issues](https://github.com/jaxtothemax/broker-to-edavki/issues) show what is planned and
what is in progress. Security issues are reported privately: see [SECURITY.md](SECURITY.md).

### For developers

A TypeScript monorepo on Node 24 with pnpm workspaces
([ADR 0003](docs/adr/0003-typescript-monorepo-with-pnpm-workspaces.md)):

| Path                   | What it holds                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `packages/core`        | The ledger, exact decimal arithmetic, FIFO, the 30-day rule, the tax estimate, findings |
| `packages/fx`          | Banka Slovenije's rate lists, and choosing the rate for a date                         |
| `packages/furs`        | Doh-KDVP and Doh-Div XML, with the vendored FURS schemas                               |
| `packages/brokers`     | The import contract, the broker adapters, and strict CSV, XML, ZIP and XLSX readers    |
| `packages/pipeline`    | One path from files to returns, shared by both apps                                    |
| `apps/cli`, `apps/web` | The command-line tool and the browser app                                              |
| `website/`             | The documentation site                                                                 |
| `docs/`                | Research with its sources, architecture decisions (ADRs) and specs                     |

```bash
make setup         # install dependencies and git hooks
make doctor        # check your toolchain
make format-check  # Prettier, without writing
make lint          # ESLint
make typecheck     # tsc over every project
make test          # run every package's tests
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers forking, what a pull request needs and the hooks'
prerequisites (python3 among them). You do not need Claude Code: `CLAUDE.md` and `.claude/`
instruct AI coding agents, and a human contributor can ignore them.

The development process (review gates, changelog fragments, release flow) comes from the
[Blueprint](https://gitlab.com/macrodream/blueprint) delivery harness, adapted to GitHub;
`CLAUDE.md` describes how it is used here.

## Credits

- Exchange rates: **Banka Slovenije** (www.bsi.si), _Dnevna tečajnica – referenčni tečaji ECB_
  and _Mesečna tečajnica_, CC BY 4.0. Values are reused unchanged.
- Form schemas: **FURS** eDavki (edavki.durs.si).
- Prior art that showed the way, especially [ib-edavki](https://github.com/ib-edavki/ib-edavki).

## License

[GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified version as a
service for others, you must publish your changes.
