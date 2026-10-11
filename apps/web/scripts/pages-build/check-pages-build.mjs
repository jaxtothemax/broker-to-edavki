#!/usr/bin/env node
// Checks the built web app (apps/web/dist) before it goes into the GitHub Pages
// artifact (.github/workflows/docs.yml, ADR 0009).
//
// ## Why this exists
//
// The app is served under a path prefix (the repository name, then app/), and a
// build made for the wrong prefix looks fine in `vite preview` and 404s every
// script and stylesheet once deployed. GitHub Pages also cannot send response
// headers, so the Content Security Policy travels as a <meta> tag that only the
// production build adds (apps/web/vite.config.ts); a build without it would
// publish an app that nothing restricts. The website-build job runs this check on
// every pull request and push, so a wrong prefix or a lost policy is red before
// anyone sets PUBLISH_WEB_APP.
//
// ## What it checks
//
//   1. index.html has a Content Security Policy <meta http-equiv> tag with a
//      non-empty content attribute, inside <head>, before the first <script> and
//      the first stylesheet or modulepreload <link>. The HTML Standard ignores such a tag outside <head> or with an
//      empty content, and Content Security Policy Level 3 (section on the meta
//      element) says a meta policy is not applied to content that precedes it.
//   2. Every <script src>, <link rel="stylesheet" href> and
//      <link rel="modulepreload" href> URL starts with the expected base and is
//      already in normalized form (no scheme, no "//", no "." or ".." segment, no
//      backslash), and the file it names exists in the output directory.
//   3. No <script> is inline: a <script> without src (an import map or a JSON
//      data block counts), or one with both src and a non-blank body.
//
// ## What it does not check
//
// Only index.html is read. Other elements that load resources (<img>, <iframe>,
// <link rel="icon">), inline event-handler attributes and javascript: URLs are
// not inspected; the Content Security Policy itself blocks them in the browser.
// Character references in attribute values are not decoded: a URL containing
// "&" is rejected instead. The tokenizer below is a deliberate subset of the HTML
// one (comments, quoted and unquoted attribute values, raw-text elements); it
// reads the output of our own build, not arbitrary hostile pages.
//
// ## Safe on hostile input
//
// The file is size-capped, parsed with indexOf and character codes only (every
// loop advances, so the work is linear, and there is no regular expression on
// file content, hence nothing to backtrack), and nothing in it is executed.
//
// ## Usage
//
//   node apps/web/scripts/pages-build/check-pages-build.mjs <dist-dir> <expected-base>
//   node apps/web/scripts/pages-build/check-pages-build.mjs --self-test
//
// <expected-base> starts and ends with "/", for example /broker-to-edavki/app/.
//
// ## Exit codes
//
//   0  every check passed
//   1  at least one check failed (a FAIL line names each)
//   2  the check could not run: bad arguments, or an index.html over the size cap

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOL = "check-pages-build";
const USAGE = `usage: ${TOOL}.mjs <dist-dir> <expected-base>  (base starts and ends with "/")\n       ${TOOL}.mjs --self-test`;

// The real index.html is about 1.3 kB. A megabyte is far past anything the
// build emits and still reads instantly.
const MAX_INDEX_BYTES = 1024 * 1024;

// A hostile file can hold one problem per tag; list the first few, count all.
const MAX_PRINTED_PROBLEMS = 20;

// A URL is resolved against this origin only to normalize it; nothing is fetched.
const PLACEHOLDER_ORIGIN = "https://pages.invalid";

// Elements whose content is text, not markup, up to their matching end tag.
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

/**
 * @typedef {object} Tag
 * @property {string} name Lower-case element name.
 * @property {boolean} closing True for an end tag.
 * @property {Map<string, string>} attrs Lower-case name to raw value; the first of a repeated attribute wins, as in a browser.
 * @property {number} start Offset of the "<".
 * @property {boolean} inHead True between <head> and </head> (or <body>).
 * @property {string} body Text up to the end tag, for raw-text elements only.
 */

/** @param {number} c */
const isSpace = (c) =>
  c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;

