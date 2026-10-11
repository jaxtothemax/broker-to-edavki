# Brand art

The published wordmarks of fund houses, bundled with the web app so a fund can
show its issuer's logo without fetching anything. `marks.json` is the manifest;
`../scripts/build-brand-marks.mjs` turns these files into
`../src/ui/brandMarks.ts`. A wordmark is shown only for a security the
importer recognized as a fund, matched by the start of the fund's name, so a
company whose name starts with the same word keeps its ticker tile. Fetching a
logo at run time would tell a third party which securities the user holds, so
there is no such path (CLAUDE.md, "Privacy").

## Every third-party mark the app bundles

The fund-house wordmarks here and the company logos in `../src/ui/logos.ts`
(from Simple Icons, built by `../scripts/build-logos.mjs`), with where each
came from and the terms its source gives. Whether to bundle them is the
project owner's trademark decision, and nothing in this file is legal advice:
the table is here so the decision can be made with every mark in view. A
company logo is shown only for the ISINs listed against it.

| Mark           | Kind                                          | Shown for                                           | Source                                                          | License                                              |
| -------------- | --------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| Vanguard       | Wordmark                                      | A fund whose name starts with `vanguard`            | <https://commons.wikimedia.org/wiki/File:Vanguard.svg>          | Public domain (Commons: PD textlogo), with trademark |
| iShares        | Wordmark, with a second mark: "by BlackRock"  | A fund whose name starts with `ishares`             | <https://commons.wikimedia.org/wiki/File:Logo-ishares_2019.svg> | Public domain (Commons: PD textlogo), with trademark |
| VanEck         | Wordmark                                      | A fund whose name starts with `vaneck` or `van eck` | <https://commons.wikimedia.org/wiki/File:Vaneck.svg>            | Public domain (Commons: PD textlogo), with trademark |
| Amundi         | Wordmark, with its tagline "ASSET MANAGEMENT" | A fund whose name starts with `amundi`              | <https://commons.wikimedia.org/wiki/File:Amundi_logo.svg>       | Public domain (Commons: PD textlogo), with trademark |
| Apple          | Symbol                                        | ISIN `US0378331005`                                 | simple-icons 16.34.0, `icons/apple.svg`                         | CC0-1.0                                              |
| NVIDIA         | Symbol                                        | ISIN `US67066G1040`                                 | simple-icons 16.34.0, `icons/nvidia.svg`                        | CC0-1.0                                              |
| Tesla          | Lettermark (T)                                | ISIN `US88160R1014`                                 | simple-icons 16.34.0, `icons/tesla.svg`                         | CC0-1.0                                              |
| Google         | Lettermark (G)                                | ISIN `US02079K3059`, ISIN `US02079K1079`            | simple-icons 16.34.0, `icons/google.svg`                        | CC0-1.0                                              |
| Meta           | Symbol                                        | ISIN `US30303M1027`                                 | simple-icons 16.34.0, `icons/meta.svg`                          | CC0-1.0                                              |
| Visa           | Wordmark                                      | ISIN `US92826C8394`                                 | simple-icons 16.34.0, `icons/visa.svg`                          | CC0-1.0                                              |
| MasterCard     | Symbol                                        | ISIN `US57636Q1040`                                 | simple-icons 16.34.0, `icons/mastercard.svg`                    | CC0-1.0                                              |
| Coca-Cola      | Wordmark                                      | ISIN `US1912161007`                                 | simple-icons 16.34.0, `icons/cocacola.svg`                      | CC0-1.0                                              |
| Netflix        | Lettermark (N)                                | ISIN `US64110L1061`                                 | simple-icons 16.34.0, `icons/netflix.svg`                       | CC0-1.0                                              |
| Intel          | Wordmark                                      | ISIN `US4581401001`                                 | simple-icons 16.34.0, `icons/intel.svg`                         | CC0-1.0                                              |
| AMD            | Wordmark, with its arrow                      | ISIN `US0079031078`                                 | simple-icons 16.34.0, `icons/amd.svg`                           | CC0-1.0                                              |
| AT&T           | Symbol                                        | ISIN `US00206R1023`                                 | simple-icons 16.34.0, `icons/atandt.svg`                        | CC0-1.0                                              |
| McDonald's     | Lettermark (M)                                | ISIN `US5801351017`                                 | simple-icons 16.34.0, `icons/mcdonalds.svg`                     | CC0-1.0                                              |
| Nike           | Symbol                                        | ISIN `US6541061031`                                 | simple-icons 16.34.0, `icons/nike.svg`                          | CC0-1.0                                              |
| Palantir       | Symbol                                        | ISIN `US69608A1088`                                 | simple-icons 16.34.0, `icons/palantir.svg`                      | CC0-1.0                                              |
| Qualcomm       | Lettermark (Q)                                | ISIN `US7475251036`                                 | simple-icons 16.34.0, `icons/qualcomm.svg`                      | CC0-1.0                                              |
| Uber           | Wordmark                                      | ISIN `US90353T1007`                                 | simple-icons 16.34.0, `icons/uber.svg`                          | CC0-1.0                                              |
| Airbnb         | Symbol                                        | ISIN `US0090661010`                                 | simple-icons 16.34.0, `icons/airbnb.svg`                        | CC0-1.0                                              |
| Coinbase       | Wordmark                                      | ISIN `US19260Q1076`                                 | simple-icons 16.34.0, `icons/coinbase.svg`                      | CC0-1.0                                              |
| PayPal         | Lettermark (PP)                               | ISIN `US70450Y1038`                                 | simple-icons 16.34.0, `icons/paypal.svg`                        | CC0-1.0                                              |
| Shopify        | Symbol, with an S                             | ISIN `CA82509L1076`                                 | simple-icons 16.34.0, `icons/shopify.svg`                       | CC0-1.0                                              |
| Spotify        | Symbol                                        | ISIN `LU1778762911`                                 | simple-icons 16.34.0, `icons/spotify.svg`                       | CC0-1.0                                              |
| Unilever       | Lettermark (U)                                | ISIN `GB00B10RZP78`                                 | simple-icons 16.34.0, `icons/unilever.svg`                      | CC0-1.0                                              |
| Shell          | Symbol                                        | ISIN `GB00BP6MXD84`                                 | simple-icons 16.34.0, `icons/shell.svg`                         | CC0-1.0                                              |
| SAP            | Wordmark                                      | ISIN `DE0007164600`                                 | simple-icons 16.34.0, `icons/sap.svg`                           | CC0-1.0                                              |
| Siemens        | Wordmark                                      | ISIN `DE0007236101`                                 | simple-icons 16.34.0, `icons/siemens.svg`                       | CC0-1.0                                              |
| Volkswagen     | Lettermark (VW)                               | ISIN `DE0007664039`                                 | simple-icons 16.34.0, `icons/volkswagen.svg`                    | CC0-1.0                                              |
| BMW            | Symbol, with the letters BMW                  | ISIN `DE0005190003`                                 | simple-icons 16.34.0, `icons/bmw.svg`                           | CC0-1.0                                              |
| Adidas         | Symbol                                        | ISIN `DE000A1EWWW0`                                 | simple-icons 16.34.0, `icons/adidas.svg`                        | CC0-1.0                                              |
| Boeing         | Symbol                                        | ISIN `US0970231058`                                 | simple-icons 16.34.0, `icons/boeing.svg`                        | CC0-1.0                                              |
| Cisco          | Wordmark, with its symbol                     | ISIN `US17275R1023`                                 | simple-icons 16.34.0, `icons/cisco.svg`                         | CC0-1.0                                              |
| Starbucks      | Symbol                                        | ISIN `US8552441094`                                 | simple-icons 16.34.0, `icons/starbucks.svg`                     | CC0-1.0                                              |
| Ford           | Wordmark, in its oval                         | ISIN `US3453708600`                                 | simple-icons 16.34.0, `icons/ford.svg`                          | CC0-1.0                                              |
| General Motors | Lettermark (gm)                               | ISIN `US37045V1008`                                 | simple-icons 16.34.0, `icons/generalmotors.svg`                 | CC0-1.0                                              |
| Goldman Sachs  | Wordmark                                      | ISIN `US38141G1040`                                 | simple-icons 16.34.0, `icons/goldmansachs.svg`                  | CC0-1.0                                              |
| Robinhood      | Symbol                                        | ISIN `US7707001027`                                 | simple-icons 16.34.0, `icons/robinhood.svg`                     | CC0-1.0                                              |
| Grab           | Wordmark                                      | ISIN `KYG4124C1096`                                 | simple-icons 16.34.0, `icons/grab.svg`                          | CC0-1.0                                              |
| Zoom           | Wordmark                                      | ISIN `US98980L1017`                                 | simple-icons 16.34.0, `icons/zoom.svg`                          | CC0-1.0                                              |
| Snowflake      | Symbol                                        | ISIN `US8334451098`                                 | simple-icons 16.34.0, `icons/snowflake.svg`                     | CC0-1.0                                              |
| Pinterest      | Lettermark (P)                                | ISIN `US72352L1061`                                 | simple-icons 16.34.0, `icons/pinterest.svg`                     | CC0-1.0                                              |
| Reddit         | Symbol                                        | ISIN `US75734B1008`                                 | simple-icons 16.34.0, `icons/reddit.svg`                        | CC0-1.0                                              |
| Roblox         | Symbol                                        | ISIN `US7710491033`                                 | simple-icons 16.34.0, `icons/roblox.svg`                        | CC0-1.0                                              |
| Ferrari        | Symbol                                        | ISIN `NL0011585146`                                 | simple-icons 16.34.0, `icons/ferrari.svg`                       | CC0-1.0                                              |
| Airbus         | Wordmark                                      | ISIN `NL0000235190`                                 | simple-icons 16.34.0, `icons/airbus.svg`                        | CC0-1.0                                              |
| Nokia          | Wordmark                                      | ISIN `FI0009000681`                                 | simple-icons 16.34.0, `icons/nokia.svg`                         | CC0-1.0                                              |

