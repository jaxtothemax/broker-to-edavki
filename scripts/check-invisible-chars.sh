#!/usr/bin/env bash
# scripts/check-invisible-chars.sh - no tracked text file may hold a literal
# Unicode format character (category Cf) or a UTF-8 byte-order mark.
#
# ## Why this exists
#
# "Trojan Source" (Boucher and Anderson, 2021; CVE-2021-42574): the bidirectional
# controls U+202A to U+202E and U+2066 to U+2069 make source render in a different
# order than a compiler reads it, so a reviewer approves one program and the build
# runs another. The zero-width characters (U+200B to U+200F, U+2060) and a
# byte-order mark hide a difference in the same way: two identifiers, two strings
# or two diff lines that look identical on screen and are not. This repository
# turns a broker export into a tax return a person signs, so a change nobody can
# see is a change nobody reviewed.
#
# Rule: a file git tracks must contain none of
#
#   - a character whose Unicode general category is Cf (format) - this covers
#     U+202A to U+202E, U+2066 to U+2069, U+200B to U+200F, U+2060 to U+2064,
#     U+FEFF, the soft hyphen U+00AD and the E0000 block of "tag" characters;
#   - the issue's named code points even when the runner's Unicode database does
#     not class them as Cf (the two sets are unioned, so an older database cannot
#     drop one);
#   - a UTF-8 byte-order mark at the start of a file;
#   - any of the above in a PATH NAME.
#
# A test that needs one of these characters writes an escape (\u202E in JS or TS,
# \xEF\xBB\xBF in a byte string) so the source file itself stays plain text.
# Letters outside ASCII (c-caron, s-caron, z-caron) and the euro sign are not
# format characters and are fine. Neither is U+FE0F, the emoji variation
# selector: it is category Mn.
#
# ## What it reads
#
# The INDEX, never the working tree: `git ls-files -s -z` names every tracked
# blob and `git cat-file --batch` streams its content, in 64 KiB pieces through
# an incremental UTF-8 decoder, so memory stays bounded whatever a file's size and
# a character split across two pieces is still seen. Reading the committed
# content rather than the checkout means
#
#   - an ignored or untracked file is never a candidate (a local-only red on a
#     file CI cannot see - scripts/CLAUDE.md, "Scan the repository, not the
#     working directory");
#   - an unstaged edit does not count (CI checks out a commit, so there the
#     index IS the commit; see "does NOT cover" for what that means locally);
#   - `GIT_INDEX_FILE=<other index> bash scripts/check-invisible-chars.sh` scans
#     any tree `git read-tree` can load, without checking it out.
#
# There is no regex: the scan looks at one code point at a time, so it is linear
# in the input and cannot backtrack. A file with a NUL byte in its first 8000 bytes
# is BINARY by git's own rule and is skipped; everything else is decoded as UTF-8
# with invalid bytes replaced, so a stray 0xFF does not hide a character after it.
#
# Output names `path:line:column`, the code point and its Unicode name. It never
# prints the offending line: a bidirectional character in a log reorders the
# surrounding text, and a fixture line is user-shaped data. Path names are printed
# ASCII-escaped for the same reason. The column counts code points.
#
# ## The one exemption
#
#   packages/furs/schemas/*.xsd
#
# The vendored FURS eDavki schemas are byte-exact copies of what FURS publishes.
# Doh_KDVP_9.xsd opens with a UTF-8 byte-order mark and carries a zero-width space
# inside an annotation (line 1254, between "kapita" and "la"); a carve-out for
# the byte-order mark alone would not cover it. Their SHA-256 is pinned in
# packages/furs/schemas/README.md and asserted by packages/furs/src/index.test.ts,
# which also asserts that the directory holds exactly the five pinned .xsd files,
# so the exemption is no wider than the pin: a changed byte, or a sixth file,
# fails a test there. `.gitattributes` stores them `-text` for the same reason.
# Editing them to satisfy this gate would break that pin and ship bytes FURS
# never published.
#
# The rule mirrors that `.gitattributes` stanza on purpose: one directory, one
# suffix, no `**`, and `*` never crosses a `/` - so packages/furs/schemas/README.md
# and a nested directory stay scanned, and so does every other tracked file,
# including packages/brokers/test/fixtures/** (a byte-exact broker CSV with a
# byte-order mark would be flagged by design; write the mark as an escape in the
# test that needs it). The exemption does not skip the files: they are read, and
# the count of characters left uncounted is printed. It is checked in the other
# direction too: a rule that matches no tracked file is STALE and fails the run,
# so the list cannot outlive the files it excuses.
#
# scripts/CLAUDE.md warns that an excluded tree becomes a deferral when its
# contents are copied into a scanned location. The schemas are imported and
# read as bytes, never authored and never copied into a scanned file.
#
# ## What this gate does NOT cover
#
#   - Binary files (a NUL in the first 8000 bytes, git's rule), which includes any
#     UTF-16 or UTF-32 file and so its byte-order mark. A hostile change can
#     plant a NUL in a source file to make git, and this gate, treat it as binary;
#     check-nul-bytes.sh catches that for the paths .gitattributes declares
#     `text` (the JS and TS family with .mjs .cjs .mts .cts, scripts/wt, the git
#     hooks and the Makefile, and its --self-test proves those against the real
#     .gitattributes), and nothing catches it for a path left at `* text=auto`:
#     .svg, .snap and .example files, extensionless files such as LICENSE and the
#     dotfiles, and load-bearing.declarations.
#   - Submodules (no blob to read) and files outside the index.
#   - The commits a push carries. The index is the checked-out commit in CI, so
#     there the scan is exact; locally it is HEAD plus whatever is staged, so a
#     committed violation with a staged fix passes `make pre-push`, and a
#     staged violation that is not being pushed fails it. CI is authoritative.
#   - Invisible characters that are not category Cf: the Hangul fillers
#     U+115F, U+1160 and U+3164, U+2800 (braille blank), the Zs spaces, variation
#     selectors and other category Mn marks; and the line and paragraph
#     separators U+2028 and U+2029 (Zl, Zp), which a viewer and a compiler can
#     disagree about as line ends. Control characters other than NUL (category
#     Cc) are not examined either.
#   - Homoglyphs and confusables (CVE-2021-42694): a Cyrillic "a" in a Latin
#     identifier is visible Unicode, not a format character.
#   - Which characters are Cf comes from the runner's Python `unicodedata`, so a
#     character a newer Unicode adds to Cf is caught only once the runner's
#     Python knows it. The named set above does not depend on it.
#
# ## Usage
#
#   scripts/check-invisible-chars.sh              # scan the tracked tree
#   scripts/check-invisible-chars.sh --list       # discovery only: how each tracked file is classified
#   scripts/check-invisible-chars.sh --self-test  # prove the check can still fail
#
# ## Exit codes
#
#   0  no tracked file holds a forbidden character
#   1  a violation, or a stale exemption (the gate said no)
#   2  the gate itself could not run - git or python3 failed, a rule is
#      malformed, or no file was scanned. Never a verdict about the tree.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# One rule per element: <directory>/*<suffix>. See "The one exemption" above for
# why this entry exists and why it is the only one; add another only with the pin
# or the primary source that makes its bytes untouchable.
EXEMPT_RULES=(
  "packages/furs/schemas/*.xsd"
)