/** @param {number} c */
const isAsciiLetter = (c) =>
  (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

/**
 * Offset just past the comment that starts at `lt`, or -1 when it never ends.
 * "<!-->" and "<!--->" are complete (empty) comments, and "--!>" also closes one.
 * @param {string} html
 * @param {number} lt
 */
function commentEnd(html, lt) {
  if (html.startsWith("<!-->", lt)) return lt + 5;
  if (html.startsWith("<!--->", lt)) return lt + 6;
  // One forward pass over the "--" candidates. Searching for "-->" and "--!>"
  // separately would scan to the end of the file once per comment whenever one
  // of the two never occurs, which is quadratic on a file full of comments.
  let at = html.indexOf("--", lt + 4);
  while (at !== -1) {
    const next = html.charCodeAt(at + 2);
    if (next === 0x3e) return at + 3;
    if (next === 0x21 && html.charCodeAt(at + 3) === 0x3e) return at + 4;
    at = html.indexOf("--", at + 1);
  }
  return -1;
}

/**
 * Offset of the "<" of the end tag of raw-text element `name`, searching from
 * `from`, or -1. The name matches ASCII case-insensitively and must be followed
 * by whitespace, "/" or ">".
 * @param {string} html
 * @param {string} name
 * @param {number} from
 */
function rawTextEnd(html, name, from) {
  let at = html.indexOf("</", from);
  while (at !== -1) {
    const candidate = html.slice(at + 2, at + 2 + name.length).toLowerCase();
    const after = html.charCodeAt(at + 2 + name.length);
    if (
      candidate === name &&
      (isSpace(after) || after === 0x2f || after === 0x3e)
    )
      return at;
    at = html.indexOf("</", at + 2);
  }
  return -1;
}

/**
 * Splits HTML into start and end tags. Comments, doctypes and the content of
 * raw-text elements are skipped, so markup inside them is never reported.
 * @param {string} html
 * @returns {{ tags: Tag[], errors: string[] }}
 */
function scanTags(html) {
  const lineOf = makeLineOf(html);
  /** @type {Tag[]} */
  const tags = [];
  /** @type {string[]} */
  const errors = [];
  const n = html.length;
  let i = 0;
  let inHead = false;

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;

    if (html.startsWith("<!--", lt)) {
      const end = commentEnd(html, lt);
      if (end === -1) {
        errors.push(`unterminated comment at line ${lineOf(lt)}`);
        break;
      }
      i = end;
      continue;
    }

    const c1 = html.charCodeAt(lt + 1);
    if (c1 === 0x21 || c1 === 0x3f) {
      // "<!doctype ...>", "<![CDATA[...", "<?...>": a bogus comment up to ">".
      const end = html.indexOf(">", lt + 2);
      if (end === -1) {
        errors.push(`unterminated declaration at line ${lineOf(lt)}`);
        break;
      }
      i = end + 1;
      continue;
    }

    const closing = c1 === 0x2f;
    const nameStart = lt + (closing ? 2 : 1);
    if (!isAsciiLetter(html.charCodeAt(nameStart))) {
      i = lt + 1; // a literal "<" in text
      continue;
    }

    let p = nameStart;
    while (p < n) {
      const c = html.charCodeAt(p);
      if (isSpace(c) || c === 0x2f || c === 0x3e) break;
      p += 1;
    }
    const name = html.slice(nameStart, p).toLowerCase();

    /** @type {Map<string, string>} */
    const attrs = new Map();
    let terminated = false;
    while (p < n) {
      while (
        p < n &&
        (isSpace(html.charCodeAt(p)) || html.charCodeAt(p) === 0x2f)
      )
        p += 1;
      if (p >= n) break;
      if (html.charCodeAt(p) === 0x3e) {
        p += 1;
        terminated = true;
        break;
      }
      // An attribute name runs to whitespace, "/", ">" or "=". A leading "=" is
      // part of the name, so the first character is always consumed.
      const nameFrom = p;
      p += 1;
      while (p < n) {
        const c = html.charCodeAt(p);
        if (isSpace(c) || c === 0x2f || c === 0x3e || c === 0x3d) break;
        p += 1;
      }
      const attrName = html.slice(nameFrom, p).toLowerCase();
      let q = p;
      while (q < n && isSpace(html.charCodeAt(q))) q += 1;
      let value = "";
      if (html.charCodeAt(q) === 0x3d) {
        q += 1;
        while (q < n && isSpace(html.charCodeAt(q))) q += 1;
        const quote = html.charAt(q);
        if (quote === '"' || quote === "'") {
          const close = html.indexOf(quote, q + 1);
          if (close === -1) {
            p = n; // the quote never closes: the tag runs off the end of the file
            break;
          }
          value = html.slice(q + 1, close);
          p = close + 1;
        } else {
          let s = q;
          while (
            s < n &&
            !isSpace(html.charCodeAt(s)) &&
            html.charCodeAt(s) !== 0x3e
          )
            s += 1;
          value = html.slice(q, s);
          p = s;
        }
      }
      if (!attrs.has(attrName)) attrs.set(attrName, value);
    }
    if (!terminated) {
      errors.push(`<${name}> at line ${lineOf(lt)} is never closed`);
      break;
    }

    if (!closing) {
      if (name === "head") inHead = true;
      else if (name === "body") inHead = false;
    } else if (name === "head") {
      inHead = false;
    }

    let body = "";
    i = p;
    if (!closing && RAW_TEXT_ELEMENTS.has(name)) {
      const end = rawTextEnd(html, name, p);
      if (end === -1) {
        errors.push(`<${name}> at line ${lineOf(lt)} has no end tag`);
        tags.push({
          name,
          closing,
          attrs,
          start: lt,
          inHead,
          body: html.slice(p),
        });
        break;
      }
      body = html.slice(p, end);
      i = end;
    }
    tags.push({ name, closing, attrs, start: lt, inHead, body });
  }
  return { tags, errors };
}

