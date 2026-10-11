import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The check is a command-line script, so these tests run it the way the
// website-build job does: as a child process on a build output directory, and
// they demand the exact exit code and the message. Importing it would hide a
// crash behind a thrown exception.

const SCRIPT = fileURLToPath(
  new URL("./check-pages-build.mjs", import.meta.url),
);
const BASE = "/broker-to-edavki/app/";

/**
 * The shape `pnpm --filter @taxreporter/web build` emits with
 * TAXREPORTER_WEB_BASE=/broker-to-edavki/app/: character references in the
 * policy, a valueless `crossorigin`, a <noscript> block, no modulepreload.
 */
const BUILT_INDEX = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; script-src &#39;self&#39;; style-src &#39;self&#39;; img-src &#39;self&#39; data:; font-src &#39;self&#39;; connect-src &#39;self&#39;; worker-src &#39;self&#39; blob:; object-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">

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
    expectRejected(
      check(html),
      "no Content Security Policy <meta http-equiv> tag",
    );
  });

  it("is rejected when a script comes before it", () => {
    const html = swap(CSP_LINE, "").replace(
      SCRIPT_LINE,
      `${SCRIPT_LINE}\n${CSP_LINE}`,
    );
    expectRejected(check(html), "comes after a <script> or <link>");
  });

  it("is rejected when a stylesheet comes before it", () => {
    const html = swap(CSP_LINE, "").replace(
      LINK_LINE,
      `${LINK_LINE}\n${CSP_LINE}`,
    );
    expectRejected(
      check(swap(SCRIPT_LINE, "", html)),
      "comes after a <script> or <link>",
    );
  });

  it("is reported even when everything else is wrong too", () => {
    const outcome = check(swap(CSP_LINE, "<script>1</script>"));
    expect(outcome.stderr).toContain("no Content Security Policy");
    expect(outcome.stderr).toContain("inline <script>");
    expect(outcome.status).toBe(1);
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
      "check-pages-build: self-test ran 11 case(s), 0 failed",
    );
    expect(outcome.stdout).toContain("check-pages-build: SELF-TEST OK");
    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
  });
});
