#!/usr/bin/env node
// Checks the built web app (apps/web/dist) before it goes into the GitHub Pages
// artifact (.github/workflows/docs.yml, ADR 0009).
//
// ## Why this exists
//
// The app is served under a path prefix (the docs base, then app/), and a build
// made for the wrong prefix looks fine in `vite preview` and 404s every script
// and stylesheet once deployed. GitHub Pages also cannot send response headers,
// so the Content Security Policy travels as a <meta> tag that only the
// production build adds (apps/web/vite.config.ts); a build without it would
// publish an app that nothing restricts. The website-build job runs this check on
// every pull request and push, so a wrong prefix or a lost policy is red before
// anyone sets PUBLISH_WEB_APP.
//
// ## What it checks
//
//   1. The Content Security Policy <meta http-equiv> tag is where the build puts
//      it (head-prepend in apps/web/vite.config.ts): before it come only a
//      doctype, comments, whitespace, an <html> start tag and the first <head>
//      start tag. That is stricter than the HTML Standard on purpose. A browser
//      ignores the tag outside <head>, and Content Security Policy Level 3
//      (section on the meta element) does not apply it to what precedes it; any
//      other element or text before it can end <head> early (a <div>, stray
//      text), hold it as text or inert content (<noscript>, <noframes>, <xmp>,
//      <iframe>, <noembed>, <plaintext>, <template>), or come after a <head>
//      the browser ignores. Modeling the HTML tree builder is out of scope, so
//      nothing of the sort is allowed in front of the tag.
//   2. Its content, after decoding character references, is exactly
//      CONTENT_SECURITY_POLICY from apps/web/content-security-policy.mjs, the
//      module vite.config.ts injects it from. A weakened or replaced policy
//      fails.
//   3. Every <script src>, <link rel="stylesheet" href> and
//      <link rel="modulepreload" href> URL starts with the expected base and is
//      already in normalized form (no scheme, no "//", no "." or ".." segment, no
//      backslash), and the file it names exists in the output directory.
//   4. No <script> is inline: a <script> without src (an import map or a JSON
//      data block counts), or one with both src and a non-blank body.
//   5. No <svg> or <math> element. Inside foreign content <title>, <style> and
//      <textarea> are ordinary elements, not text, so a <script> in an SVG
//      <title> runs while a reader that takes <title> for text skips it. The
//      app's index.html has none.
//
// ## What it does not check
//
// Only index.html is read. Other elements that load resources (<img>, <iframe>,
// <link rel="icon">), inline event-handler attributes and javascript: URLs are
// not inspected; the Content Security Policy itself blocks them in the browser.
// Character references in URLs are not decoded: a URL containing "&" is
// rejected instead. In the policy and http-equiv values only numeric references
// and &amp; &lt; &gt; &quot; &apos; are decoded (escape-html, which Vite uses,
// emits nothing else); any other "&" makes the policy a mismatch. The tokenizer
// below is a deliberate subset of the HTML one (comments, doctypes, quoted and
// unquoted attribute values, raw-text elements). Past the policy tag it may see
// MORE markup than a browser would (a <script> inside <noscript>, say), never
// less, so it errs toward failing.
//
// ## Safe on hostile input
//
// The file is size-capped, parsed with indexOf and character codes only (every
// loop advances, so the work is linear, and there is no regular expression on
// file content, hence nothing to backtrack), and nothing in it is executed.
// Values quoted from it in messages are JSON-escaped and truncated, so a newline
// in an attribute cannot start a line of its own (a GitHub Actions command).
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

import { CONTENT_SECURITY_POLICY } from "../../content-security-policy.mjs";

const TOOL = "check-pages-build";
const USAGE = `usage: ${TOOL}.mjs <dist-dir> <expected-base>  (base starts and ends with "/")\n       ${TOOL}.mjs --self-test`;

// Where the expected policy lives, for messages.
const POLICY_MODULE = "apps/web/content-security-policy.mjs";

// The real index.html is about 1.3 kB. A megabyte is far past anything the
// build emits and still reads instantly.
const MAX_INDEX_BYTES = 1024 * 1024;