/**
 * Line number (1-based) of an offset. The newline offsets are collected once,
 * so many lookups on a long file stay cheap.
 * @param {string} html
 * @returns {(offset: number) => number}
 */
function makeLineOf(html) {
  /** @type {number[] | null} */
  let newlines = null;
  return (offset) => {
    if (newlines === null) {
      newlines = [];
      for (
        let at = html.indexOf("\n");
        at !== -1;
        at = html.indexOf("\n", at + 1)
      )
        newlines.push(at);
    }
    // Count the newlines before `offset` by binary search.
    let low = 0;
    let high = newlines.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((newlines[mid] ?? 0) < offset) low = mid + 1;
      else high = mid;
    }
    return low + 1;
  };
}

/**
 * Space-separated tokens of an attribute value, lower-cased.
 * @param {string} value
 */
function tokens(value) {
  /** @type {string[]} */
  const found = [];
  let from = -1;
  for (let at = 0; at <= value.length; at += 1) {
    const separator = at === value.length || isSpace(value.charCodeAt(at));
    if (separator && from !== -1) {
      found.push(value.slice(from, at).toLowerCase());
      from = -1;
    } else if (!separator && from === -1) {
      from = at;
    }
  }
  return found;
}

/**
 * Why `url` may not be served from `base`, or null when it may.
 * @param {string} url
 * @param {string} base
 */
function urlProblem(url, base) {
  if (url === "") return "has an empty URL";
  if (url.includes("&"))
    return 'contains "&" (character references are not decoded here)';
  if (!url.startsWith(base)) return `is not under ${base}`;
  let resolved;
  try {
    resolved = new URL(url, PLACEHOLDER_ORIGIN);
  } catch {
    return "is not a valid URL";
  }
  if (resolved.origin !== PLACEHOLDER_ORIGIN) return "leaves the site";
  // URL parsing drops dot segments, turns "\" into "/" and strips tabs and
  // newlines, so a URL that was not already normalized comes back different.
  if (url !== resolved.pathname + resolved.search + resolved.hash) {
    return "is not in normalized form (dot segment, backslash or stray character)";
  }
  if (!resolved.pathname.startsWith(base)) return `resolves outside ${base}`;
  return null;
}

/**
 * Whether the file a URL under `base` names exists in `distDir`.
 * @param {string} url A URL that urlProblem accepted.
 * @param {string} base
 * @param {string} distDir
 */
