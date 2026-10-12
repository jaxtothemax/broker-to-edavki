import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONTENT_SECURITY_POLICY } from "../../content-security-policy.mjs";

// The check is a command-line script, so these tests run it the way the
// web-app and website-build jobs do: as a child process on a build output
// directory, and they demand the exact exit code and the message. Importing it
// would hide a crash behind a thrown exception.

const SCRIPT = fileURLToPath(
  new URL("./check-pages-build.mjs", import.meta.url),
);
const BASE = "/broker-to-edavki/app/";
const POLICY_MODULE = "apps/web/content-security-policy.mjs";
const MISSING = "no Content Security Policy <meta http-equiv> tag";

/** An attribute value escaped as Vite writes it (escape-html). */
function escapeAttribute(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
    "<": "&lt;",
    ">": "&gt;",
  };
  let escaped = "";
  for (const char of value) escaped += entities[char] ?? char;
  return escaped;
}

/** The policy as the build writes it into the content attribute. */
const ESCAPED_POLICY = escapeAttribute(CONTENT_SECURITY_POLICY);

/**
 * The shape `pnpm --filter @taxreporter/web build` emits with
 * TAXREPORTER_WEB_BASE=/broker-to-edavki/app/: the policy first in <head> with
 * character references in it, a valueless `crossorigin`, a <noscript> block, no
 * modulepreload.
 */
const BUILT_INDEX = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta http-equiv="Content-Security-Policy" content="${ESCAPED_POLICY}">

    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>TaxReporter</title>
    <script type="module" crossorigin src="/broker-to-edavki/app/assets/index-Dh8ySHaT.js"></script>
    <link rel="stylesheet" crossorigin href="/broker-to-edavki/app/assets/index-B63ZUsys.css">
  </head>
  <body>
    <noscript>
      <p lang="en">
        TaxReporter needs JavaScript: all processing happens in your browser.
      </p>
    </noscript>
    <div id="root"></div>
  </body>
