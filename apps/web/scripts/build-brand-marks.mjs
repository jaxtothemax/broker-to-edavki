#!/usr/bin/env node
/**
 * Builds apps/web/src/ui/brandMarks.ts from the vendored SVGs in
 * apps/web/brand-art/: the published wordmarks of the fund houses whose ETFs
 * investors most often hold, matched by the start of a security's name
 * (ISINs cannot say who issued a fund).
 *
 * The art ships inside the app. Fetching a logo from a service would tell
 * that service which securities the user holds, and the app makes no
 * third-party requests (CLAUDE.md, "Privacy"). A fund house without an entry
 * keeps its ticker tile. brand-art/README.md says where each file came from.
 *
 * The SVGs are read as data. Only <svg>, <g> and <path> with the attributes
 * below are accepted; a style, script, image, use, filter, gradient or any
 * other attribute fails the build, because the production CSP
 * (`style-src 'self'`) blocks inline styles and none of it is ever executed.
 *
 * Usage:
 *   node apps/web/scripts/build-brand-marks.mjs          write the module
 *   node apps/web/scripts/build-brand-marks.mjs --check  fail if it is stale
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ART = new URL("../brand-art/", import.meta.url);
const OUT = new URL("../src/ui/brandMarks.ts", import.meta.url);

const MAX_FILE_BYTES = 64 * 1024;
const MAX_PATH_CHARS = 20_000;
const SVG_NS = "http://www.w3.org/2000/svg";
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;
const HEX = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const ATTRIBUTE = /\s*([a-zA-Z-]+)="([^"]*)"/y;

const ALLOWED = {
  svg: ["xmlns", "viewBox"],
  g: ["fill", "fill-rule"],
  path: ["d", "fill", "fill-rule"],
};

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

/** "#abc" and "#ABCDEF" as "#AABBCC", so equal colors compare equal. */
function hexOf(value) {
  const digits = value.slice(1).toUpperCase();
  return digits.length === 3
    ? `#${[...digits].map((c) => c + c).join("")}`
    : `#${digits}`;
}

function attributesOf(file, name, source) {
  const attributes = {};
  let end = 0;
  for (;;) {
    ATTRIBUTE.lastIndex = end;
    const match = ATTRIBUTE.exec(source);
    if (match === null) break;
    if (!ALLOWED[name].includes(match[1])) {
      fail(file, `<${name}> has attribute ${match[1]}, which is not allowed`);
    }
    if (Object.hasOwn(attributes, match[1])) {
      fail(file, `<${name}> repeats ${match[1]}`);
    }
    attributes[match[1]] = match[2];
    end = ATTRIBUTE.lastIndex;
  }
  if (source.slice(end).trim() !== "") {
    fail(file, `<${name}> has attributes this build does not read`);
  }
  return attributes;
}

/** The viewBox and the paths of one SVG, each with the fill it inherits. */
export function readSvg(file, svg) {
  const stack = [];
  const paths = [];
  let viewBox;
  let closed = false;
  let at = 0;
  for (;;) {
    const open = svg.indexOf("<", at);
    if (open === -1) {
      if (svg.slice(at).trim() !== "") fail(file, "text outside a tag");
      break;
    }
    if (svg.slice(at, open).trim() !== "") fail(file, "text inside the svg");
    const close = svg.indexOf(">", open);
    if (close === -1) fail(file, "unterminated tag");
    let inner = svg.slice(open + 1, close);
    at = close + 1;
    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim();
      if (stack.pop()?.name !== name) fail(file, `unbalanced </${name}>`);
      if (name === "svg") closed = true;
      continue;
    }
    const selfClosing = inner.endsWith("/");
    if (selfClosing) inner = inner.slice(0, -1);
    const split = /^([a-zA-Z]+)/.exec(inner);
    if (split === null) fail(file, "a tag this build does not read");
    const name = split[1];
    if (!Object.hasOwn(ALLOWED, name)) fail(file, `<${name}> is not allowed`);
    if (closed) fail(file, "content after </svg>");
    if ((stack.length === 0) !== (name === "svg")) {
      fail(file, "<svg> must be the one root element");
    }
    const attributes = attributesOf(file, name, inner.slice(name.length));
    const parent = stack[stack.length - 1];
    const rule = attributes["fill-rule"];
    if (rule !== undefined && rule !== "evenodd" && rule !== "nonzero") {
      fail(file, "fill-rule must be evenodd or nonzero");
    }
    if (attributes["fill"] !== undefined && !HEX.test(attributes["fill"])) {
      fail(file, "fill must be a hex color");
    }
    const fill = hexOf(attributes["fill"] ?? parent?.fill ?? "#000000");
    const evenOdd =
      rule === undefined ? (parent?.evenOdd ?? false) : rule === "evenodd";
    if (name === "svg") {
      if (attributes["xmlns"] !== SVG_NS) fail(file, "xmlns must be SVG");
      const parts = (attributes["viewBox"] ?? "").trim().split(/\s+/);
      if (parts.length !== 4 || !parts.every((p) => NUMBER.test(p))) {
        fail(file, "viewBox must be four numbers");
      }
      if (Number(parts[2]) <= 0 || Number(parts[3]) <= 0) {
        fail(file, "viewBox must have a size");
      }
      viewBox = parts.join(" ");
    }
    if (name === "path") {
      const d = (attributes["d"] ?? "").replace(/\s+/g, " ").trim();
      if (d === "" || d.length > MAX_PATH_CHARS || !PATH_DATA.test(d)) {
        fail(file, "path data is empty, too long or not plain path data");
      }
      paths.push({ d, fill, evenOdd });
    }
    if (!selfClosing) stack.push({ name, fill, evenOdd });
  }
  if (!closed || viewBox === undefined) fail(file, "no complete <svg>");
  if (paths.length === 0) fail(file, "no <path>");
  return { viewBox, paths };
}

