#!/usr/bin/env node
/**
 * Checks a rebuilt rate snapshot (build-snapshot.mjs) before it may replace
 * the committed one: no rate already in the snapshot changed or vanished,
 * and BSI's daily list still matches the ECB's reference rates except on the
 * days already known (ADR 0005, src/refresh.ts). Run by the `rates`
 * workflow after every rebuild.
 *
 *   pnpm --filter "@taxreporter/fx..." build
 *   node packages/fx/scripts/check-snapshot.mjs --self-test
 *   node packages/fx/scripts/check-snapshot.mjs               # downloads the ECB history
 *   node packages/fx/scripts/check-snapshot.mjs --ecb FILE    # eurofxref-hist.csv already downloaded
 *
 * The committed snapshot is read from git (`--base`, HEAD by default); the
 * rebuilt one from packages/fx/data/.
 *
 * Exit 0: the rebuilt snapshot may replace the committed one. Prints
 * whether its rates changed at all, and writes `changed=true|false` and
 * `through=<completeThrough>` to $GITHUB_OUTPUT when that is set.
 * Exit 1: a finding, listed. Nothing may be proposed until a person has
 * looked: either the download is wrong, or a published rate changed, which
 * is a tax-rule change needing a primary source (CLAUDE.md).
 * Exit 2: the check could not run (no ECB history, a file it cannot read).
 */
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { ecbDifferences, historyChanges } from "../dist/index.js";

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip";
const ECB_FILE = "eurofxref-hist.csv";
const USER_AGENT =
  "TaxReporter rate snapshot (+https://github.com/jaxtothemax/broker-to-edavki)";
const DATA = "packages/fx/data";

const { values } = parseArgs({
  options: {
    "self-test": { type: "boolean", default: false },
    ecb: { type: "string" },
    base: { type: "string", default: "HEAD" },
  },
});

/** Every finding about a rebuilt snapshot, as lines to print. */
function findings({
  oldDaily,
  newDaily,
  oldMonthly,
  newMonthly,
  through,
  ecb,
}) {
  const lines = [];
  for (const change of [
    ...historyChanges("daily", oldDaily, newDaily, through),
    ...historyChanges("monthly", oldMonthly, newMonthly, through),
  ]) {
    lines.push(
      `history: ${change.list} ${change.key} ${change.currency} was ${change.before}, now ${change.after ?? "missing"}`,
    );
  }
  for (const d of ecbDifferences(newDaily, ecb)) {
    lines.push(
      `ecb: ${d.date} ${d.currency} BSI ${d.bsi}, ECB ${d.ecb} (not a known discrepancy)`,
    );
  }
  return lines;
}

function selfTest() {
  const daily =
    "date,NOK,USD\n2025-10-22,11.6000,1.1600\n2025-10-23,11.8529,1.1610\n";
  const monthly = "valid_from,date,TWD\n2025-10-01,2025-09-30,35.5\n";
  const ecb =
    "Date,USD,NOK,\n2025-10-23,1.1610,11.5829,\n2025-10-22,1.16,11.6,\n";
  const base = {
    oldDaily: daily,
    newDaily: `${daily}2025-10-24,11.6100,1.1620\n`,
    oldMonthly: monthly,
    newMonthly: monthly,
    through: "2025-10-23",
    ecb,
  };
  const cases = [
    ["a refresh that only adds lists passes", base, 0],
    [
      "a changed historical rate is a finding",
      { ...base, newDaily: base.newDaily.replace("1.1600", "1.1700") },
      2, // the history change, and its new difference from the ECB
    ],
    [
      "a dropped historical list is a finding",
      {
        ...base,
        newDaily: base.newDaily.replace("2025-10-22,11.6000,1.1600\n", ""),
      },
      2,
    ],
    [
      "a changed monthly rate is a finding",
      { ...base, oldMonthly: monthly.replace("2025-10-01", "2025-09-01") },
      1,
    ],
    [
      "a new difference from the ECB is a finding",
      { ...base, ecb: ecb.replace("1.1610", "1.1620") },
      1,
    ],
  ];
  let failed = 0;
  for (const [name, input, expected] of cases) {
    const got = findings(input).length;
    if (got === expected) {
      console.log(`SELF-TEST OK: ${name}`);
    } else {
      failed += 1;
      console.log(
        `SELF-TEST FAILED: ${name} (${String(got)} findings, expected ${String(expected)})`,
      );
    }
  }
  console.log(
    `check-snapshot: self-test ran ${String(cases.length)} case(s), ${String(failed)} failed`,
  );
  if (failed > 0) process.exit(1);
  console.log("check-snapshot: SELF-TEST OK");
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function ecbHistory() {
  if (values.ecb !== undefined) return readFileSync(values.ecb, "utf8");
  const response = await fetch(ECB_URL, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`${ECB_URL}: HTTP ${String(response.status)}`);
  const dir = mkdtempSync(join(tmpdir(), "ecb-"));
  const zip = join(dir, "eurofxref-hist.zip");
  writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  return execFileSync("unzip", ["-p", zip, ECB_FILE], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

if (values["self-test"]) {
  selfTest();
  process.exit(0);
}

let input;
try {
  const old = (file) => git("show", `${values.base}:${DATA}/${file}`);
  const now = (file) => readFileSync(join(DATA, file), "utf8");
  input = {
    oldDaily: old("bsi-daily.csv"),
    newDaily: now("bsi-daily.csv"),
    oldMonthly: old("bsi-monthly.csv"),
    newMonthly: now("bsi-monthly.csv"),
    through: JSON.parse(old("snapshot.json")).completeThrough,
    ecb: await ecbHistory(),
  };
} catch (error) {
  console.error(
    `check-snapshot: could not run: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}

const found = findings(input);
if (found.length > 0) {
  console.error(
    `check-snapshot: ${String(found.length)} finding(s); the refresh is stopped:`,
  );
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}

const changed =
  input.oldDaily !== input.newDaily || input.oldMonthly !== input.newMonthly;
const through = JSON.parse(
  readFileSync(join(DATA, "snapshot.json"), "utf8"),
).completeThrough;
console.log(
  changed
    ? `check-snapshot: OK, new rates through ${through}`
    : "check-snapshot: OK, no new rates",
);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `changed=${String(changed)}\nthrough=${through}\n`,
  );
}