// A hostile file can hold one problem per tag; list the first few, count all.
const MAX_PRINTED_PROBLEMS = 20;

// Characters of a value from the file shown in a message.
const MAX_QUOTED_CHARS = 200;

// A URL is resolved against this origin only to normalize it; nothing is fetched.
const PLACEHOLDER_ORIGIN = "https://pages.invalid";

// Elements whose content is text, not markup, up to their matching end tag.
// True for title, style and textarea only outside svg and math, which is why
// FOREIGN_ELEMENTS are refused outright.
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

// Elements that switch the HTML parser to foreign content.
const FOREIGN_ELEMENTS = new Set(["svg", "math"]);

// The named character references decoded in the policy (see the header).
const NAMED_REFERENCES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

const MISSING_POLICY =
  "no Content Security Policy <meta http-equiv> tag with a non-empty content attribute first in <head>";

/**
 * @typedef {object} Tag
 * @property {string} name Element name, ASCII lower-cased.
 * @property {boolean} closing True for an end tag.
 * @property {Map<string, string>} attrs ASCII lower-cased name to raw value; the first of a repeated attribute wins, as in a browser.
 * @property {number} start Offset of the "<".
 * @property {string} body Text up to the end tag, for raw-text elements only.
 */

/**
 * @typedef {{ kind: "doctype" | "comment" | "declaration" | "text", start: number }} PlainToken
 *   A doctype, a comment, any other "<!...>" or "<?...>", or a run of text that
 *   is more than whitespace (start is its first non-whitespace character).
 * @typedef {{ kind: "tag", start: number, tag: Tag }} TagToken
 * @typedef {PlainToken | TagToken} Token
 */

/** @param {number} c */
const isSpace = (c) =>
  c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;

