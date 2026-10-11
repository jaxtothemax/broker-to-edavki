/**
 * A bounded CSV reader for broker exports. Every imported file is hostile
 * (CLAUDE.md, "Secure code"), so it reads in one linear pass without regular
 * expressions, caps the size of everything, and refuses rather than repairs:
 * a stray quote, a row with too few or too many cells, or a repeated header
 * name stops the import instead of shifting a value into the wrong column.
 *
 * RFC 4180, plus what broker exports add: an optional byte-order mark, LF or
 * CRLF line ends, empty lines, which carry no data and are skipped, and a
 * semicolon in place of the comma, as one revision of Trade Republic's
 * export (research 07 §4.2) and DEGIRO's continental-European exports
 * write (research 07 §4.4). The header
 * line chooses the delimiter before any row is read; see `delimiterOf`.
 * Errors name a rule and a row number, never a value from the file.
 */
import { LIMITS, type CsvReason } from "@taxreporter/core";

export interface CsvLimits {
  /** Characters of text, checked before anything is read. */
  readonly maxLength: number;
  /** Data rows, the header not counted. */
  readonly maxRows: number;
  readonly maxColumns: number;
  /** Characters in one cell. */
  readonly maxCellLength: number;
}

/**
 * Far above any real export: a year of Trading 212 history is a few
 * thousand rows of under 300 characters, and its widest header has about 40
 * columns.
 */
export const CSV_LIMITS: CsvLimits = Object.freeze({
  // Characters, a backstop for the byte cap: UTF-8 never has more
  // characters than bytes.
  maxLength: LIMITS.fileBytes,
  maxRows: LIMITS.recordsPerFile,
  maxColumns: LIMITS.columns,
  maxCellLength: LIMITS.cellLength,
});

/** The codes are core's, so a diagnostic can only carry one of them. */
export type CsvErrorCode = CsvReason;

export class CsvError extends Error {
  constructor(
    readonly code: CsvErrorCode,
    /** The row as a spreadsheet numbers it (the header is row 1); 0 for the file. */
    readonly row: number,
  ) {
    super(`CSV ${code} at row ${String(row)}`);
    this.name = "CsvError";
  }
}

export interface CsvRow {
  /** As a spreadsheet numbers it, empty lines included: the header is row 1. */
  readonly row: number;
  readonly cells: readonly string[];
}

/** The two delimiters a broker export uses between cells. */
export type CsvDelimiter = "," | ";";

export interface CsvTable {
  /**
   * The delimiter the header line chose. An adapter ties each header it
   * knows to the delimiter that header was seen with, so a file re-saved by
   * a spreadsheet in another locale fails as a whole, not row by row.
   */
  readonly delimiter: CsvDelimiter;
  readonly header: readonly string[];
  readonly rows: readonly CsvRow[];
  /**
   * The index of a column by its exact header name. A Map behind it, so no
   * header name (`__proto__`, `constructor`) can reach an object prototype.
   */
  column(name: string): number | undefined;
}

const QUOTE = 0x22;
const COMMA = 0x2c;
const SEMICOLON = 0x3b;
const LF = 0x0a;
const CR = 0x0d;
const BOM = 0xfeff;

/**
 * The delimiter of the header line: the first line with text, past the
 * byte-order mark and any empty lines, as the reader skips them. A comma
 * outside quotes chooses the comma, as before semicolons were read, so
 * every file that read before reads the same; a header with only
 * semicolons outside quotes chooses the semicolon. Choosing wrong cannot
 * misread a file: adapters match exact header names, so a wrong split ends
 * in an unknown format or a row of the wrong length. One pass to the end of
 * the line, quotes respected (a doubled quote toggles twice), no regular
 * expression.
 */
function delimiterOf(text: string, start: number): CsvDelimiter {
  let pos = start;
  // Empty lines first, LF or CRLF, as the reader skips them.
  for (;;) {
    const c = text.charCodeAt(pos);
    if (c === LF) pos += 1;
    else if (c === CR && text.charCodeAt(pos + 1) === LF) pos += 2;
    else break;
  }
  let quoted = false;
  let semicolons = false;
  for (; pos < text.length; pos += 1) {
    const c = text.charCodeAt(pos);
    if (c === QUOTE) {
      quoted = !quoted;
    } else if (!quoted) {
      if (c === COMMA) return ",";
      if (c === SEMICOLON) semicolons = true;
      else if (c === LF || c === CR) break;
    }
  }
  return semicolons ? ";" : ",";
}