function assetExists(url, base, distDir) {
  const pathname = new URL(url, PLACEHOLDER_ORIGIN).pathname;
  let relative;
  try {
    relative = decodeURIComponent(pathname.slice(base.length));
  } catch {
    return false;
  }
  if (relative === "") return false;
  const root = resolve(distDir);
  const file = resolve(root, relative);
  // An encoded "%2f" survives URL normalization and decodes to a separator, so
  // the decoded path is confined to the output directory again.
  if (!file.startsWith(root + sep)) return false;
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * @typedef {object} Report
 * @property {string[]} problems
 * @property {{ script: number, stylesheet: number, modulepreload: number, inline: number, csp: boolean }} counts
 */

/**
 * @param {string} html
 * @param {string} base
 * @param {string} distDir
 * @returns {Report}
 */
function checkHtml(html, base, distDir) {
  const lineOf = makeLineOf(html);
  const { tags, errors } = scanTags(html);
  /** @type {string[]} */
  const problems = [...errors];
  const counts = {
    script: 0,
    stylesheet: 0,
    modulepreload: 0,
    inline: 0,
    csp: false,
  };

  // Offset of the first tag that loads or runs something.
  let firstLoader = Infinity;
  /** @type {number | null} */
  let cspAt = null;

  for (const tag of tags) {
    if (tag.closing) continue;

    if (tag.name === "meta") {
      const equiv = (tag.attrs.get("http-equiv") ?? "").toLowerCase();
      const content = tag.attrs.get("content") ?? "";
      if (
        equiv === "content-security-policy" &&
        content.trim() !== "" &&
        tag.inHead &&
        cspAt === null
      ) {
        cspAt = tag.start;
      }
      continue;
    }

    /** @type {{ kind: string, label: string, url: string } | null} */
    let resource = null;
    if (tag.name === "script") {
      firstLoader = Math.min(firstLoader, tag.start);
      const src = tag.attrs.get("src");
      if (src === undefined) {
        counts.inline += 1;
        problems.push(`inline <script> at line ${lineOf(tag.start)}`);
      } else {
        if (tag.body.trim() !== "") {
          counts.inline += 1;
          problems.push(
            `<script src> at line ${lineOf(tag.start)} also has an inline body`,
          );
        }
        counts.script += 1;
        resource = { kind: "script", label: "<script src>", url: src };
      }
    } else if (tag.name === "link") {
      const rel = tokens(tag.attrs.get("rel") ?? "");
      const kind = rel.includes("stylesheet")
        ? "stylesheet"
        : rel.includes("modulepreload")
          ? "modulepreload"
          : null;
      if (kind !== null) {
        firstLoader = Math.min(firstLoader, tag.start);
        if (kind === "stylesheet") counts.stylesheet += 1;
        else counts.modulepreload += 1;
        resource = {
          kind,
          label: `<link rel="${kind}" href>`,
          url: tag.attrs.get("href") ?? "",
        };
      }
    }

    if (resource !== null) {
      const why = urlProblem(resource.url, base);
      if (why !== null) {
        problems.push(
          `${resource.label} "${resource.url}" at line ${lineOf(tag.start)} ${why}`,
        );
      } else if (!assetExists(resource.url, base, distDir)) {
        problems.push(
          `${resource.label} "${resource.url}" names a file that is not in the build output`,
        );
      }
    }
  }

  counts.csp = cspAt !== null;
  if (cspAt === null) {
    problems.push(
      "no Content Security Policy <meta http-equiv> tag with a non-empty content attribute inside <head>",
    );
  } else if (cspAt > firstLoader) {
    problems.push(
      "the Content Security Policy <meta> tag comes after a <script> or <link>, which a browser does not apply it to",
    );
  }
  return { problems, counts };
}

/**
 * @param {string} base
 * @returns {string | null} Why the base is unusable, or null.
 */
function baseProblem(base) {
  if (!/^\/[A-Za-z0-9._~/-]*$/u.test(base))
    return "may only contain letters, digits and . _ ~ - /, and must start with /";
  if (!base.endsWith("/")) return "must end with /";
  const segments = base.split("/").slice(1, -1);
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..")
      return "must not contain empty or dot segments";
  }
  return null;
}