</html>
`;

const BUILT_FILES = ["assets/index-Dh8ySHaT.js", "assets/index-B63ZUsys.css"];

const CSP_LINE =
  BUILT_INDEX.split("\n").find((line) =>
    line.includes("Content-Security-Policy"),
  ) ?? "";
const SCRIPT_LINE =
  BUILT_INDEX.split("\n").find((line) => line.includes("<script")) ?? "";
const LINK_LINE =
  BUILT_INDEX.split("\n").find((line) => line.includes('rel="stylesheet"')) ??
  "";

interface Outcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

let root = "";
let counter = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "check-pages-build-test-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes an output directory with `html` as index.html and empty `files`. */
function makeDist(
  html: string,
  files: readonly string[] = BUILT_FILES,
): string {
  counter += 1;
  const dist = join(root, `dist-${String(counter)}`);
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), html);
  for (const file of files) {
    mkdirSync(dirname(join(dist, file)), { recursive: true });
    writeFileSync(join(dist, file), "");
  }
  return dist;
}

function run(args: readonly string[]): Outcome {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 20_000,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function check(
  html: string,
  base = BASE,
  files: readonly string[] = BUILT_FILES,
): Outcome {
  return run([makeDist(html, files), base]);
}

/** A copy of the built page with `from` replaced; fails loudly if `from` is absent. */
function swap(from: string, to: string, html = BUILT_INDEX): string {
  if (!html.includes(from))
    throw new Error(`fixture does not contain: ${from}`);
  return html.replace(from, () => to);
}

function expectRejected(outcome: Outcome, message: string): void {
  expect(outcome.stderr).toContain(message);
  expect(outcome.stderr).toContain("check-pages-build: FAILED");
  expect(outcome.stdout).not.toContain("check-pages-build: OK");
  expect(outcome.status).toBe(1);
}

describe("check-pages-build: a build that should pass", () => {
  it("accepts the build output as Vite emits it", () => {
    const outcome = check(BUILT_INDEX);
    expect(outcome.stdout).toContain(
      "1 script, 1 stylesheet and 0 modulepreload URL(s) checked, 0 inline script(s), Content Security Policy meta present",
    );
    expect(outcome.stdout).toContain("check-pages-build: OK");
    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
  });

  it("checks a modulepreload link too", () => {
    const html = swap(
      LINK_LINE,
      `${LINK_LINE}\n    <link rel="modulepreload" crossorigin href="${BASE}assets/snapshot-x.js">`,
    );
    const outcome = check(html, BASE, [...BUILT_FILES, "assets/snapshot-x.js"]);
    expect(outcome.stdout).toContain(
      "1 script, 1 stylesheet and 1 modulepreload URL(s) checked",
    );
    expect(outcome.status).toBe(0);
  });

  it("accepts a site served at the root, where the app lives under /app/", () => {
    const html = BUILT_INDEX.replaceAll("/broker-to-edavki/app/", "/app/");
    const outcome = check(html, "/app/");
    expect(outcome.stdout).toContain("check-pages-build: OK");
    expect(outcome.status).toBe(0);
  });

  it("reads tags and attributes the way a browser does", () => {
    const html = BUILT_INDEX.replace(
      SCRIPT_LINE,
      `<SCRIPT TYPE=module SRC='${BASE}assets/index-Dh8ySHaT.js'></SCRIPT >`,
    ).replace(CSP_LINE, CSP_LINE.replace("http-equiv", "HTTP-EQUIV"));
    const outcome = check(html);
    expect(outcome.stdout).toContain("check-pages-build: OK");
    expect(outcome.status).toBe(0);
  });

  it("ignores a script, stylesheet or policy that sits inside a comment", () => {
    const html = swap(
      "<title>",
      `<!-- <script>alert(1)</script> <link rel="stylesheet" href="https://cdn.example/a.css"> -->\n    <title>`,
    );
    const outcome = check(html);
    expect(outcome.stdout).toContain("1 script, 1 stylesheet");
    expect(outcome.status).toBe(0);
  });

  it("does not read markup in a title as tags", () => {
    const outcome = check(
      swap(
        "<title>TaxReporter</title>",
        '<title>a <script src="//x"> b</title>',
      ),
    );
    expect(outcome.stdout).toContain("check-pages-build: OK");
    expect(outcome.status).toBe(0);
  });
});

describe("check-pages-build: the Content Security Policy meta tag", () => {
  const cases: readonly [string, string][] = [
    ["is missing", swap(CSP_LINE, "")],
    [
      "has an empty content attribute",
      swap('content="default-src', 'content="" data-x="default-src'),
    ],
    [
      "has a blank content attribute",
      swap('content="default-src', 'content="   " data-x="default-src'),
    ],
    [
      "has no content attribute",
      swap('content="default-src', 'data-x="default-src'),
    ],
    [
      "is a different http-equiv",
      swap(
        'http-equiv="Content-Security-Policy"',
        'http-equiv="X-UA-Compatible"',
      ),
    ],
    ["sits inside a comment", swap(CSP_LINE, `<!-- ${CSP_LINE} -->`)],
    [
      "sits inside a comment closed by --!>",
      swap(CSP_LINE, `<!-- ${CSP_LINE} --!>`),
    ],
    [
      "sits in the body, where a browser ignores it",
      swap(CSP_LINE, "").replace(
        '<div id="root">',
        `${CSP_LINE}<div id="root">`,
      ),
    ],
  ];

  it.each(cases)("is rejected when it %s", (_name, html) => {
    expectRejected(check(html), MISSING);
  });

  it("is rejected when a script comes before it", () => {
    const html = swap(
      CSP_LINE,
      `${SCRIPT_LINE}\n${CSP_LINE}`,
      swap(SCRIPT_LINE, ""),
    );
    const outcome = check(html);
    expectRejected(outcome, MISSING);
    expect(outcome.stderr).toContain(
      "<script> at line 4 comes before the Content Security Policy <meta> tag at line 5",
    );
  });

  it("is rejected when a stylesheet comes before it", () => {
    const html = swap(
      CSP_LINE,
      `${LINK_LINE}\n${CSP_LINE}`,
      swap(LINK_LINE, ""),
    );
    expectRejected(
      check(html),
      "<link> at line 4 comes before the Content Security Policy <meta> tag at line 5",
    );
  });

  it("is rejected further down <head>, after the other meta tags", () => {
    const html = swap(
      LINK_LINE,
      `${LINK_LINE}\n${CSP_LINE}`,
      swap(CSP_LINE, ""),
    );
    expectRejected(
      check(html),
      "<meta> at line 6 comes before the Content Security Policy <meta> tag at line 12",
    );
  });

  it("is reported even when everything else is wrong too", () => {
    const outcome = check(swap(CSP_LINE, "<script>1</script>"));
    expect(outcome.stderr).toContain("no Content Security Policy");
    expect(outcome.stderr).toContain("inline <script>");
    expect(outcome.status).toBe(1);
  });
});

// Vite injects the tag with head-prepend, so the check demands exactly that:
// before it, only a doctype, comments, whitespace, <html> and the first <head>.
// Each shape below keeps the tag "inside <head>" to a reader that only tracks
// <head> and </head>, while a browser applies no policy at all: the tag is raw
// text (noscript with scripting on, noframes, noembed, iframe, xmp, plaintext),
// inert (template), or in <body> because <head> closed early (a <div>, text) or
// because a second <head> is ignored.
describe("check-pages-build: the policy tag comes first in <head>", () => {
  const META = CSP_LINE.trim();
  const misplaced: readonly [string, string, string][] = [
    ["inside <noscript>", `<noscript>${META}</noscript>`, "<noscript>"],
    ["inside <template>", `<template>${META}</template>`, "<template>"],
    ["inside <noframes>", `<noframes>${META}</noframes>`, "<noframes>"],
    ["inside <iframe>", `<iframe>${META}</iframe>`, "<iframe>"],
    ["inside <noembed>", `<noembed>${META}</noembed>`, "<noembed>"],
    ["inside <xmp>", `<xmp>${META}</xmp>`, "<xmp>"],
    ["after <plaintext>", `<plaintext>${META}`, "<plaintext>"],
    ["after a <div>", `<div></div>${META}`, "<div>"],
    ["after stray text", `TaxReporter ${META}`, "text"],
    ["after a non-breaking space", `&nbsp;${META}`, "text"],
    ["after a literal < that a browser reads as text", `< ${META}`, "text"],
    ["after a <title>", `<title>x</title>${META}`, "<title>"],
    ["after a <base>", `<base href="/">${META}`, "<base>"],
    ["after a second <html>", `<html>${META}`, "<html>"],
    ["after a second <head>", `<head>${META}`, "<head>"],
    [
      "after a misplaced doctype",
      `<!doctype html>${META}`,
      "a misplaced <!doctype>",
    ],
    [
      "after an XML declaration",
      `<?xml version="1.0"?>${META}`,
      'a "<!" or "<?" declaration',
    ],
  ];

  it.each(misplaced)("rejects the tag %s", (_name, line, named) => {
    const outcome = check(swap(CSP_LINE, `    ${line}`));
    expectRejected(outcome, MISSING);
    expect(outcome.stderr).toContain(
      `${named} at line 4 comes before the Content Security Policy <meta> tag at line 4`,
    );
    expect(outcome.stdout).toContain(
      "Content Security Policy meta not first in <head>",
    );
  });

  it("rejects a tag after a closed <head> and a second one, which a browser ignores", () => {
    const html = swap("  <head>\n", "  <head></head><body><head>\n");
    expectRejected(
      check(html),
      "</head> at line 3 comes before the Content Security Policy <meta> tag at line 4",
    );
  });

  it("accepts comments and whitespace before the tag", () => {
    const html = swap(
      "<!doctype html>\n",
      "<!-- built -->\n<!doctype html>\n<!-- x -->",
      swap(CSP_LINE, `    <!-- policy -->\n\n${CSP_LINE}`),
    );
    const outcome = check(html);
    expect(outcome.stdout).toContain("Content Security Policy meta present");
    expect(outcome.status).toBe(0);
  });

  it("accepts a page that leaves <html> and <head> implied", () => {
    const html = swap('<html lang="en" data-theme="dark">\n  <head>\n', "");
    const outcome = check(html);
    expect(outcome.stdout).toContain("check-pages-build: OK");
    expect(outcome.status).toBe(0);
  });

  it("accepts upper-case tag and attribute names", () => {
    const html = swap(
      `<!doctype html>\n<html lang="en" data-theme="dark">\n  <head>\n${CSP_LINE}`,
      `<!DOCTYPE HTML>\n<HTML LANG="en">\n  <HEAD>\n    <META HTTP-EQUIV="CONTENT-SECURITY-POLICY" CONTENT="${ESCAPED_POLICY}">`,
    );
    const outcome = check(html);
    expect(outcome.stdout).toContain("check-pages-build: OK");
    expect(outcome.status).toBe(0);
  });

  it("accepts reordered, unquoted, slash-separated and character-referenced attributes", () => {
    const html = swap(
      CSP_LINE,
      `    <meta/content='${CONTENT_SECURITY_POLICY.replaceAll("'", "&apos;")}'/http-equiv=Content-Security-Polic&#x79;>`,
    );
    const outcome = check(html);
    expect(outcome.stdout).toContain("check-pages-build: OK");
    expect(outcome.status).toBe(0);
  });

  it("reads only the first of a repeated http-equiv, as a browser does", () => {
    const html = swap(
      'http-equiv="Content-Security-Policy"',
      'http-equiv="refresh" http-equiv="Content-Security-Policy"',
    );
    expectRejected(check(html), MISSING);
  });

  it("does not read an http-equiv with a character reference it cannot decode", () => {
    const html = swap(
      'http-equiv="Content-Security-Policy"',
      'http-equiv="Content-Security-Polic&yacute;"',
    );
    expectRejected(check(html), MISSING);
  });
});