# Run the scan in python3. Usage: run_python <scan|list> <root> [exemption-rule...]
#
# Python exits 0 (clean), 10 (a violation), 11 (only a stale exemption) or 2 (it
# could not do its job). An uncaught Python exception exits 1, which is exactly
# the code a rejection would use, so every exception is caught below and turned
# into 2; run_check then refuses any 0 or 10/11 that arrives without the
# `scan:` count line, because only a scan that finished prints one.
run_python() {
  python3 -I - "$@" <<'PY'
import codecs
import subprocess
import sys
import unicodedata

CHUNK = 1 << 16  # bytes per read; the unit the incremental decoder sees
SNIFF = 8000  # git's binary heuristic looks at this many leading bytes
PRINT_CAP = 10  # findings printed per file; the totals are always complete
RC_VIOLATION = 10
RC_STALE = 11
BOM = chr(0xFEFF)

# The code points the issue names, unioned with category Cf.
NAMED = set()
for _lo, _hi in ((0x200B, 0x200F), (0x202A, 0x202E), (0x2060, 0x2060), (0x2066, 0x2069), (0xFEFF, 0xFEFF)):
    NAMED.update(range(_lo, _hi + 1))


class Broken(Exception):
    """The gate could not do its job. Never a verdict about the tree."""


def forbidden(ch):
    return ord(ch) in NAMED or unicodedata.category(ch) == "Cf"


def label(ch, at_start):
    if at_start and ch == BOM:
        return "U+FEFF byte-order mark"
    return "U+%04X %s" % (ord(ch), unicodedata.name(ch, "format character"))


def show(path):
    # A bidirectional character in a path name would reorder the log line.
    return path.encode("ascii", "backslashreplace").decode("ascii")


def git(root, *args):
    done = subprocess.run(["git", "-C", root] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if done.returncode != 0:
        raise Broken("git %s failed: %s" % (args[0], done.stderr.decode("utf-8", "replace").strip()))
    return done.stdout


def parse_rule(rule):
    directory, slash, pattern = rule.rpartition("/")
    suffix = pattern[1:]
    if not slash or not directory or "*" in directory or not pattern.startswith("*") or not suffix or "*" in suffix:
        raise Broken("malformed exemption rule %r (want <directory>/*<suffix>)" % rule)
    return directory, suffix


def matching_rule(rules, path):
    directory, slash, name = path.rpartition("/")
    for index, (rule_dir, suffix) in enumerate(rules):
        if slash and directory == rule_dir and name.endswith(suffix):
            return index
    return -1


def tracked_entries(root):
    for record in git(root, "ls-files", "-s", "-z").split(b"\0"):
        if not record:
            continue
        meta, tab, raw = record.partition(b"\t")
        fields = meta.split(b" ")
        if not tab or len(fields) != 3:
            raise Broken("unexpected record from git ls-files -s")
        yield fields[0], fields[1], raw.decode("utf-8", "surrogateescape")


class Blobs:
    """One `git cat-file --batch`, asked for one blob at a time (no pipe to fill)."""

    def __init__(self, root):
        self.proc = subprocess.Popen(
            ["git", "-C", root, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE
        )

    def chunks(self, sha):
        """Yield (bytes, is_last). The generator must be drained to stay in step with git."""
        self.proc.stdin.write(sha + b"\n")
        self.proc.stdin.flush()
        header = self.proc.stdout.readline().split()
        if len(header) != 3 or header[1] != b"blob":
            raise Broken("git cat-file did not answer with a blob")
        left = int(header[2])
        if left == 0:
            yield b"", True
        while left > 0:
            buf = self.proc.stdout.read(min(left, CHUNK))
            if not buf:
                raise Broken("git cat-file ended in the middle of a blob")
            left -= len(buf)
            yield buf, left == 0
        self.proc.stdout.read(1)

    def close(self):
        self.proc.stdin.close()
        if self.proc.wait() != 0:
            raise Broken("git cat-file exited non-zero")

    def abort(self):
        self.proc.kill()
        self.proc.wait()


def scan_blob(chunks):
    """Return (binary, total, kept); kept holds the first PRINT_CAP findings as (line, col, text)."""
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    line, col, total, kept, binary, started = 1, 1, 0, [], False, False
    for buf, last in chunks:
        if not started:
            started = True
            binary = b"\0" in buf[:SNIFF]
        if binary:
            continue  # keep draining: the stream must be read to its end
        text = decoder.decode(buf, last)
        if text.isascii():
            newlines = text.count("\n")
            if newlines:
                line += newlines
                col = len(text) - text.rfind("\n")
            else:
                col += len(text)
            continue
        for ch in text:
            if ch == "\n":
                line += 1
                col = 1
                continue
            if forbidden(ch):
                total += 1
                if len(kept) < PRINT_CAP:
                    kept.append((line, col, label(ch, line == 1 and col == 1)))
            col += 1
    return binary, total, kept


def main(mode, root, raw_rules):
    if mode not in ("scan", "list"):
        raise Broken("unknown mode %r" % mode)
    rules = [parse_rule(r) for r in raw_rules]
    rule_hits = [0] * len(rules)
    n = {"tracked": 0, "scanned": 0, "binary": 0, "submodule": 0, "exempt": 0, "uncounted": 0, "violations": 0}
    entries = list(tracked_entries(root))
    blobs = Blobs(root)
    try:
        for entry_mode, sha, path in entries:
            n["tracked"] += 1
            if entry_mode == b"160000":
                n["submodule"] += 1
                kind = "submodule"
            else:
                binary, total, kept = scan_blob(blobs.chunks(sha))
                rule = matching_rule(rules, path)
                if rule >= 0:
                    rule_hits[rule] += 1
                if binary:
                    n["binary"] += 1
                    kind = "binary"
                else:
                    n["scanned"] += 1
                    kind = "exempt" if rule >= 0 else "scan"
                if kind == "exempt":
                    n["exempt"] += 1
                    n["uncounted"] += total
                    if mode == "scan":
                        print("  exempt: %s (%d character(s) not counted; rule %s/*%s)" % (show(path), total, *rules[rule]))
                elif kind == "scan" and mode == "scan":
                    n["violations"] += total
                    for found_line, found_col, text in kept:
                        print("  VIOLATION: %s:%d:%d %s" % (show(path), found_line, found_col, text))
                    if total > len(kept):
                        print("  VIOLATION: %s: and %d more" % (show(path), total - len(kept)))
            if mode == "scan":
                for ch in path:
                    if forbidden(ch):
                        n["violations"] += 1
                        print("  VIOLATION: %s: the path name contains %s" % (show(path), label(ch, False)))
            else:
                print("%s\t%s" % (kind, show(path)))
    except BaseException:
        blobs.abort()
        raise
    blobs.close()
    if n["scanned"] == 0:
        raise Broken("no file was scanned (%d tracked), so nothing was checked" % n["tracked"])
    stale = [r for r, hits in zip(raw_rules, rule_hits) if hits == 0]
    if mode == "scan":
        for rule in stale:
            print("  STALE EXEMPTION: %s matches no tracked file; remove it from EXEMPT_RULES" % show(rule))
    print(
        "scan: %d tracked, %d scanned, %d binary skipped, %d submodule skipped, %d exempt (%d character(s) not counted), %d violation(s)"
        % (n["tracked"], n["scanned"], n["binary"], n["submodule"], n["exempt"], n["uncounted"], n["violations"])
    )
    if mode == "list":
        return 0
    if n["violations"]:
        return RC_VIOLATION
    return RC_STALE if stale else 0


try:
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3:]))
except Broken as exc:
    sys.stderr.write("check-invisible-chars: ERROR - %s\n" % exc)
    sys.exit(2)