/** Reads `text` as CSV with a header row; see the module comment for the rules. */
export function readCsv(
  text: string,
  limits: CsvLimits = CSV_LIMITS,
): CsvTable {
  if (text.length > limits.maxLength) throw new CsvError("tooLarge", 0);
  const end = text.length;
  let pos = text.charCodeAt(0) === BOM ? 1 : 0;
  const delimiter = delimiterOf(text, pos);
  const separator = delimiter === ";" ? SEMICOLON : COMMA;
  let row = 0;
  let header: string[] | undefined;
  let headerRow = 0;
  const rows: CsvRow[] = [];

  /** True at a line end: LF, or CR followed by LF. */
  const lineEnd = (at: number) => {
    const c = text.charCodeAt(at);
    return c === LF || (c === CR && text.charCodeAt(at + 1) === LF);
  };
  const skipLineEnd = () => {
    pos += text.charCodeAt(pos) === CR ? 2 : 1;
  };

  while (pos < end) {
    row += 1;
    if (lineEnd(pos)) {
      skipLineEnd();
      continue;
    }
    const cells: string[] = [];
    for (;;) {
      if (cells.length === limits.maxColumns) {
        throw new CsvError("tooManyColumns", row);
      }
      let cell: string;
      if (text.charCodeAt(pos) === QUOTE) {
        // Quoted: "" stands for a quote, and everything else is literal,
        // line breaks and delimiters included.
        pos += 1;
        const parts: string[] = [];
        let length = 0;
        for (;;) {
          const close = text.indexOf('"', pos);
          if (close === -1) throw new CsvError("unterminatedQuote", row);
          length += close - pos;
          if (length > limits.maxCellLength) {
            throw new CsvError("cellTooLong", row);
          }
          parts.push(text.slice(pos, close));
          pos = close + 1;
          if (text.charCodeAt(pos) !== QUOTE) break;
          parts.push('"');
          length += 1;
          pos += 1;
        }
        cell = parts.join("");
        // After the closing quote: a delimiter, a line end or the end of text.
        if (pos < end && text.charCodeAt(pos) !== separator && !lineEnd(pos)) {
          throw new CsvError("strayQuote", row);
        }
      } else {
        // Unquoted: up to the next delimiter or line end. A quote inside is
        // not RFC 4180, and a lone CR is no line end: both are refused.
        let at = pos;
        while (at < end) {
          const c = text.charCodeAt(at);
          if (c === separator || c === LF) break;
          if (c === CR) {
            if (text.charCodeAt(at + 1) === LF) break;
            throw new CsvError("strayCarriageReturn", row);
          }
          if (c === QUOTE) throw new CsvError("strayQuote", row);
          at += 1;
          if (at - pos > limits.maxCellLength) {
            throw new CsvError("cellTooLong", row);
          }
        }
        cell = text.slice(pos, at);
        pos = at;
      }
      cells.push(cell);
      if (pos < end && text.charCodeAt(pos) === separator) {
        pos += 1;
        continue;
      }
      if (pos < end) skipLineEnd();
      break;
    }

    if (header === undefined) {
      header = cells;
      headerRow = row;
      continue;
    }
    if (cells.length !== header.length) throw new CsvError("rowLength", row);
    if (rows.length === limits.maxRows) throw new CsvError("tooManyRows", row);
    rows.push({ row, cells });
  }

  if (header === undefined) throw new CsvError("noHeader", 0);
  const columns = new Map<string, number>();
  for (const [index, name] of header.entries()) {
    if (name === "") throw new CsvError("emptyHeaderName", headerRow);
    if (columns.has(name)) {
      throw new CsvError("duplicateHeaderName", headerRow);
    }
    columns.set(name, index);
  }
  return {
    delimiter,
    header,
    rows,
    column: (name) => columns.get(name),
  };
}