describe("check-pages-build: the policy is the one vite.config.ts injects", () => {
  const wrong: readonly [string, string][] = [
    ["a permissive policy", "script-src * 'unsafe-inline' 'unsafe-eval'"],
    [
      "a wildcard connect-src",
      CONTENT_SECURITY_POLICY.replace("connect-src 'self'", "connect-src *"),
    ],
    [
      "an extra directive",
      `${CONTENT_SECURITY_POLICY}; script-src-elem 'unsafe-inline'`,
    ],
    [
      "a missing directive",
      CONTENT_SECURITY_POLICY.replace("; object-src 'none'", ""),
    ],
    [
      "only default-src and script-src",
      "default-src 'self'; script-src 'self'",
    ],
    ["the policy with a trailing semicolon", `${CONTENT_SECURITY_POLICY};`],
  ];

  it.each(wrong)("rejects %s", (_name, policy) => {
    const outcome = check(swap(ESCAPED_POLICY, escapeAttribute(policy)));
    expectRejected(outcome, `is not the policy in ${POLICY_MODULE}`);
    expect(outcome.stdout).toContain(
      "Content Security Policy meta not the expected policy",
    );
  });

  it("accepts the policy with plain apostrophes, which a browser reads the same", () => {
    const html = swap(ESCAPED_POLICY, CONTENT_SECURITY_POLICY);
    const outcome = check(html);
    expect(outcome.stdout).toContain("Content Security Policy meta present");
    expect(outcome.status).toBe(0);
  });

  it("decodes character references once, so a double-escaped policy is a mismatch", () => {
    const html = swap(
      ESCAPED_POLICY,
      ESCAPED_POLICY.replaceAll("&#39;", "&amp;#39;"),
    );
    expectRejected(check(html), `is not the policy in ${POLICY_MODULE}`);
  });

  it("rejects a policy holding a character reference it does not decode", () => {
    const html = swap(
      ESCAPED_POLICY,
      ESCAPED_POLICY.replace("&#39;self&#39;", "&lsquo;self&rsquo;"),
    );
    expectRejected(check(html), `is not the policy in ${POLICY_MODULE}`);
  });

  it("reads only the first of a repeated content attribute, as a browser does", () => {
    const html = swap(
      `content="${ESCAPED_POLICY}"`,
      `content="default-src *" content="${ESCAPED_POLICY}"`,
    );
    expectRejected(check(html), 'its content is "default-src *"');
  });

  it("quotes the policy so a newline in it cannot start a log line of its own", () => {
    const html = swap(ESCAPED_POLICY, "x&#10;::error::injected");
    const outcome = check(html);
    expectRejected(
      outcome,
      String.raw`its content is "x&#10;::error::injected"`,
    );
    const raw = swap(ESCAPED_POLICY, "x\n::error::injected");
    const rawOutcome = check(raw);
    expectRejected(
      rawOutcome,
      String.raw`its content is "x\n::error::injected"`,
    );
    expect(
      rawOutcome.stderr.split("\n").some((line) => line.startsWith("::")),
    ).toBe(false);
  });
});