except Exception as exc:  # an uncaught one would exit 1, the code for "violation"
    sys.stderr.write("check-invisible-chars: ERROR - %s: %s\n" % (type(exc).__name__, exc))
    sys.exit(2)
PY
}

# Scan git worktree `$1` against the exemption rules `$2...`. Returns 0 clean,
# 1 rejected, 2 the gate itself failed.
run_check() {
  local root="$1" out status=0
  shift

  out="$(run_python scan "$root" "$@" 2>&1)" || status=$?

  case "$status" in
    0 | 10 | 11)
      if ! grep -q '^scan: ' <<<"$out"; then
        echo "$out" >&2
        echo "check-invisible-chars: the scan exited $status without its count line, so it never finished; nothing was checked." >&2
        return 2
      fi
      ;;
    *)
      echo "$out" >&2
      echo "check-invisible-chars: the gate itself failed (exit $status); nothing was checked." >&2
      return 2
      ;;
  esac

  echo "$out"
  if [ "$status" -eq 0 ]; then
    echo "OK: no tracked file holds a Unicode format character, bidirectional control or byte-order mark (binary files, submodules, non-Cf invisible characters and homoglyphs are not covered; see the header)"
    return 0
  fi

  cat <<'EOF'

A tracked file holds an invisible or bidirectional Unicode format character, or
a UTF-8 byte-order mark (the VIOLATION lines name the file, line and column).
Such a character changes what a reviewer sees without changing what a compiler
or an importer reads (Trojan Source, CVE-2021-42574), and most of them render as
nothing at all.