/**
 * Runs the check on `distDir`. Throws an Error with `.exitCode = 2` when the
 * check cannot run.
 * @param {string} distDir
 * @param {string} base
 * @returns {Report}
 */
function checkBuild(distDir, base) {
  const indexPath = join(distDir, "index.html");
  /** @type {import("node:fs").Stats | undefined} */
  let stats;
  try {
    stats = statSync(indexPath);
  } catch {
    stats = undefined;
  }
  if (stats === undefined || !stats.isFile()) {
    return {
      problems: [
        `${indexPath} does not exist: the build produced no index.html`,
      ],
      counts: {
        script: 0,
        stylesheet: 0,
        modulepreload: 0,
        inline: 0,
        csp: false,
      },
    };
  }
  if (stats.size > MAX_INDEX_BYTES) {
    throw Object.assign(
      new Error(
        `${indexPath} is ${stats.size} bytes, over the ${MAX_INDEX_BYTES} byte cap`,
      ),
      {
        exitCode: 2,
      },
    );
  }
  return checkHtml(readFileSync(indexPath, "utf8"), base, distDir);
}

/** @param {string} line */
const out = (line) => process.stdout.write(`${line}\n`);

/** @param {string} line */
const err = (line) => process.stderr.write(`${line}\n`);

/** @param {string} message */
function usageError(message) {
  err(`${TOOL}: ${message}`);
  err(USAGE);
  return 2;
}