// Inside svg and math, <title>, <style> and <textarea> are ordinary elements,
// so a <script> in them runs. A reader that takes them for raw text skips it.
describe("check-pages-build: no foreign content", () => {
  const foreign: readonly [string, string, string][] = [
    [
      "a script in an SVG <title>",
      "<svg><title><script>alert(1)</script></title></svg>",
      "<svg>",
    ],
    [
      "a script in an SVG <style>",
      "<svg><style><script>alert(1)</script></style></svg>",
      "<svg>",
    ],
    [
      "a script in a MathML <textarea>",
      "<math><textarea><script>alert(1)</script></textarea></math>",
      "<math>",
    ],
    ["an upper-case <SVG>", "<SVG></SVG>", "<svg>"],
    ["an empty <math>", "<math></math>", "<math>"],
  ];

  it.each(foreign)("rejects %s", (_name, element, named) => {
    const outcome = check(
      swap('<div id="root"></div>', `<div id="root"></div>${element}`),
    );
    expectRejected(
      outcome,
      `${named} at line 19: index.html may not contain svg or math`,
    );
  });

  it("does not take the word svg inside a title for an element", () => {
    const outcome = check(
      swap("<title>TaxReporter</title>", "<title>a <svg> b</title>"),
    );
    expect(outcome.stdout).toContain("check-pages-build: OK");
    expect(outcome.status).toBe(0);
  });
});

