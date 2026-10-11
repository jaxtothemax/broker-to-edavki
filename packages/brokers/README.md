# @taxreporter/brokers

Broker-export adapters. An adapter turns one broker's export format into the ledger events of
`@taxreporter/core`. Exchange rates, FIFO lot matching and XML generation are shared, so an adapter
never touches them. The package has no Node.js built-ins, so the browser app and the command-line
tool run the same code (`make build` enforces it through `tsconfig.build.json`).

The design is in [ADR 0004](../../docs/adr/0004-normalized-ledger-with-broker-adapters.md) (one
ledger, one adapter per format, every row accounted for) and
[ADR 0011](../../docs/adr/0011-import-contract-for-broker-files.md) (the import contract). The
pull-request checklist for a new adapter is in
[CONTRIBUTING.md](../../CONTRIBUTING.md#adding-a-broker-adapter).

## What is registered today

| Adapter         | Reads                                                   | Registered in  | Fixtures                        |
| --------------- | ------------------------------------------------------- | -------------- | ------------------------------- |
| `trading212`    | Trading 212 history export, CSV (four header revisions) | `CSV_ADAPTERS` | `test/fixtures/trading212/`     |
| `trading212Cfd` | Trading 212 CFD export, CSV (recognized only to refuse) | `CSV_ADAPTERS` | headers in `adapter.test.ts`    |
| `tradeRepublic` | Trade Republic transaction export, CSV (two revisions)  | `CSV_ADAPTERS` | `test/fixtures/trade-republic/` |
| `ibkr`          | Interactive Brokers Activity Flex Query, XML            | `XML_ADAPTERS` | `test/fixtures/ibkr/`           |

`XLSX_ADAPTERS` is empty: the XLSX reader is built, and no adapter uses it yet.

## How a file reaches an adapter

`importFile({ bytes, fileId, accountGroup })` in `src/adapter.ts` is the one way in, and the
pipeline behind both apps calls it. It sniffs the bytes, decodes them as strict UTF-8, and picks
the family by content: a ZIP is XLSX, text whose first non-blank character is `<` is XML, and
anything else is CSV. It then hands the file to the one adapter of that family that recognizes it.
A file that no adapter recognizes, or that more than one recognizes, is refused with a blocking
diagnostic (`unknownFormat`, `ambiguousFormat`). It is never read on a guess.

Detection is by header or structure, never by file name, and an adapter never sees the name.

## The interface an adapter implements

There is one interface per family. All three return an `ImportResult`, and `read` also gets a
`ReadContext` that holds the file's ID and its account group, and nothing else about the file.

| Family | Interface     | `matches` is given                       | `read` is given                                              |
| ------ | ------------- | ---------------------------------------- | ------------------------------------------------------------ |
| CSV    | `CsvAdapter`  | the header row and the delimiter it uses | the parsed `CsvTable`                                        |
| XML    | `XmlAdapter`  | the root element alone                   | the text, which it scans with the strict reader `src/xml.ts` |
| XLSX   | `XlsxAdapter` | the sheet list and the date system       | the opened `Workbook`                                        |

```ts
export interface CsvAdapter {
  readonly broker: string;
  matches(header: readonly string[], delimiter: CsvDelimiter): boolean;
  read(table: CsvTable, context: ReadContext): ImportResult;
}
```

An `ImportResult` holds the `broker`, the `format` it recognized (for example
`"trading212-csv-v4"`), the ledger `events`, the `diagnostics`, and the `reach` of each account the
file covers. The contract that makes an adapter safe to merge:

- **Every row is accounted for.** It becomes a ledger event, an explicit "ignored (reason)" record,
  or a blocking diagnostic. An unsupported corporate action is refused with a diagnostic, never
  guessed.
- **Every event carries its account, the broker's own clock (`at`) and a key** from core's
  `keyBuilder()`, or from `keyOf()` where the broker gives each row an ID it never reuses.
- **Dates come from core's `taxDate`**, never from a rule of the adapter's own.
- **Text copied from the file reaches a finding only through `untrusted()`.** No file name, account
  number or order ID may reach a finding or a log. A key takes such an ID only inside a SHA-256
  hash, so none survives in it as written (`keyOf()` hashes IBKR's transaction ID). A key is still
  a pseudonym, so it stays on the user's device and out of findings, exports and the LLM payload
  (`packages/core/src/keys.ts`, ADR 0011 §5).
- **The file is hostile.** Input is bounded, nothing in it is executed, and XML is read with
  `src/xml.ts`, which refuses a DOCTYPE and so resolves no entities. An adapter does not touch the
  network.

## Where a new adapter is registered

1. Write `src/<broker>.ts`, exporting an object that implements the interface of its family.
   `src/trade-republic.ts` is a worked CSV adapter and `src/ibkr.ts` a worked XML one.
2. Add the object to the frozen list of its family in `src/adapter.ts`: `CSV_ADAPTERS`,
   `XML_ADAPTERS` or `XLSX_ADAPTERS`. That is the registration. The CLI, the web worker and the
   pipeline all go through `importFile`, so they pick the adapter up without a change.
3. Export it from `src/index.ts` if code outside the package needs it.
4. For a CSV adapter, add each header it reads to `KNOWN` in `src/adapter.test.ts`. That test fails
   when a registered adapter has no known header, and when a header matches more than one adapter
   or matches with the wrong delimiter.
5. Give the broker a name in the web app: the `brokers` objects in `apps/web/src/i18n/messages.ts`
   and `apps/web/src/i18n/findings.ts` have a key for each broker that the app reads, in English
   and in Slovenian, and the `unknownFormat` texts in `findings.ts` list them.

## One fixture per export revision

Brokers change their export formats without notice, so every revision of an export that an adapter
knows has a fixture, under `test/fixtures/<broker>/`. A change to an adapter for a new header set
adds a fixture for it and keeps the old ones passing.

- A fixture is synthetic or anonymized: made-up IDs, names and amounts. A real export never enters
  the repository. Keep your own in the `private/` folder, which git ignores.
- The directory's `README.md` names each file, the revision it stands for, and where the header
  comes from, and it says plainly what has not yet been checked against a real export.
- Do not guess a header. A revision with no real example is marked as reconstructed or
  illustrative.
- Add a short note under `docs/research/` on where the format is documented and which fields are
  trusted.

## Tests

```bash
pnpm vitest run packages/brokers
```

Each adapter has a colocated test (`src/<broker>.test.ts`). `make test` runs every package, and
`make typecheck` catches drift between an adapter and the interfaces.
