# Brand art

The published wordmarks of fund houses, bundled with the web app so a fund can
show its issuer's logo without fetching anything. `marks.json` is the manifest;
`../scripts/build-brand-marks.mjs` turns these files into
`../src/ui/brandMarks.ts`. Fetching a logo at run time would tell a third party
which securities the user holds, so there is no such path (CLAUDE.md, "Privacy").

| Mark     | Matches names starting with | Source                                                          | Terms                                       |
| -------- | --------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| Vanguard | `vanguard`                  | <https://commons.wikimedia.org/wiki/File:Vanguard.svg>          | Public domain (PD textlogo), with trademark |
| iShares  | `ishares`                   | <https://commons.wikimedia.org/wiki/File:Logo-ishares_2019.svg> | Public domain (PD textlogo), with trademark |
| VanEck   | `vaneck`, `van eck`         | <https://commons.wikimedia.org/wiki/File:Vaneck.svg>            | Public domain (PD textlogo), with trademark |
| Amundi   | `amundi`                    | <https://commons.wikimedia.org/wiki/File:Amundi_logo.svg>       | Public domain (PD textlogo), with trademark |

"PD textlogo" is Wikimedia Commons' tag for a logo too simple to be protected
by copyright. It says nothing about trademark: each mark belongs to its owner
and is shown only to identify the fund it belongs to, as published and
unaltered. Commons' own license metadata for each file was read on 2026-10-11;
the SHA-256 of each downloaded original is in `marks.json`.

## What is committed

Each file is the original, normalized with svgo 3.3.2 (preset-default plus
`convertStyleToAttrs`, `removeDimensions`, and `removeStyleElement`) into plain `<svg>`, `<g>` and
`<path>` with `fill` attributes: the production CSP (`style-src 'self'`) blocks
inline styles. The cleaned file renders the same as the original to
anti-aliasing (compared pixel by pixel at 800px wide when it was made). The
generator accepts nothing else and fails the build on a style, script, image,
use, filter, gradient, transform or any attribute it does not read.

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