// A refresh, a <base>, a <form> or a frame can take the page, or what is typed
// into it, somewhere else, and the app's index.html has none. A refresh is a
// navigation no policy directive governs.
describe("check-pages-build: nothing that sends the page elsewhere", () => {
  const navigating: readonly [string, string, string][] = [
    [
      "a refresh",
      '<meta http-equiv="refresh" content="0; url=https://example.invalid/">',
      '<meta http-equiv="refresh">',
    ],
    [
      "an upper-case, unquoted refresh",
      "<META HTTP-EQUIV=REFRESH CONTENT=0>",
      '<meta http-equiv="REFRESH">',
    ],
    [
      "a refresh spelled with a character reference",
      '<meta http-equiv="&#114;efresh" content="0">',
      '<meta http-equiv="&#114;efresh">',
    ],
    [
      "an http-equiv with a character reference it cannot decode",
      '<meta http-equiv="re&shy;fresh" content="0">',
      '<meta http-equiv="re&shy;fresh">',
    ],
    ["an <iframe>", `<iframe src="${BASE}x.html"></iframe>`, "<iframe>"],
    ["a <frame>", "<frame>", "<frame>"],
    ["a <frameset>", "<frameset></frameset>", "<frameset>"],
    [
      "a <form>",
      '<form action="https://example.invalid/"><input name="t"></form>',
      "<form>",
    ],
    ["a <base>", '<base href="https://example.invalid/">', "<base>"],
  ];

  it.each(navigating)("rejects %s", (_name, element, named) => {
    const outcome = check(
      swap('<div id="root"></div>', `<div id="root"></div>${element}`),
    );
    expectRejected(
      outcome,
      `${named} at line 19: index.html may not contain a refresh`,
    );
  });
});