/** The module source, formatted as `make format` leaves it. */
export async function render() {
  const manifest = JSON.parse(readFileSync(new URL("marks.json", ART), "utf8"));
  const seen = new Set();
  const marks = manifest.marks.map((entry) => {
    const file = entry.file;
    if (!ID.test(entry.id) || seen.has(entry.id))
      fail(file, "bad or repeated id");
    seen.add(entry.id);
    if (!/^[a-z0-9-]+\.svg$/.test(file)) fail(file, "bad file name");
    const bytes = readFileSync(new URL(file, ART));
    if (bytes.length > MAX_FILE_BYTES) fail(file, "file is too large");
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      fail(file, "differs from the checksum in marks.json; update both");
    }
    if (
      !Array.isArray(entry.names) ||
      entry.names.length === 0 ||
      !entry.names.every(
        (n) =>
          typeof n === "string" &&
          n === n.toLowerCase() &&
          n.trim() === n &&
          n.length > 2,
      )
    ) {
      fail(
        file,
        "names must be lowercase, trimmed prefixes of three or more characters",
      );
    }
    if (
      typeof entry.source?.url !== "string" ||
      !entry.source.url.startsWith("https://") ||
      typeof entry.source.license !== "string"
    ) {
      fail(file, "a source url and a license are required");
    }
    const { viewBox, paths } = readSvg(file, bytes.toString("utf8"));
    return { entry, viewBox, paths };
  });

  const body = marks
    .map(({ entry, viewBox, paths }) => {
      const pathLines = paths
        .map(
          (p) =>
            `      { d: ${JSON.stringify(p.d)}, fill: ${JSON.stringify(p.fill)}, evenOdd: ${String(p.evenOdd)} },`,
        )
        .join("\n");
      return `  // ${entry.source.url}, ${entry.source.license}\n  {\n    title: ${JSON.stringify(entry.title)},\n    names: ${JSON.stringify(entry.names)},\n    viewBox: ${JSON.stringify(viewBox)},\n    paths: [\n${pathLines}\n    ],\n  },`;
    })
    .join("\n");

  const source = `/**
 * Fund-house wordmarks, matched by the start of a security's name. GENERATED
 * by apps/web/scripts/build-brand-marks.mjs from apps/web/brand-art/ (where
 * each file's source and license are recorded); do not edit by hand.
 *
 * The marks are trademarks of their owners, shown only to identify the
 * security they belong to, as published and unaltered.
 */

export interface BrandPath {
  readonly d: string;
  readonly fill: string;
  readonly evenOdd: boolean;
}

export interface BrandMark {
  readonly title: string;
  /** Lowercase prefixes of the security names this mark stands for. */
  readonly names: readonly string[];
  readonly viewBox: string;
  readonly paths: readonly BrandPath[];
}

export const BRAND_MARKS: readonly BrandMark[] = [
${body}
];
`;
  const { format, resolveConfig } = await import("prettier");
  const file = OUT.pathname;
  const options = (await resolveConfig(file)) ?? {};
  return format(source, { ...options, filepath: file });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const out = await render();
  if (process.argv.includes("--check")) {
    const current = readFileSync(OUT, "utf8");
    if (current !== out) {
      console.error("src/ui/brandMarks.ts is stale: run build-brand-marks.mjs");
      process.exit(1);
    }
    console.log("src/ui/brandMarks.ts is current");
  } else {
    writeFileSync(OUT, out);
    console.log(`wrote ${OUT.pathname}`);
  }
}