Fix: delete the character. If a test needs it, write an escape in the test
instead of the literal: \u202E in JS or TS, \xEF\xBB\xBF in a byte string.

If the file is a vendored, byte-pinned copy whose bytes must not change, the
exemption belongs in EXEMPT_RULES in scripts/check-invisible-chars.sh, with the
pin that protects those bytes. A STALE EXEMPTION line means a rule there matches
no tracked file any more: delete the rule.
EOF
  return 1
}

# A gate that has only ever been observed passing is indistinguishable from one
# with a typo in its pattern. Every case builds a real git repository, stages it,
# and runs the real decision path against it. Each demands the EXACT exit code
# and the gate's own count line: exit 1 is a rejection, 2 is "the gate broke",
# and a probe that read any non-zero as "rejected" would pass on a runner with
# no python3 at all.
self_test() {
  local tmp rc=0 got=0 last_out="" target old_path="$PATH"
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand $tmp now, not at trap time
  trap "rm -rf '$tmp'" EXIT

  # Git exports GIT_DIR and its kin to a hook (hooks/pre-push unsets them
  # too); left set, they would point every scratch repository below at this one.
  # shellcheck disable=SC2046  # one variable name per word, by design
  unset $(git rev-parse --local-env-vars)
  # Isolate from the developer's own git config.
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_SYSTEM=/dev/null

  # The characters, as printf octal escapes: this file must not hold them itself.
  local RLO='\342\200\256' ZWSP='\342\200\213' BOM='\357\273\277'

  _fail() {
    echo "SELF-TEST FAIL: $*" >&2
    rc=1
  }
  _show_out() { printf '    %s\n' "${last_out//$'\n'/$'\n    '}" >&2; }
  _fixture() {
    rm -rf "$tmp/repo"
    mkdir -p "$tmp/repo"
    git -C "$tmp/repo" init -q -b main
  }
  _stage() { git -C "$tmp/repo" add -A; }
  _put() { # <relative path> <printf format carrying octal escapes>
    mkdir -p "$(dirname "$tmp/repo/$1")"
    # shellcheck disable=SC2059  # the format IS the fixture: it carries the escapes
    printf "$2" >"$tmp/repo/$1"
  }
  # <name> <want-exit> <needle> [exemption-rule...] - run against $tmp/repo.
  _case() {
    local name="$1" want="$2" needle="$3" got=0
    shift 3
    last_out="$(run_check "${target:-$tmp/repo}" "$@" 2>&1)" || got=$?
    if [ "$got" -ne "$want" ]; then
      _fail "$name: expected exit $want, got $got"
      _show_out
      return 0
    fi
    if [ "$want" -ne 2 ] && ! grep -q '^scan: ' <<<"$last_out"; then
      _fail "$name: exit $got but no count line; the scan never finished"
      return 0
    fi
    _has "$name" "$needle"
  }
  _has() { # <name> <needle>
    if ! grep -qF -- "$2" <<<"$last_out"; then
      _fail "$1: output lacks '$2'"
      _show_out
    fi
  }
  _lacks() { # <name> <needle>
    if grep -qF -- "$2" <<<"$last_out"; then
      _fail "$1: output must not contain '$2'"
      _show_out
    fi
  }

  # Case 1: a clean tree, including what looks suspicious but is not Cf - letters
  # outside ASCII, the euro sign, a no-break space, and the emoji variation
  # selector. Must pass; this is the over-matching probe.
  _fixture
  _put src/clean.ts 'export const a = 1;\n'
  _put docs/slovene.md '\304\215\305\241\305\276 \342\202\254 \303\251 \302\240 \342\234\224\357\270\217\n'
  _stage
  _case "a clean tree" 0 "OK:"
  _has "a clean tree" "2 scanned"

  # Case 2: one file per format character, each at line 1 column 2, so a miss is
  # named. U+00AD (soft hyphen) and U+E0041 (a tag character) are Cf but not on
  # the issue's list: they prove the category check, not just the named set.
  local table hex oct
  table='202A \342\200\252
202B \342\200\253
202C \342\200\254
202D \342\200\255
202E \342\200\256
2066 \342\201\246
2067 \342\201\247
2068 \342\201\250
2069 \342\201\251
200B \342\200\213
200C \342\200\214
200D \342\200\215
200E \342\200\216
200F \342\200\217
2060 \342\201\240
FEFF \357\273\277
00AD \302\255
E0041 \363\240\201\201'
  _fixture
  while read -r hex oct; do
    _put "cf-$hex.txt" "x${oct}y\n"
  done <<<"$table"
  _put lines.ts "ok\nab${RLO}cd\n"
  _stage
  _case "every format character" 1 "VIOLATION:"
  while read -r hex oct; do
    _has "format character U+$hex" "cf-$hex.txt:1:2 U+$hex"
  done <<<"$table"
  _has "line and column" "lines.ts:2:3 U+202E"
  _has "a mid-file U+FEFF is not a byte-order mark" "cf-FEFF.txt:1:2 U+FEFF ZERO WIDTH NO-BREAK SPACE"
  _lacks "a mid-file U+FEFF is not a byte-order mark" "cf-FEFF.txt:1:2 U+FEFF byte-order mark"
  _has "the count line" "19 violation(s)"

  # Case 3: a byte-order mark at the start of a file is reported as one, at 1:1.
  _fixture
  _put bom.json "${BOM}{}\n"
  _stage
  _case "a leading byte-order mark" 1 "bom.json:1:1 U+FEFF byte-order mark"
  _has "a leading byte-order mark" "1 violation(s)"

  # Case 4: a path name carrying a format character; printed escaped, never raw.
  _fixture
  _put 'fine.txt' 'ok\n'
  # shellcheck disable=SC2059  # the format carries the escape
  : >"$tmp/repo/$(printf "dir-${RLO}x.txt")"
  _stage
  _case "a format character in a path name" 1 'the path name contains U+202E'
  _has "a path name is printed escaped" 'dir-\u202ex.txt'

  # Case 5: past the 64 KiB read size and the pipe buffer - a violation on the
  # last line of a 230 KB file. Line number must survive every piece.
  _fixture
  {
    awk 'BEGIN { for (i = 0; i < 4000; i++) print "padding line that pushes this file past the pipe buffer" }'
    # shellcheck disable=SC2059  # the format carries the escape
    printf "ab${RLO}cd\n"
  } >"$tmp/repo/late.txt"
  _stage
  _case "a violation past the pipe buffer" 1 "late.txt:4001:3 U+202E"

  # Case 6: a character split across two reads - 65535 ASCII bytes, then the
  # 3-byte U+202E straddling the 64 KiB boundary. The incremental decoder must
  # carry the partial sequence over.
  _fixture
  {
    printf '%065535d' 0
    # shellcheck disable=SC2059  # the format carries the escape
    printf "${RLO}\n"
  } >"$tmp/repo/split.txt"
  _stage
  _case "a character split across two reads" 1 "split.txt:1:65536 U+202E"

  # Case 7: a NUL byte AFTER the first 8000 bytes does not make a file binary
  # (git's rule), so a character after it is still found. A NUL inside the first
  # 8000 bytes does, and the file is skipped - counted, not silent.
  _fixture
  # shellcheck disable=SC2059  # the format carries the escapes
  printf "%09000d\\0${RLO}\n" 0 >"$tmp/repo/late-nul.txt"
  _put early-nul.bin "PK\\003\\004\\0\\0${RLO}${ZWSP}\n"
  _stage
  _case "a NUL past byte 8000 and one before it" 1 "late-nul.txt:1:9002 U+202E"
  _lacks "a binary file is skipped" "early-nul.bin:"
  _has "a binary file is counted, not silent" "1 binary skipped"

  # Case 8: invalid UTF-8 does not hide a character after it.
  _fixture
  _put invalid.txt "x\\377${RLO}\n"
  _stage
  _case "a stray invalid byte before a character" 1 "invalid.txt:1:3 U+202E"

  # Case 9: ignored and untracked files are never candidates, and --list says so.
  _fixture
  printf 'ignored/\n' >"$tmp/repo/.gitignore"
  _put keep.txt 'ok\n'
  _put ignored/bad.txt "a${RLO}b\n"
  _stage
  _put untracked.txt "a${RLO}b\n"
  _case "an ignored and an untracked file" 0 "OK:"
  _lacks "an ignored and an untracked file" "bad.txt"
  _lacks "an ignored and an untracked file" "untracked.txt"
  last_out="$(run_python list "$tmp/repo" 2>&1)" || _fail "--list exited non-zero: $last_out"
  _has "--list sees the tracked file" "$(printf 'scan\tkeep.txt')"
  _lacks "--list does not see an ignored file" "bad.txt"
  _lacks "--list does not see an untracked file" "untracked.txt"

  # Case 10: the exemption is one directory and one suffix. An exempt file passes
  # and is named; a sibling that is not a .xsd, and a .xsd one level down, are
  # still scanned.
  _fixture
  _put src/ok.ts 'ok\n'
  _put schemas/a.xsd "${BOM}<a>x${ZWSP}y</a>\n"
  _stage
  _case "an exempt file" 0 "exempt: schemas/a.xsd (2 character(s) not counted" "schemas/*.xsd"
  _put schemas/README.md "x${ZWSP}y\n"
  _put schemas/sub/b.xsd "x${ZWSP}y\n"
  _stage
  _case "a sibling and a nested file next to an exempt one" 1 "schemas/README.md:1:2 U+200B" "schemas/*.xsd"
  _has "a nested file next to an exempt one" "schemas/sub/b.xsd:1:2 U+200B"
  _lacks "an exempt file is not a violation" "VIOLATION: schemas/a.xsd"

  # Case 11: the REAL rule honors the real path (a typo in EXEMPT_RULES fails
  # here), and still scans the directory's README.
  _fixture
  _put src/ok.ts 'ok\n'
  _put packages/furs/schemas/Doh_KDVP_9.xsd "${BOM}<a>x${ZWSP}y</a>\n"
  _stage
  _case "the real exemption rule" 0 "exempt: packages/furs/schemas/Doh_KDVP_9.xsd" "${EXEMPT_RULES[@]}"
  _put packages/furs/schemas/README.md "x${ZWSP}y\n"
  _stage
  _case "the real rule does not cover the README" 1 "packages/furs/schemas/README.md:1:2 U+200B" "${EXEMPT_RULES[@]}"

  # Case 12: a rule that matches nothing is stale and fails.
  _fixture
  _put src/ok.ts 'ok\n'
  _stage
  _case "a stale exemption" 1 "STALE EXEMPTION: schemas/*.xsd" "schemas/*.xsd"
  _has "a stale exemption" "0 violation(s)"

  # Case 13: the gate failing is exit 2, never 1. A malformed rule, a directory
  # that is not a repository, an empty index, and an exception inside the scan
  # (a git that answers with a size that is not a number) all must say so.
  _fixture
  _put src/ok.ts 'ok\n'
  _stage
  _case "a malformed exemption rule" 2 "malformed exemption rule" "no-star-here"

  mkdir -p "$tmp/plain"
  target="$tmp/plain"
  GIT_CEILING_DIRECTORIES="$tmp" # stop git discovering an enclosing repository
  export GIT_CEILING_DIRECTORIES
  _case "a directory that is not a repository" 2 "git ls-files failed"
  unset GIT_CEILING_DIRECTORIES
  target=""

  _fixture
  _case "an empty index" 2 "no file was scanned"

  _fixture
  _put src/ok.ts 'ok\n'
  _stage
  mkdir -p "$tmp/shim"
  cat >"$tmp/shim/git" <<'SHIM'
#!/bin/sh
# A git whose cat-file answers with a size that is not a number.
case " $* " in
  *" cat-file "*) IFS= read -r sha; printf '%s blob notanumber\n' "$sha"; exit 0 ;;