// The policy is in index.html and covers that page only, so any other page in
// the output (an .html or .svg file) would be published on the app's origin
// with no policy at all. The build writes index.html and, under assets/, its
// scripts, stylesheet and fonts.
describe("check-pages-build: only the files a build writes", () => {
  const LAYOUT = "is not index.html at the root";

  it("accepts the scripts, stylesheet and fonts the build writes under assets/", () => {
    const outcome = check(BUILT_INDEX, BASE, [
      ...BUILT_FILES,
      "assets/engine.worker-Bq3x_9-Z.js",
      "assets/geist-latin-wght-normal-DnRx1Ksa.woff2",
      "assets/geist-mono-latin-wght-normal-Cz3P8_0e.woff",
    ]);
    expect(outcome.stdout).toContain("6 allowed file(s) in the output");
    expect(outcome.stdout).toContain("check-pages-build: OK");
    expect(outcome.status).toBe(0);
  });

  const extra: readonly [string, string, string][] = [
    ["another page at the root", "about.html", '"about.html" (a file)'],
    [
      "a page under assets/",
      "assets/index.html",
      '"assets/index.html" (a file)',
    ],
    [
      "an SVG image under assets/",
      "assets/logo.svg",
      '"assets/logo.svg" (a file)',
    ],
    [
      "a source map",
      "assets/index-Dh8ySHaT.js.map",
      '"assets/index-Dh8ySHaT.js.map" (a file)',
    ],
    [
      "an upper-case extension",
      "assets/index-X.JS",
      '"assets/index-X.JS" (a file)',
    ],
    ["a name that starts with a dot", "assets/.js", '"assets/.js" (a file)'],
    ["a script at the root", "index.js", '"index.js" (a file)'],
    [
      "a script one directory deeper",
      "assets/nested/x.js",
      '"assets/nested" (a directory)',
    ],
    [
      "a second copy of the app one directory deeper",
      "app/index.html",
      '"app" (a directory)',
    ],
    ["a .nojekyll marker", ".nojekyll", '".nojekyll" (a file)'],
  ];

  it.each(extra)("rejects %s", (_name, file, named) => {
    expectRejected(
      check(BUILT_INDEX, BASE, [...BUILT_FILES, file]),
      `${named} ${LAYOUT}`,
    );
  });

  it("rejects an empty directory", () => {
    const dist = makeDist(BUILT_INDEX);
    mkdirSync(join(dist, "empty"));
    expectRejected(run([dist, BASE]), `"empty" (a directory) ${LAYOUT}`);
  });

  it("rejects a symbolic link, even to a file of the build, without following it", () => {
    const dist = makeDist(BUILT_INDEX);
    symlinkSync(join(dist, "index.html"), join(dist, "assets", "page.css"));
    expectRejected(
      run([dist, BASE]),
      `"assets/page.css" (a symbolic link) ${LAYOUT}`,
    );
  });

  it("rejects an index.html that is a symbolic link, and does not read through it", () => {
    const dist = makeDist(BUILT_INDEX);
    const elsewhere = join(root, `elsewhere-${String(counter)}.html`);
    writeFileSync(elsewhere, BUILT_INDEX);
    rmSync(join(dist, "index.html"));
    symlinkSync(elsewhere, join(dist, "index.html"));
    const outcome = run([dist, BASE]);
    expectRejected(outcome, `"index.html" (a symbolic link) ${LAYOUT}`);
    expect(outcome.stderr).toContain(
      "index.html is not a regular file, so it is not read",
    );
    expect(outcome.stdout).toContain("Content Security Policy meta missing");
  });

  it("quotes a file name so a newline in it cannot start a log line of its own", () => {
    const outcome = check(BUILT_INDEX, BASE, [
      ...BUILT_FILES,
      "assets/x\n::error::y.html",
    ]);
    expectRejected(outcome, String.raw`"assets/x\n::error::y.html" (a file)`);
    expect(
      outcome.stderr.split("\n").some((line) => line.startsWith("::")),
    ).toBe(false);
  });

  it("stops listing a directory past 1000 entries", () => {
    const many = Array.from(
      { length: 1001 },
      (_, at) => `assets/chunk-${String(at)}.js`,
    );
    expectRejected(
      check(BUILT_INDEX, BASE, [...BUILT_FILES, ...many]),
      "a directory of the output holds more than 1000 entries",
    );
  });
});