"PD textlogo" is Wikimedia Commons' tag for a logo too simple to be protected
by copyright, and CC0-1.0 is the license of the Simple Icons package (the
build takes no icon that has a license of its own; see the Simple Icons
disclaimer, <https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md>).
Neither says anything about trademark: each mark belongs to its owner and is
shown only to identify the security it belongs to, the wordmarks as published
and unaltered and the company logos as Simple Icons draws them. Commons' own
license metadata for each wordmark was read on 2026-10-11; the SHA-256 of each
downloaded original is in `marks.json`.

## What is committed

Each file is the original, normalized with svgo 3.3.2 (preset-default plus
`convertStyleToAttrs` and `removeDimensions`, as `marks.json` records) into
plain `<svg>`, `<g>` and `<path>` with `fill` attributes: the production CSP
(`style-src 'self'`) blocks inline styles. The generator runs no svgo itself.
The cleaned file renders the same as the original to anti-aliasing (compared
pixel by pixel at 800px wide when it was made). The generator accepts nothing
else: run on a file with a style, script, image, use, filter, gradient,
transform or any attribute it does not read, it fails. A test in
`../src/ui/kit.test.tsx` runs the generator's own reader over each committed
file and compares what it reads (every path's data, fill and fill rule, and
the viewBox) with the committed module.

## Adding a mark

1. Find a file whose license you can state. Read the file page, not a logo
   site: look at the picture too, since a search can return another company's
   logo with the same name (Commons' "Vanguard-logo-new.svg" is a healthcare
   company, and its "Vanguard logo mini.svg" is a PNG inside an SVG).
2. Normalize it, put it here, and add an entry to `marks.json` with its source
   URL, license, retrieval date, the SHA-256 of the original, and the
   SHA-256 of the committed file.
3. Run `node apps/web/scripts/build-brand-marks.mjs`, commit the module, and
   add a test name to `src/ui/kit.test.tsx` if the prefix has a spelling the
   existing cases do not cover.

Not here, for want of a mark under terms that could be stated: Sprott,
Invesco, WisdomTree, Global X, SPDR (State Street) and Xtrackers (DWS; the file
on Commons is a gradient, which cannot be flattened without altering it).
Their funds keep the ticker tile.