esac
exec "$REAL_GIT" "$@"
SHIM
  chmod +x "$tmp/shim/git"
  REAL_GIT="$(command -v git)"
  export REAL_GIT
  PATH="$tmp/shim:$old_path"
  _case "an exception inside the scan" 2 "ValueError"
  # run_check would map a Python exit of 1 to 2 as well, so also demand that
  # Python itself turns the exception into 2 and not into the rejection's 1.
  got=0
  run_python scan "$tmp/repo" >/dev/null 2>&1 || got=$?
  [ "$got" -eq 2 ] || _fail "an exception inside the scan: python exited $got, expected 2"
  PATH="$old_path"

  # Case 14: a scan that exits 0 or 10 without its count line never finished, and
  # any other code is the interpreter or the script breaking. A python3 that
  # does nothing stands in for each; none may be read as a verdict.
  mkdir -p "$tmp/shim-py"
  cat >"$tmp/shim-py/python3" <<'SHIM'
#!/bin/sh
exit "${FAKE_PY_EXIT:-0}"
SHIM
  chmod +x "$tmp/shim-py/python3"
  PATH="$tmp/shim-py:$old_path"
  for got in 0 10 11; do
    FAKE_PY_EXIT="$got" _case "a scan that exits $got and prints no count line" 2 "without its count line"
  done
  for got in 1 127; do
    FAKE_PY_EXIT="$got" _case "a python3 that exits $got" 2 "the gate itself failed (exit $got)"
  done
  PATH="$old_path"

  if [ "$rc" -eq 0 ]; then
    echo "SELF-TEST OK: a clean tree, every format character, a leading and a mid-file byte-order mark, a path name, a violation past the pipe buffer and across a read boundary, binary and invalid-UTF-8 files, ignored and untracked files, the exemption (and its limits and staleness), and the gate itself failing (always exit 2, never a verdict) all resolved correctly."
  fi
  return "$rc"
}

case "${1:-}" in
  --self-test)
    self_test
    ;;
  --list)
    run_python list "$REPO_ROOT" "${EXEMPT_RULES[@]}"
    ;;
  "")
    status=0
    run_check "$REPO_ROOT" "${EXEMPT_RULES[@]}" || status=$?
    exit "$status"
    ;;
  *)
    echo "usage: scripts/check-invisible-chars.sh [--list | --self-test]" >&2
    exit 2
    ;;
esac