/** @param {string[]} args */
function runCheck(args) {
  const [distDir, base] = args;
  if (distDir === undefined || base === undefined)
    return usageError("expected <dist-dir> and <expected-base>");
  const badBase = baseProblem(base);
  if (badBase !== null) return usageError(`expected base "${base}" ${badBase}`);

  /** @type {Report} */
  let report;
  try {
    report = checkBuild(distDir, base);
  } catch (error) {
    err(`${TOOL}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const { counts, problems } = report;
  out(
    `${TOOL}: base ${base}: ${counts.script} script, ${counts.stylesheet} stylesheet and ${counts.modulepreload} modulepreload URL(s) checked, ` +
      `${counts.inline} inline script(s), Content Security Policy meta ${counts.csp ? "present" : "missing"}`,
  );
  if (problems.length === 0) {
    out(`${TOOL}: OK`);
    return 0;
  }
  for (const problem of problems.slice(0, MAX_PRINTED_PROBLEMS))
    err(`FAIL ${problem}`);
  if (problems.length > MAX_PRINTED_PROBLEMS) {
    err(
      `FAIL ... and ${problems.length - MAX_PRINTED_PROBLEMS} more (only the first ${MAX_PRINTED_PROBLEMS} are listed)`,
    );
  }
  err(`${TOOL}: FAILED with ${problems.length} problem(s)`);
  return 1;
}

// ─── Self-test ───────────────────────────────────────────────────────────────
//
// scripts/CLAUDE.md: a gate has to be shown able to say no, in the job that
// relies on it. Each case writes a small build output, runs this very file as a
// child process, and demands the exact exit code AND the gate's own verdict line,
// so a crash (exit 1 from an uncaught exception) cannot pass for a rejection.

const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; script-src &#39;self&#39;">';

/**
 * An index.html shaped like the build's output, with `overrides` for one
 * deviation per case.
 * @param {string} base
 * @param {{ csp?: string, script?: string, extra?: string }} [overrides]
 */
function fixtureHtml(base, overrides = {}) {
  const csp = overrides.csp ?? CSP_META;
  const script =
    overrides.script ??
    `<script type="module" crossorigin src="${base}assets/index-abc123.js"></script>`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    `    ${csp}`,
    '    <meta charset="UTF-8" />',
    `    ${script}`,
    `    <link rel="stylesheet" crossorigin href="${base}assets/index-abc123.css">`,
    `    ${overrides.extra ?? ""}`,
    "  </head>",
    '  <body><div id="root"></div></body>',
    "</html>",
    "",
  ].join("\n");
}

function selfTest() {
  const script = fileURLToPath(import.meta.url);
  const root = mkdtempSync(join(tmpdir(), `${TOOL}-`));
  const base = "/repo/app/";
  let failures = 0;
  let cases = 0;

  /**
   * @param {string} name
   * @param {string} html
   * @param {string} useBase
   * @param {number} wantExit
   * @param {string} wantText
   * @param {boolean} [withAssets]
   */
  const run = (name, html, useBase, wantExit, wantText, withAssets = true) => {
    cases += 1;
    const dist = join(root, `case-${cases}`);
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "index.html"), html);
    if (withAssets) {
      writeFileSync(join(dist, "assets", "index-abc123.js"), "");
      writeFileSync(join(dist, "assets", "index-abc123.css"), "");
    }
    const result = spawnSync(process.execPath, [script, dist, useBase], {
      encoding: "utf8",
      timeout: 20_000,
    });
    const text = `${result.stdout}${result.stderr}`;
    const verdict =
      wantExit === 0
        ? `${TOOL}: OK`
        : wantExit === 1
          ? `${TOOL}: FAILED`
          : USAGE;
    if (
      result.status !== wantExit ||
      !text.includes(wantText) ||
      !text.includes(verdict)
    ) {
      failures += 1;
      err(
        `SELF-TEST FAILED: ${name}: wanted exit ${wantExit} with "${wantText}", got exit ${String(result.status)}.`,
      );
      err(text.replace(/^/gmu, "    "));
    } else {
      out(`SELF-TEST OK: ${name}`);
    }
  };

  try {
    run(
      "a build under the expected base is accepted",
      fixtureHtml(base),
      base,
      0,
      "Content Security Policy meta present",
    );
    run(
      "a missing policy tag is rejected",
      fixtureHtml(base, { csp: "" }),
      base,
      1,
      "no Content Security Policy",
    );
    run(
      "a policy tag inside a comment is rejected",
      fixtureHtml(base, { csp: `<!-- ${CSP_META} -->` }),
      base,
      1,
      "no Content Security Policy",
    );
    run(
      "a policy tag after a script is rejected",
      fixtureHtml(base, { csp: "", extra: CSP_META }),
      base,
      1,
      "comes after",
    );
    run(
      "an asset outside the base is rejected",
      fixtureHtml(base, {
        script:
          '<script type="module" src="/other/assets/index-abc123.js"></script>',
      }),
      base,
      1,
      "is not under /repo/app/",
    );
    run(
      "a third-party script is rejected",
      fixtureHtml(base, {
        script:
          '<script type="module" src="https://cdn.example/x.js"></script>',
      }),
      base,
      1,
      "is not under /repo/app/",
    );
    run(
      "a protocol-relative script under base / is rejected",
      fixtureHtml("/", {
        script: '<script type="module" src="//cdn.example/x.js"></script>',
      }),
      "/",
      1,
      "leaves the site",
    );
    run(
      "a dot segment is rejected",
      fixtureHtml(base, {
        script: `<script type="module" src="${base}../x.js"></script>`,
      }),
      base,
      1,
      "normalized form",
    );
    run(
      "an inline script is rejected",
      fixtureHtml(base, { extra: "<script>window.x = 1</script>" }),
      base,
      1,
      "inline <script>",
    );
    run(
      "an asset missing from the output is rejected",
      fixtureHtml(base),
      base,
      1,
      "not in the build output",
      false,
    );
    run(
      "a base without a trailing slash is a usage error",
      fixtureHtml(base),
      "/repo/app",
      2,
      "must end with /",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  out(`${TOOL}: self-test ran ${cases} case(s), ${failures} failed`);
  if (failures > 0) return 1;
  out(`${TOOL}: SELF-TEST OK`);
  return 0;
}

/** @param {string[]} argv */
function main(argv) {
  const args = argv.slice(2);
  if (args.length === 1 && (args[0] === "-h" || args[0] === "--help")) {
    out(USAGE);
    return 0;
  }
  if (args.length === 1 && args[0] === "--self-test") return selfTest();
  if (args.length !== 2)
    return usageError("expected <dist-dir> <expected-base>");
  return runCheck(args);
}

// Run as a command, not when imported.
const entry = process.argv[1];
if (
  entry !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(entry)).href
) {
  process.exitCode = main(process.argv);
}