describe("check-pages-build: URLs outside the expected base", () => {
  const scriptUrls: readonly [string, string][] = [
    [
      "an absolute URL on another host",
      "https://cdn.example/assets/index-Dh8ySHaT.js",
    ],
    ["a protocol-relative URL", "//cdn.example/assets/index-Dh8ySHaT.js"],
    ["the site root instead of the app base", "/assets/index-Dh8ySHaT.js"],
    [
      "the docs base without app/",
      "/broker-to-edavki/assets/index-Dh8ySHaT.js",
    ],
    [
      "a sibling directory that shares the prefix",
      "/broker-to-edavki/application/assets/index-Dh8ySHaT.js",
    ],
    ["a relative path", "assets/index-Dh8ySHaT.js"],
    ["a dot-relative path", "./assets/index-Dh8ySHaT.js"],
    ["a data URL", "data:text/javascript,alert(1)"],
    ["an empty URL", ""],
  ];

  it.each(scriptUrls)("rejects a script from %s", (_name, url) => {
    const html = swap("/broker-to-edavki/app/assets/index-Dh8ySHaT.js", url);
    expectRejected(check(html), "<script src>");
  });

  it("rejects a stylesheet outside the base", () => {
    const html = swap(
      "/broker-to-edavki/app/assets/index-B63ZUsys.css",
      "/assets/index-B63ZUsys.css",
    );
    expectRejected(
      check(html),
      '<link rel="stylesheet" href> "/assets/index-B63ZUsys.css"',
    );
  });

  it("rejects a modulepreload outside the base", () => {
    const html = swap(
      LINK_LINE,
      `${LINK_LINE}\n<link rel="modulepreload" href="https://cdn.example/x.js">`,
    );
    expectRejected(
      check(html),
      '<link rel="modulepreload" href> "https://cdn.example/x.js"',
    );
  });

  it("rejects a link whose rel lists several tokens, one of them stylesheet", () => {
    const html = swap('rel="stylesheet"', 'rel="alternate STYLESHEET"');
    const outcome = check(
      swap("/broker-to-edavki/app/assets/index-B63ZUsys.css", "/x.css", html),
    );
    expectRejected(outcome, "is not under /broker-to-edavki/app/");
  });

  const tricky: readonly [string, string, string][] = [
    [
      "a dot-dot segment",
      "/broker-to-edavki/app/../evil.js",
      "normalized form",
    ],
    [
      "a dot segment",
      "/broker-to-edavki/app/./assets/index-Dh8ySHaT.js",
      "normalized form",
    ],
    [
      "an encoded dot-dot segment",
      "/broker-to-edavki/app/%2e%2e/evil.js",
      "normalized form",
    ],
    [
      "a backslash",
      "/broker-to-edavki/app/assets\\..\\evil.js",
      "normalized form",
    ],
    [
      "a character reference",
      "/broker-to-edavki/app/assets/&#46;&#46;/evil.js",
      "character references",
    ],
    [
      "an encoded slash that decodes to a traversal",
      "/broker-to-edavki/app/..%2f..%2fevil.js",
      "not in the build output",
    ],
  ];

  it.each(tricky)("rejects %s", (_name, url, message) => {
    const html = swap("/broker-to-edavki/app/assets/index-Dh8ySHaT.js", url);
    const outcome = check(html);
    expect(outcome.stderr).toContain(message);
    expect(outcome.status).toBe(1);
  });

  it("rejects an encoded slash that decodes outside the output directory", () => {
    const html = swap(
      "/broker-to-edavki/app/assets/index-Dh8ySHaT.js",
      "/broker-to-edavki/app/assets%2f..%2f..%2findex.html",
    );
    expectRejected(check(html), "not in the build output");
  });

  it("rejects a protocol-relative URL even when the base is /", () => {
    const html = swap(
      "/broker-to-edavki/app/assets/index-Dh8ySHaT.js",
      "//cdn.example/x.js",
    );
    expectRejected(check(html, "/"), "leaves the site");
  });

  it("rejects a file the build did not emit", () => {
    expectRejected(
      check(BUILT_INDEX, BASE, ["assets/index-B63ZUsys.css"]),
      "names a file that is not in the build output",
    );
  });

  it("rejects a URL that names the base itself", () => {
    const html = swap("/broker-to-edavki/app/assets/index-Dh8ySHaT.js", BASE);
    expectRejected(check(html), "names a file that is not in the build output");
  });
});

describe("check-pages-build: inline scripts", () => {
  const inline: readonly [string, string][] = [
    ["a classic inline script", "<script>window.x = 1</script>"],
    ["an inline module", '<script type="module">import("//x")</script>'],
    ["an import map", '<script type="importmap">{"imports":{}}</script>'],
    ["a JSON data block", '<script type="application/json">{}</script>'],
    ["an empty script element", "<script></script>"],
    [
      "a script with src and a body",
      `<script src="${BASE}assets/index-Dh8ySHaT.js">window.x = 1</script>`,
    ],
  ];

  it.each(inline)("rejects %s", (_name, element) => {
    const outcome = check(swap(LINK_LINE, `${LINK_LINE}\n    ${element}`));
    expect(outcome.stderr).toMatch(
      /FAIL (inline <script> at line \d+|<script src> at line \d+ also has an inline body)/u,
    );
    expect(outcome.stderr).toContain("check-pages-build: FAILED");
    expect(outcome.status).toBe(1);
  });

  it("is not fooled by an empty comment that a browser closes early", () => {
    for (const comment of ["<!-->", "<!--->"]) {
      const outcome = check(
        swap(LINK_LINE, `${LINK_LINE}\n    ${comment}<script>1</script>`),
      );
      expect(outcome.stderr).toContain("inline <script>");
      expect(outcome.status).toBe(1);
    }
  });

  it("names the line of an inline script", () => {
    const outcome = check(swap(LINK_LINE, `${LINK_LINE}\n<script>1</script>`));
    const line =
      BUILT_INDEX.slice(0, BUILT_INDEX.indexOf(LINK_LINE)).split("\n").length +
      1;
    expect(outcome.stderr).toContain(`inline <script> at line ${String(line)}`);
  });

  it("rejects a file that ends inside a tag or a script", () => {
    expectRejected(check(`${BUILT_INDEX}<div class="a`), "is never closed");
    expectRejected(check(`${BUILT_INDEX}<script>1`), "has no end tag");
    expectRejected(
      check(`${BUILT_INDEX}<!-- never closed`),
      "unterminated comment",
    );
  });
});