/** @param {number} c */
const isAsciiLetter = (c) =>
  (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

/**
 * Lower-cases A to Z only, as the HTML tokenizer does. String#toLowerCase also
 * folds non-ASCII letters (the Kelvin sign becomes "k"), which a browser never
 * does to a tag or attribute name.
 * @param {string} value
 */
function asciiLower(value) {
  let out = "";
  let from = 0;
  for (let at = 0; at < value.length; at += 1) {
    const c = value.charCodeAt(at);
    if (c >= 0x41 && c <= 0x5a) {
      out += value.slice(from, at) + String.fromCharCode(c + 0x20);
      from = at + 1;
    }
  }
  return from === 0 ? value : out + value.slice(from);
}

/**
 * A value from the file, safe to print: JSON-escaped (no raw newline or control
 * character reaches the log) and truncated.
 * @param {string} value
 */
function quoted(value) {
  return JSON.stringify(
    value.length > MAX_QUOTED_CHARS
      ? `${value.slice(0, MAX_QUOTED_CHARS)}...`
      : value,
  );
}

/**
 * Offset of the first non-whitespace character in html[from, to), or -1.
 * @param {string} html
 * @param {number} from
 * @param {number} to
 */
function firstNonSpace(html, from, to) {
  for (let at = from; at < to; at += 1) {
    if (!isSpace(html.charCodeAt(at))) return at;
  }
  return -1;
}

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
    const candidate = asciiLower(html.slice(at + 2, at + 2 + name.length));
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
 * Splits HTML into tokens: start and end tags, comments, doctypes, other
 * declarations, and the text between them when it is more than whitespace. The
 * content of raw-text elements is the element's body, so markup inside it is
 * never reported as tags.
 * @param {string} html
 * @returns {{ tokens: Token[], errors: string[] }}
 */
function tokenize(html) {
  const lineOf = makeLineOf(html);
  /** @type {Token[]} */
  const tokens = [];
  /** @type {string[]} */
  const errors = [];
  const n = html.length;
  let i = 0; // where the search for the next "<" resumes
  let textFrom = 0; // start of the text run that ends at the next token

  /** Records the text run that ends at `to`, unless it is all whitespace. */
  const flushText = (/** @type {number} */ to) => {
    const at = firstNonSpace(html, textFrom, to);
    if (at !== -1) tokens.push({ kind: "text", start: at });
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;

    if (html.startsWith("<!--", lt)) {
      const end = commentEnd(html, lt);
      if (end === -1) {
        errors.push(`unterminated comment at line ${lineOf(lt)}`);
        break;
      }
      flushText(lt);
      tokens.push({ kind: "comment", start: lt });
      i = textFrom = end;
      continue;
    }

    const c1 = html.charCodeAt(lt + 1);
    if (c1 === 0x21 || c1 === 0x3f) {
      // "<!doctype ...>", "<![CDATA[...", "<?...>": up to the first ">", which
      // ends a doctype and a bogus comment alike.
      const end = html.indexOf(">", lt + 2);
      if (end === -1) {
        errors.push(`unterminated declaration at line ${lineOf(lt)}`);
        break;
      }
      flushText(lt);
      const doctype =
        c1 === 0x21 && asciiLower(html.slice(lt + 2, lt + 9)) === "doctype";
      tokens.push({ kind: doctype ? "doctype" : "declaration", start: lt });
      i = textFrom = end + 1;
      continue;
    }

    const closing = c1 === 0x2f;
    const nameStart = lt + (closing ? 2 : 1);
    if (!isAsciiLetter(html.charCodeAt(nameStart))) {
      i = lt + 1; // a literal "<": it stays part of the current text run
      continue;
    }

    let p = nameStart;
    while (p < n) {
      const c = html.charCodeAt(p);
      if (isSpace(c) || c === 0x2f || c === 0x3e) break;
      p += 1;
    }
    const name = asciiLower(html.slice(nameStart, p));

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
      const attrName = asciiLower(html.slice(nameFrom, p));
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

    flushText(lt);
    /** @type {Tag} */
    const tag = { name, closing, attrs, start: lt, body: "" };
    tokens.push({ kind: "tag", start: lt, tag });
    i = textFrom = p;
    if (!closing && RAW_TEXT_ELEMENTS.has(name)) {
      const end = rawTextEnd(html, name, p);
      if (end === -1) {
        errors.push(`<${name}> at line ${lineOf(lt)} has no end tag`);
        tag.body = html.slice(p);
        i = textFrom = n;
        break;
      }
      tag.body = html.slice(p, end);
      i = textFrom = end;
    }
  }
  flushText(n);
  return { tokens, errors };
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
 * Space-separated tokens of an attribute value, ASCII lower-cased.
 * @param {string} value
 */
function spaceSeparated(value) {
  /** @type {string[]} */
  const found = [];
  let from = -1;
  for (let at = 0; at <= value.length; at += 1) {
    const separator = at === value.length || isSpace(value.charCodeAt(at));
    if (separator && from !== -1) {
      found.push(asciiLower(value.slice(from, at)));
      from = -1;
    } else if (!separator && from === -1) {
      from = at;
    }
  }
  return found;
}

/**
 * The code point a numeric character reference names, or null when its digits
 * are not all valid or it names something a browser would replace (NUL, a
 * surrogate, past U+10FFFF, or the C1 range that HTML remaps).
 * @param {string} digits
 * @param {10 | 16} radix
 */
function numericReference(digits, radix) {
  if (digits === "") return null;
  for (let at = 0; at < digits.length; at += 1) {
    const c = digits.charCodeAt(at);
    const decimal = c >= 0x30 && c <= 0x39;
    const hex = (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
    if (!(decimal || (radix === 16 && hex))) return null;
  }
  const code = Number.parseInt(digits, radix);
  if (
    code === 0 ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff) ||
    (code >= 0x80 && code <= 0x9f)
  )
    return null;
  return String.fromCodePoint(code);
}

/**
 * Decodes the character references in an attribute value in a single pass (so
 * "&amp;#39;" is "&#39;", not "'"), or returns null when the value holds an "&"
 * that is not one of the references named in the header.
 * @param {string} value
 * @returns {string | null}
 */
function decodeReferences(value) {
  let out = "";
  let from = 0;
  let amp = value.indexOf("&");
  while (amp !== -1) {
    // The longest reference decoded here is "&#x10FFFF;": look no further.
    const semicolon = value.slice(amp + 1, amp + 10).indexOf(";");
    if (semicolon === -1) return null;
    const name = value.slice(amp + 1, amp + 1 + semicolon);
    const decoded =
      name.startsWith("#x") || name.startsWith("#X")
        ? numericReference(name.slice(2), 16)
        : name.startsWith("#")
          ? numericReference(name.slice(1), 10)
          : (NAMED_REFERENCES.get(name) ?? null);
    if (decoded === null) return null;
    out += value.slice(from, amp) + decoded;
    from = amp + 2 + semicolon;
    amp = value.indexOf("&", from);
  }
  return out + value.slice(from);
}

/**
 * Whether a tag is a Content Security Policy <meta> a browser would read: its
 * http-equiv is the policy (ASCII case-insensitively, after decoding) and its
 * content is not blank.
 * @param {Tag} tag
 */
function isPolicyMeta(tag) {
  if (tag.closing || tag.name !== "meta") return false;
  const equiv = decodeReferences(tag.attrs.get("http-equiv") ?? "");
  if (equiv === null || asciiLower(equiv) !== "content-security-policy")
    return false;
  const raw = tag.attrs.get("content") ?? "";
  const content = decodeReferences(raw) ?? raw;
  return content.trim() !== "";
}

/**
 * The first token before tokenList[end] that may not precede the policy tag, or
 * null. In order, only these may: a doctype, an <html> start tag, the first
 * <head> start tag, with comments anywhere. Whitespace-only text never becomes
 * a token. A second <head> is refused: a browser ignores it, so a tag after it
 * would sit wherever the first <head> left the parser.
 * @param {Token[]} tokenList
 * @param {number} end
 * @returns {Token | null}
 */
function firstTokenBeforePolicy(tokenList, end) {
  // 0 nothing yet, 1 after the doctype, 2 after <html>, 3 after <head>
  let stage = 0;
  for (let k = 0; k < end; k += 1) {
    const token = tokenList[k];
    if (token === undefined) break;
    if (token.kind === "comment") continue;
    if (token.kind === "doctype" && stage === 0) {
      stage = 1;
      continue;
    }
    if (token.kind === "tag" && !token.tag.closing) {
      if (token.tag.name === "html" && stage < 2) {
        stage = 2;
        continue;
      }
      if (token.tag.name === "head" && stage < 3) {
        stage = 3;
        continue;
      }
    }
    return token;
  }
  return null;
}

/** @param {Token} token */
function describeToken(token) {
  switch (token.kind) {
    case "tag":
      return `<${token.tag.closing ? "/" : ""}${token.tag.name}>`;
    case "text":
      return "text";
    case "doctype":
      return "a misplaced <!doctype>";
    case "declaration":
      return 'a "<!" or "<?" declaration';
    case "comment":
      return "a comment";
  }
}

/**
 * @typedef {"present" | "missing" | "not first in <head>" | "not the expected policy"} PolicyStatus
 */

/**
 * Checks 1 and 2 of the header: the policy tag comes first in <head> and
 * carries exactly the policy vite.config.ts injects.
 * @param {Token[]} tokenList
 * @param {(offset: number) => number} lineOf
 * @returns {{ status: PolicyStatus, problems: string[] }}
 */
function checkPolicy(tokenList, lineOf) {
  const at = tokenList.findIndex(
    (token) => token.kind === "tag" && isPolicyMeta(token.tag),
  );
  const meta = tokenList[at];
  if (meta === undefined || meta.kind !== "tag") {
    return { status: "missing", problems: [MISSING_POLICY] };
  }

  const early = firstTokenBeforePolicy(tokenList, at);
  if (early !== null) {
    return {
      status: "not first in <head>",
      problems: [
        MISSING_POLICY,
        `${describeToken(early)} at line ${lineOf(early.start)} comes before the Content Security Policy <meta> tag at line ${lineOf(meta.start)}. ` +
          "Only a doctype, comments, <html> and the first <head> may (the build injects the tag first in <head>): " +
          "anything else can end <head> early, hide the tag as text or inert content, or come before what it must cover",
      ],
    };
  }

  const raw = meta.tag.attrs.get("content") ?? "";
  if (decodeReferences(raw) !== CONTENT_SECURITY_POLICY) {
    return {
      status: "not the expected policy",
      problems: [
        `the Content Security Policy <meta> tag at line ${lineOf(meta.start)} is not the policy in ${POLICY_MODULE}: its content is ${quoted(raw)}`,
      ],
    };
  }
  return { status: "present", problems: [] };
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
 * @property {{ script: number, stylesheet: number, modulepreload: number, inline: number, csp: PolicyStatus }} counts
 */

/**
 * @param {string} html
 * @param {string} base
 * @param {string} distDir
 * @returns {Report}
 */
function checkHtml(html, base, distDir) {
  const lineOf = makeLineOf(html);
  const { tokens: tokenList, errors } = tokenize(html);
  /** @type {string[]} */
  const problems = [...errors];

  const policy = checkPolicy(tokenList, lineOf);
  problems.push(...policy.problems);

  const counts = {
    script: 0,
    stylesheet: 0,
    modulepreload: 0,
    inline: 0,
    csp: policy.status,
  };

  for (const token of tokenList) {
    if (token.kind !== "tag" || token.tag.closing) continue;
    const tag = token.tag;

    if (FOREIGN_ELEMENTS.has(tag.name)) {
      problems.push(
        `<${tag.name}> at line ${lineOf(tag.start)}: index.html may not contain svg or math, because inside them <title>, <style> and <textarea> hold markup rather than text, and a <script> there would run unseen by this check`,
      );
      continue;
    }

    /** @type {{ kind: string, label: string, url: string } | null} */
    let resource = null;
    if (tag.name === "script") {
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
      const rel = spaceSeparated(tag.attrs.get("rel") ?? "");
      const kind = rel.includes("stylesheet")
        ? "stylesheet"
        : rel.includes("modulepreload")
          ? "modulepreload"
          : null;
      if (kind !== null) {
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
          `${resource.label} ${quoted(resource.url)} at line ${lineOf(tag.start)} ${why}`,
        );
      } else if (!assetExists(resource.url, base, distDir)) {
        problems.push(
          `${resource.label} ${quoted(resource.url)} names a file that is not in the build output`,
        );
      }
    }
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
        csp: "missing",
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
      `${counts.inline} inline script(s), Content Security Policy meta ${counts.csp}`,
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

/**
 * An attribute value escaped the way Vite writes it (escape-html).
 * @param {string} value
 */
function escapeAttribute(value) {
  let escaped = "";
  for (const char of value) {
    escaped +=
      char === "&"
        ? "&amp;"
        : char === '"'
          ? "&quot;"
          : char === "'"
            ? "&#39;"
            : char === "<"
              ? "&lt;"
              : char === ">"
                ? "&gt;"
                : char;
  }
  return escaped;
}

/**
 * A Content Security Policy <meta> tag as the build writes it.
 * @param {string} [policy]
 */
function policyMeta(policy = CONTENT_SECURITY_POLICY) {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">`;
}

const CSP_META = policyMeta();

/**
 * An index.html shaped like the build's output, with `overrides` for one
 * deviation per case. `beforeCsp` and `afterCsp` wrap the policy tag inside
 * <head>; `head` replaces the "<!doctype html>...<head>" opening.
 * @param {string} base
 * @param {{ csp?: string, script?: string, extra?: string, beforeCsp?: string, afterCsp?: string, head?: string }} [overrides]
 */
function fixtureHtml(base, overrides = {}) {
  const csp = overrides.csp ?? CSP_META;
  const script =
    overrides.script ??
    `<script type="module" crossorigin src="${base}assets/index-abc123.js"></script>`;
  return [
    overrides.head ?? '<!doctype html>\n<html lang="en">\n  <head>',
    `    ${overrides.beforeCsp ?? ""}${csp}${overrides.afterCsp ?? ""}`,
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

  /**
   * The policy tag wrapped in an element, or after something, that keeps a
   * browser from applying it, though a reader that only asks "is it inside
   * <head>?" would say it is: [where, before it, after it, what is named].
   * @type {[string, string, string, string][]}
   */
  const misplaced = [
    ["inside <noscript> in <head>", "<noscript>", "</noscript>", "<noscript>"],
    ["inside <template>", "<template>", "</template>", "<template>"],
    ["inside <noframes>", "<noframes>", "</noframes>", "<noframes>"],
    ["inside <iframe>", "<iframe>", "</iframe>", "<iframe>"],
    ["inside <noembed>", "<noembed>", "</noembed>", "<noembed>"],
    ["inside <xmp>", "<xmp>", "</xmp>", "<xmp>"],
    ["after <plaintext>", "<plaintext>", "", "<plaintext>"],
    ["after a <div> in <head>", "<div></div>", "", "<div>"],
    ["after stray text in <head>", "TaxReporter ", "", "text"],
    ["after a <title>", "<title>x</title>", "", "<title>"],
    [
      "after a script",
      `<script type="module" src="${base}assets/index-abc123.js"></script>`,
      "",
      "<script>",
    ],
    ["after a second <head>", "</head><body><head>", "", "</head>"],
  ];

  try {
    run(
      "a build under the expected base is accepted",
      fixtureHtml(base),
      base,
      0,
      "Content Security Policy meta present",
    );
    run(
      "upper-case tag and attribute names are accepted",
      fixtureHtml(base, {
        head: "<!DOCTYPE html>\n<HTML LANG=en>\n  <HEAD>",
        csp: `<META HTTP-EQUIV="Content-Security-Policy" CONTENT="${escapeAttribute(CONTENT_SECURITY_POLICY)}">`,
      }),
      base,
      0,
      "Content Security Policy meta present",
    );
    run(
      "reordered, unquoted and slash-separated attributes are accepted",
      fixtureHtml(base, {
        csp: `<meta/content="${escapeAttribute(CONTENT_SECURITY_POLICY)}"/http-equiv=Content-Security-Polic&#121;>`,
      }),
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
      "a policy tag further down <head> is rejected",
      fixtureHtml(base, { csp: "", extra: CSP_META }),
      base,
      1,
      "<meta> at line 5 comes before the Content Security Policy <meta> tag at line 8",
    );
    for (const [where, before, after, named] of misplaced) {
      run(
        `a policy tag ${where} is rejected`,
        fixtureHtml(base, { beforeCsp: before, afterCsp: after }),
        base,
        1,
        `${named} at line 4 comes before the Content Security Policy <meta> tag at line 4`,
      );
    }
    run(
      "a policy tag after a repeated http-equiv whose first value is not the policy is rejected",
      fixtureHtml(base, {
        csp: `<meta http-equiv="refresh" http-equiv="Content-Security-Policy" content="${escapeAttribute(CONTENT_SECURITY_POLICY)}">`,
      }),
      base,
      1,
      "no Content Security Policy",
    );
    run(
      "a permissive policy is rejected",
      fixtureHtml(base, {
        csp: policyMeta("script-src * 'unsafe-inline' 'unsafe-eval'"),
      }),
      base,
      1,
      `is not the policy in ${POLICY_MODULE}`,
    );
    run(
      "a policy whose first content attribute is permissive is rejected",
      fixtureHtml(base, {
        csp: `<meta http-equiv="Content-Security-Policy" content="default-src *" content="${escapeAttribute(CONTENT_SECURITY_POLICY)}">`,
      }),
      base,
      1,
      `is not the policy in ${POLICY_MODULE}`,
    );
    run(
      "a policy with only some of the directives is rejected",
      fixtureHtml(base, {
        csp: policyMeta("default-src 'self'; script-src 'self'"),
      }),
      base,
      1,
      `is not the policy in ${POLICY_MODULE}`,
    );
    run(
      "a script inside an SVG <title> is rejected",
      fixtureHtml(base, {
        extra: "<svg><title><script>window.x = 1</script></title></svg>",
      }),
      base,
      1,
      "<svg> at line 8: index.html may not contain svg or math",
    );
    run(
      "a script inside a MathML <style> is rejected",
      fixtureHtml(base, {
        extra: "<math><style><script>window.x = 1</script></style></math>",
      }),
      base,
      1,
      "<math> at line 8: index.html may not contain svg or math",
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