describe("check-pages-build: the output directory", () => {
  it("fails when the build produced no index.html", () => {
    counter += 1;
    const dist = join(root, `empty-${String(counter)}`);
    mkdirSync(dist);
    const outcome = run([dist, BASE]);
    expect(outcome.stderr).toContain("the build produced no index.html");
    expect(outcome.status).toBe(1);
  });

  it("fails when the directory does not exist", () => {
    const outcome = run([join(root, "no-such-directory"), BASE]);
    expect(outcome.stderr).toContain("the build produced no index.html");
    expect(outcome.status).toBe(1);
  });

  it("refuses an index.html over the size cap", () => {
    const outcome = check(`${BUILT_INDEX}<!-- ${"x".repeat(1024 * 1024)} -->`);
    expect(outcome.stderr).toContain("over the 1048576 byte cap");
    expect(outcome.status).toBe(2);
  });

  it("scans a hostile file in linear time and lists only the first problems", () => {
    const hostile = `${BUILT_INDEX}${"<script></script>\n".repeat(50_000)}`;
    const started = Date.now();
    const outcome = check(hostile);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(outcome.stderr).toContain("FAIL ... and ");
    expect(outcome.stderr.split("\n").length).toBeLessThan(40);
    expect(outcome.status).toBe(1);
  });

  // A scan that searched for each terminator separately would read to the end of
  // the file once per comment whenever one terminator never occurs: quadratic.
  it.each(["<!---->", "<!--x-->", "<!--x--!>"])(
    "scans a file made of %s comments in linear time",
    (comment) => {
      const comments = comment.repeat(Math.floor(900_000 / comment.length));
      const started = Date.now();
      const outcome = check(`${comments}${BUILT_INDEX}`);
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(outcome.stdout).toContain("check-pages-build: OK");
      expect(outcome.status).toBe(0);
    },
  );

  it("survives markup that is nothing but angle brackets and quotes", () => {
    const outcome = check(`${BUILT_INDEX}${"<a b='".repeat(50_000)}`);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("check-pages-build: FAILED");
  });
});

describe("check-pages-build: usage", () => {
  const bad: readonly [string, readonly string[], string][] = [
    ["no arguments", [], "expected <dist-dir> <expected-base>"],
    ["one argument", ["dist"], "expected <dist-dir> <expected-base>"],
    [
      "three arguments",
      ["dist", BASE, "extra"],
      "expected <dist-dir> <expected-base>",
    ],
    [
      "a base without a trailing slash",
      ["dist", "/broker-to-edavki/app"],
      "must end with /",
    ],
    [
      "a base without a leading slash",
      ["dist", "broker-to-edavki/app/"],
      "must start with /",
    ],
    [
      "a base with a dot-dot segment",
      ["dist", "/a/../app/"],
      "must not contain empty or dot segments",
    ],
    [
      "a base with an empty segment",
      ["dist", "/a//app/"],
      "must not contain empty or dot segments",
    ],
    ["a base with a query", ["dist", "/app/?x=1"], "may only contain"],
    [
      "a full URL as the base",
      ["dist", "https://example.com/app/"],
      "may only contain",
    ],
  ];

  it.each(bad)("exits 2 for %s", (_name, args, message) => {
    const outcome = run(args);
    expect(outcome.stderr).toContain(message);
    expect(outcome.stderr).toContain("usage: check-pages-build.mjs");
    expect(outcome.stdout).not.toContain("check-pages-build: OK");
    expect(outcome.status).toBe(2);
  });

  it("accepts a base of /", () => {
    const outcome = check(
      BUILT_INDEX.replaceAll("/broker-to-edavki/app/", "/"),
      "/",
    );
    expect(outcome.stdout).toContain("check-pages-build: OK");
    expect(outcome.status).toBe(0);
  });

  it("prints its usage for --help", () => {
    const outcome = run(["--help"]);
    expect(outcome.stdout).toContain("usage: check-pages-build.mjs");
    expect(outcome.status).toBe(0);
  });

  it("proves it can fail: --self-test passes", () => {
    const outcome = run(["--self-test"]);
    expect(outcome.stdout).toContain(
      "check-pages-build: self-test ran 40 case(s), 0 failed",
    );
    expect(outcome.stdout).toContain("check-pages-build: SELF-TEST OK");
    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
  });
});
