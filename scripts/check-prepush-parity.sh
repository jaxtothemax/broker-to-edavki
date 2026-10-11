#!/usr/bin/env bash
# Every CI gate script has a pre-push mirror, or a recorded reason it cannot.
#
# ## Why this exists
#
# `pre-push` mirrored eight bespoke CI gates. A ninth — of exactly that shape —
# was not among them, so the one gate policing a design-token ratchet was the
# one nobody could run before pushing. A breach passed `make pre-push` cleanly
# and failed the PR's CI run: precisely the round trip `pre-push` exists to
# prevent.
#
# It was not missed through carelessness. Two Make targets one character apart
# (`lint-web`, which ran it, and `web-lint`, which did not) meant the invocation
# EXISTED, sitting in a target `pre-push` never called. Nobody reading either
# target could see the hole.
#
# The real defect is that the mirror list was a HISTORICAL ACCRETION: each gate
# added by hand as it was written, with nothing asserting the list stayed
# complete. Fixing the one missing entry would leave that intact and the next
# gate would fall behind the same way. So this script DERIVES the CI set from
# the CI configuration (.github/workflows/*.yml) rather than restating it, and
# fails when a script appears there with neither a Makefile mirror nor an entry in
# OPT_OUT below.
#
# Discovery is a plain text match over the whole workflow file, comments
# included, on purpose: a script named anywhere in a workflow — a commented-out
# opt-in job, a `paths:` filter — is one uncomment away from running in CI, and
# over-matching here costs one Makefile line, while under-matching is the
# silent gap this script exists to close.
#
# ## What counts as a mirror
#
# A gate is mirrored when a Makefile target whose recipe RUNS it is reachable
# from `pre-push-checks` (its prerequisite list, transitively), because that is
# the only thing `make pre-push-checks`, and so the pre-push hook, executes. The
# script's path appearing somewhere in the Makefile is not enough, and neither is
# a target that runs it but that nothing on that list depends on: deleting the
# `pre-push-checks: <target>` line left the recipe, and the recipe of the
# gate-self-tests target, still naming the script, so the old text match stayed
# green while the push stopped running the gate. A comment inside a recipe names
# a file; it does not run it, and is ignored.
#
# A target that is deliberately OFF the pre-push list says so in its own recipe
# with the words "NOT in pre-push-checks" in a comment, followed by the reason
# (check-stale-refs, check-complexity, memory-check and others do). That is the
# recorded reason for the script the target runs, kept beside the target rather
# than copied into OPT_OUT below. The marker is opt-in and means one thing; put it
# on a gate that does run before a push and the reason has to survive review.
#
# "Gate" here is the naming rule check-gate-selftest-parity.sh uses (a basename
# starting `check-`/`check_` or ending `-check.<ext>`, and not a `.test.` file).
# Only gates get the reachability requirement. Every other script directly under
# the repository's top-level scripts/ keeps the old rule (its path appears in the
# Makefile), so release.sh, doctor.sh and the like are held to exactly what they
# were held to before. A script below a nested directory is discovered only if it
# is a gate: scripts/lib/ and scripts/tests/ hold sourced helpers and test
# suites, not gates, and were never in this script's scope.
#
# Paths are compared whole. `scripts/check-x.mjs` in the Makefile does not mirror
# `apps/web/scripts/check-x.mjs`, and the other way round.
#
# ## Limits
#
# A path is resolved from the repository root. A match cannot hold a `$`, a quote
# or a brace, so `"$GITHUB_WORKSPACE/scripts/x.sh"` reads as GITHUB_WORKSPACE/scripts/x.sh
# and `${{ github.workspace }}/scripts/x.sh` as /scripts/x.sh. A path that is not
# a file loses its leading components one at a time, for as long as what is left
# still has a scripts/ component, and the first file found (the longest suffix)
# is the one checked. A gate that still names no file FAILS when a workflow line
# that is not a comment names it: a deleted gate, a prefix this cannot strip, or a
# path relative to `working-directory:` (`node scripts/x.mjs` under
# `working-directory: apps/web`). Write the path from the root, as docs.yml does.
# A gate named only in a comment and absent is listed and skipped, because prose
# names placeholders (governance.yml's header does). A `#` inside a string on a
# run: line reads as a comment here too, so a missing gate after one is listed,
# not failed. A recipe that runs a gate through a Make variable, or
# through `$(MAKE) <other target>`, is not followed either; that reads as
# unmirrored and fails loudly, which is the safe direction.
#
# A target that runs only `<gate> --self-test` counts as that gate's mirror, for
# any gate. check-pages-build needs exactly that (its real scan reads a Vite build
# the push does not make), and it is also a hole: cut any other mirror's recipe
# down to its self-test and this stays green while the push stops running the
# scan. Nothing here asks why a mirror is self-test only; review has to.
#
# ## Usage
#
#   bash scripts/check-prepush-parity.sh [--self-test]
#
# ## Exit codes
#
#   0  every CI gate script is mirrored or opted out
#   1  at least one is neither
#   2  no CI configuration found, or the scan of it failed

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ─── Self-test ───────────────────────────────────────────────────────────────
#
# Per scripts/CLAUDE.md: a gate is only worth its green if it can go red.
# Every case builds a throwaway tree, copies this script into it and runs the copy
# there, so what is exercised is this file end to end: its discovery, its Makefile
# reading and its verdict. Each case demands the EXACT exit code and a phrase from
# the gate's own output: 1 is the gate saying no, and a copy that died on a syntax
# error or a missing tool would read as "rejected" under a plain non-zero test.
if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  rc=0

  mkdir -p "$tmp/scripts" "$tmp/.github/workflows"
  cp "${BASH_SOURCE[0]}" "$tmp/scripts/check-prepush-parity.sh"

  _script() { # <repo-relative path>: a script that exists and does nothing
    mkdir -p "$tmp/$(dirname "$1")"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/$1"
  }
  _ci() { # <path>...: a workflow with one step per path
    {
      printf 'name: ci\non: [pull_request]\njobs:\n  example-job:\n    runs-on: ubuntu-latest\n    steps:\n'
      for _p in "$@"; do printf '      - run: bash %s\n' "$_p"; done
    } > "$tmp/.github/workflows/ci.yml"
  }
  _ci_lines() { # <line>...: a workflow whose steps are these lines, verbatim
    {
      printf 'name: ci\non: [pull_request]\njobs:\n  example-job:\n    runs-on: ubuntu-latest\n    steps:\n'
      for _p in "$@"; do printf '      %s\n' "$_p"; done
    } > "$tmp/.github/workflows/ci.yml"
  }
  _make() { # <Makefile text, printf-escaped>
    # shellcheck disable=SC2059  # the argument IS the Makefile, tabs included
    printf "$1" > "$tmp/Makefile"
  }
  _opted() { # <OPT_OUT line>: a copy of this script with one more opt-out entry
    awk -v e="$1" '{ print } /^OPT_OUT="$/ { print e }' "${BASH_SOURCE[0]}" \
      > "$tmp/scripts/prepush-parity-opted.sh"
  }
  _case() { # <name> <want-exit> <phrase the output must contain> [script, default: the plain copy]
    local name="$1" want="$2" needle="$3" script="${4:-scripts/check-prepush-parity.sh}" got=0 out
    out="$(cd "$tmp" && bash "$script" 2>&1)" || got=$?
    if [ "$got" -ne "$want" ]; then
      echo "SELF-TEST FAILED: $name — expected exit $want, got $got." >&2
      printf '%s\n' "$out" | sed 's/^/    /' >&2
      rc=1; return 0
    fi
    if ! grep -qF -- "$needle" <<< "$out"; then
      echo "SELF-TEST FAILED: $name — exit $got, but the output lacks '$needle'." >&2
      printf '%s\n' "$out" | sed 's/^/    /' >&2
      rc=1; return 0
    fi
    echo "SELF-TEST OK: $name (exit $got)."
  }

  # ── A top-level gate ──
  _script scripts/check-example.sh
  _ci scripts/check-example.sh

  _make 'all:\n\t@true\n'
  _case "a CI gate script with no Makefile mirror is rejected" 1 "scripts/check-example.sh"

  # The shape this gate used to wave through: the target that runs the gate and a
  # gate-self-tests recipe both still name it, but the `pre-push-checks:` line that
  # made the push run it is gone. Another gate keeps the target itself defined.
  _make 'pre-push-checks: other\nother:\n\t@true\ncheck-example:\n\t@bash scripts/check-example.sh\ngate-self-tests:\n\t@bash scripts/check-example.sh --self-test\n'
  _case "a gate whose pre-push-checks line was deleted is rejected" 1 "no target that pre-push-checks depends on"

  _make 'pre-push-checks: check-example\ncheck-example:\n\t@bash scripts/check-example.sh\n'
  _case "a gate on the pre-push-checks line is accepted" 0 "OK:"

  _make 'pre-push-checks: group\ngroup: check-example\ncheck-example:\n\t@bash scripts/check-example.sh\n'
  _case "a gate reached through another target's prerequisites is accepted" 0 "OK:"

  _make 'pre-push-checks: check-example\ncheck-example:\n\t@true\n'
  _case "a listed target that never runs the gate is rejected" 1 "no target that pre-push-checks depends on"

  _make 'pre-push-checks: check-example\ncheck-example:\n\t@# bash scripts/check-example.sh\n\t@true\n'
  _case "a recipe comment that only names the gate is rejected" 1 "no target that pre-push-checks depends on"

  # A mirror that runs only the self-test is a mirror, for every gate: the real scan
  # may need an artifact the push does not build (the nested pages-build gate is
  # one). That it is accepted for every other gate too is a hole ("Limits").
  _make 'pre-push-checks: check-example\ncheck-example:\n\t@bash scripts/check-example.sh --self-test\n'
  _case "a mirror that runs only the gate's self-test is accepted" 0 "OK:"

  # An old-style continuation line is one recipe line.
  _make 'pre-push-checks: check-example\ncheck-example:\n\t@if true; then \\\n\t\tbash scripts/check-example.sh; \\\n\tfi\n'
  _case "a recipe continued over several lines is read whole" 0 "OK:"

  # A target kept off the pre-push list says so in its recipe, with a reason.
  _make 'pre-push-checks: other\nother:\n\t@true\ncheck-example:\n\t@# NOT in pre-push-checks: its oracle is the issue tracker.\n\t@bash scripts/check-example.sh\n'
  _case "a target marked NOT in pre-push-checks records the reason" 0 "1 opted out"
  _make 'pre-push-checks: other\nother:\n\t@true\ncheck-example:\n\t@# NOT in pre-push-checks: its oracle is the issue tracker.\n\t@true\n'
  _case "the marker on a target that does not run the gate excuses nothing" 1 "no target that pre-push-checks depends on"

  # ── A path written behind a variable ──
  # A match cannot hold `$` or a brace, so these read as GITHUB_WORKSPACE/scripts/...
  # and /scripts/...; neither is a file. Skipping them as absent let an unmirrored
  # gate pass. The needle's two leading spaces are the list's indent, so only the
  # resolved path matches it.
  # shellcheck disable=SC2016  # workflow text, not shell to expand
  _ci_lines '- run: bash "$GITHUB_WORKSPACE/scripts/check-example.sh"'
  _make 'all:\n\t@true\n'
  _case "a gate behind \$GITHUB_WORKSPACE/ with no mirror is rejected" 1 "  scripts/check-example.sh"
  _make 'pre-push-checks: check-example\ncheck-example:\n\t@bash scripts/check-example.sh\n'
  _case "a gate behind \$GITHUB_WORKSPACE/ resolves to its mirror" 0 "OK: 1 CI gate script(s) mirrored"
  # shellcheck disable=SC2016  # workflow text, not shell to expand
  _ci_lines '- run: bash ${{ github.workspace }}/scripts/check-example.sh'
  _make 'all:\n\t@true\n'
  _case "a gate behind \${{ github.workspace }}/ with no mirror is rejected" 1 "  scripts/check-example.sh"

  # A gate CI names on a live line that is no file anywhere is a failure; one
  # named only in a comment is listed and skipped.
  _ci_lines '- run: bash scripts/check-gone.sh'
  _case "a gate a run: line names that does not exist is rejected" 1 "named on a workflow line that is not a comment"
  # shellcheck disable=SC2016  # workflow text, not shell to expand
  _ci_lines '# Gates run as `bash scripts/check-gone.sh`.' '- run: echo hi'
  _case "a missing gate named only in a comment is listed, not failed" 0 "named only in a workflow comment, and no such file: scripts/check-gone.sh"

  # ── Nested gates ──
  nested=apps/web/scripts/pages-build/check-nested.mjs
  _script "$nested"
  _ci "$nested"

  _make 'all:\n\t@true\n'
  _case "a nested gate with no mirror is rejected, named by its full path" 1 "$nested"

  # Another file with the same name, mirrored: the whole path is what counts.
  _script scripts/check-nested.mjs
  _make 'pre-push-checks: check-nested\ncheck-nested:\n\t@node scripts/check-nested.mjs\n'
  _case "a top-level script of the same name does not mirror the nested gate" 1 "$nested"

  _make 'pre-push-checks: check-nested\ncheck-nested:\n\t@node apps/web/scripts/pages-build/check-nested.mjs --self-test\n'
  _case "a nested gate on the pre-push-checks line is accepted" 0 "OK:"

  _make 'check-nested:\n\t@node apps/web/scripts/pages-build/check-nested.mjs --self-test\npre-push-checks: other\nother:\n\t@true\n'
  _case "a nested gate whose pre-push-checks line was deleted is rejected" 1 "$nested"

  # Behind a variable, a nested gate resolves to its whole path, not to scripts/...
  # shellcheck disable=SC2016  # workflow text, not shell to expand
  _ci_lines '- run: node "$GITHUB_WORKSPACE/apps/web/scripts/pages-build/check-nested.mjs"'
  _case "a nested gate behind \$GITHUB_WORKSPACE/ with no mirror is rejected" 1 "  $nested"
  _make 'pre-push-checks: check-nested\ncheck-nested:\n\t@node apps/web/scripts/pages-build/check-nested.mjs --self-test\n'
  _case "a nested gate behind \$GITHUB_WORKSPACE/ resolves to its mirror" 0 "OK: 1 CI gate script(s) mirrored"

  # What is not a gate is out of scope below the top level: sourced helpers, test
  # suites and build helpers were never this script's concern.
  _script scripts/lib/helper.sh
  _script scripts/tests/zz-probe.test.sh
  _script apps/web/scripts/build-logos.mjs
  _ci scripts/lib/helper.sh scripts/tests/zz-probe.test.sh apps/web/scripts/build-logos.mjs
  _make 'all:\n\t@true\n'
  _case "nested helpers, test suites and build scripts are not gates" 0 "OK:"

  # ── A top-level script that is not a gate keeps the old rule ──
  _script scripts/tool.sh
  _ci scripts/tool.sh
  _make 'all:\n\t@true\n'
  _case "a script the Makefile never names is rejected" 1 "not named anywhere in the Makefile"
  _make 'all:\n\t@true\nrelease:\n\t@bash scripts/tool.sh\n'
  _case "a non-gate script named in the Makefile is accepted" 0 "OK:"

  # ── Opt-outs ──
  _script scripts/check-example.sh
  _ci scripts/check-example.sh "$nested"
  _make 'all:\n\t@true\n'
  _opted "$(printf 'check-example.sh\tEXTERNAL: the oracle is the issue tracker')"
  _case "OPT_OUT excuses the gate it names, not the one it does not" 1 "$nested" scripts/prepush-parity-opted.sh
  _ci "$nested"
  _opted "$(printf 'check-nested.mjs\tEXTERNAL: the basename, not the path')"
  _case "a nested gate is not excused by its basename" 1 "$nested" scripts/prepush-parity-opted.sh
  _ci scripts/check-example.sh
  _opted "$(printf 'check-example.sh\tEXTERNAL: the oracle is the issue tracker')"
  _case "a top-level gate in OPT_OUT by basename is accepted" 0 "1 opted out" scripts/prepush-parity-opted.sh
  _ci "$nested"
  _opted "$(printf '%s\tEXTERNAL: the oracle is the issue tracker' "$nested")"
  _case "a nested gate in OPT_OUT by its path is accepted" 0 "1 opted out" scripts/prepush-parity-opted.sh

  # ── No CI configuration at all is "could not check", never a pass ──
  rm -rf "$tmp/.github"
  _case "no CI configuration" 2 "no CI configuration found"

  [ "$rc" -eq 0 ] && echo "SELF-TEST: all cases passed."
  exit "$rc"
fi

MAKEFILE="Makefile"

# ─── Opt-outs ────────────────────────────────────────────────────────────────
#
# `pre-push` is a seconds-scale, offline, repo-only gate. Two things disqualify
# a check: it reads state OUTSIDE the working tree (so no commit can fix a
# failure, and a red would block an unrelated push), or it needs a build
# artifact pre-push does not produce.
#
# Both are RECORDED rather than assumed, because "this one is different" is
# exactly the reasoning that produced the gap in the first place. Keep the list
# short, and re-check an entry whenever its script changes. A Makefile target that
# stays off the pre-push list on purpose records its reason in its own recipe (see
# "What counts as a mirror" above) and needs no entry here.
#
# Format: one "basename<TAB>reason" per line; for a script below a nested
# directory, its path from the repository root in place of the basename.
#
# The OSV severity gate is the clearest legitimate case (#37): its oracle is the
# OSV.dev advisory database, reached only by running the osv-scanner binary over
# network — not the repository. Per scripts/CLAUDE.md's "a gate that cannot
# reach its oracle must go RED" corollary, that disqualifies it from pre-push:
# no commit can fix a lookup failure, and a red here would block an unrelated
# push. Its --self-test IS hermetic (synthetic JSON fixtures, no network) and is
# proven in its own CI job before the real scan — see .github/workflows/security.yml — but is
# deliberately not given its own Makefile line either, so this OPT_OUT stays
# the single place that explains the constraint instead of a text-match
# technicality doing it silently.
OPT_OUT="
ci-assert-artifacts.sh	runtime helper a publish job calls on the artifacts IT just built; there is nothing to assert before the job runs. Its behavior is proven by check-artifact-assertions.sh --self-test, which pre-push runs
check-pr-followups.sh	reads the PR description from the GitHub API, which does not exist before the push that opens the PR; run it by hand with --file <description.md>
check-tag-only-jobs.sh	its real run diffs the workflows against the last v* tag, which exists only once a release is cut (the release skill's Step 1), so no commit can fix what it reports; its --self-test is hermetic and runs in CI's tooling-self-tests job
osv-severity-gate.sh	oracle is the OSV.dev advisory database (network), not the repository — see scripts/CLAUDE.md 'a gate that cannot reach its oracle must go RED'
"

# ─── Helpers ─────────────────────────────────────────────────────────────────

# The naming rule check-gate-selftest-parity.sh uses for "a gate": a basename that
# starts `check-` or `check_` or ends `-check.<ext>`, and is not a `.test.` file.
# Keep the two in step.
is_gate_name() {
  case "$1" in
    *.test.sh | *.test.py | *.test.mjs) return 1 ;;
    check-* | check_* | *-check.sh | *-check.py | *-check.mjs) return 0 ;;
  esac
  return 1
}

# Script paths named in stdin, one per line, sorted and de-duplicated, with a
# leading `./` removed. A character class either side of the literal `scripts/`
# keeps the match linear (no nested quantifier to backtrack). The caller still
# checks that `scripts` is a whole path component, so `myscripts/x.sh` is not one.
#
# grep exits 1 for "nothing matched", which is an empty answer, and 2 for a grep
# that is broken (an option a stripped-down image does not know); only the first
# may read as empty (scripts/CLAUDE.md, "|| true on the scan itself").
PATH_RE='[A-Za-z0-9_./-]*scripts/[A-Za-z0-9_./-]+\.(sh|py|mjs)'
script_paths() {
  local out rc=0
  out="$(grep -oE "$PATH_RE")" || rc=$?
  if [ "$rc" -gt 1 ]; then
    echo "ERROR: grep failed (exit ${rc}) while looking for script paths; nothing was checked." >&2
    return 2
  fi
  printf '%s\n' "$out" | sed -e 's|^\./||' -e '/^$/d' | sort -u
}

# The recipe text of the Makefile targets selected by <mode>, comments left out:
#   reach     every target `pre-push-checks` depends on, transitively, itself included
#   declined  every target whose recipe carries a comment saying "NOT in pre-push-checks"
#
# Why a parse and not a text match: what `make pre-push-checks` runs is the
# recipes of the targets on that list, and nothing else in the file. A rule line is
# a name, a colon and prerequisites (several lines for one target add up, which is
# how pre-push-checks is written); a line starting with a tab is a recipe line of
# the rule above it, a trailing backslash continues it, and a blank or comment line
# between recipe lines does not end the recipe. Any other line (an assignment, a
# conditional) ends it. A recipe line that starts with `#` after the tab and the
# @ + - prefixes is a shell comment: it names a file, it does not run it.
makefile_recipes() {
  [ -f "$MAKEFILE" ] || return 0
  awk -v mode="$1" '
    {
      line = $0
      while (line ~ /\\$/) {
        sub(/\\$/, "", line)
        if ((getline nxt) > 0) line = line " " nxt; else break
      }
      if (line ~ /^[ \t]*$/) next
      if (line ~ /^\t/) {
        if (ncur == 0) next
        body = line
        sub(/^\t[ \t@+-]*/, "", body)
        if (body ~ /^#/) {
          if (body ~ /NOT in pre-push-checks/) for (i = 1; i <= ncur; i++) decl[cur[i]] = 1
          next
        }
        for (i = 1; i <= ncur; i++) rec[cur[i]] = rec[cur[i]] "\n" body
        next
      }
      if (line ~ /^[ \t]*#/) next
      ncur = 0
      rule = line
      sub(/[ \t]*#.*$/, "", rule)
      if (rule !~ /^[^:=]+:$/ && rule !~ /^[^:=]+:[^=:]/) next
      colon = index(rule, ":")
      names = substr(rule, 1, colon - 1)
      prereqs = substr(rule, colon + 1)
      gsub(/\|/, " ", prereqs)
      nn = split(names, nm, /[ \t]+/)
      np = split(prereqs, pr, /[ \t]+/)
      for (i = 1; i <= nn; i++) {
        if (nm[i] == "" || nm[i] ~ /[$%]/) continue
        cur[++ncur] = nm[i]
        for (j = 1; j <= np; j++) {
          if (pr[j] != "" && pr[j] !~ /[$%]/) edge[nm[i]] = edge[nm[i]] " " pr[j]
        }
      }
    }
    END {
      if (mode == "declined") {
        for (t in decl) out = out rec[t]
      } else {
        root = "pre-push-checks"
        queue[1] = root; seen[root] = 1; head = 1; tail = 1
        while (head <= tail) {
          t = queue[head++]
          out = out rec[t]
          n = split(edge[t], q, " ")
          for (i = 1; i <= n; i++) if (!(q[i] in seen)) { seen[q[i]] = 1; queue[++tail] = q[i] }
        }
      }
      printf "%s\n", out
    }
  ' "$MAKEFILE"
}

# ─── Discover the CI gate scripts ────────────────────────────────────────────

CI_FILES=()
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$f" ] && CI_FILES+=("$f")
done

if [ "${#CI_FILES[@]}" -eq 0 ]; then
  echo "ERROR: no CI configuration found (.github/workflows/*.yml)." >&2
  exit 2
fi

# Any script under a scripts/ directory that CI names is a script a developer
# should be able to run before pushing: .sh, .py or .mjs (the last for #44's
# Node-based added-files-covered gate, the first non-sh/py gate script in this
# template). Top-level scripts/ files are all in scope; below a nested directory,
# anything at any depth (apps/web/scripts/pages-build/...) is, if it is a gate.
ci_text="$(cat "${CI_FILES[@]}")"
ci_scripts="$(script_paths <<< "$ci_text")"
# The same scan with YAML and shell comments removed: only a path named here makes
# a missing file a failure (see "Limits").
ci_live_scripts="$(script_paths <<< "$(sed -e 's/^[[:space:]]*#.*$//' -e 's/[[:space:]]#.*$//' <<< "$ci_text")")"

if [ -z "$ci_scripts" ]; then
  echo "OK: CI invokes no scripts/ gates yet — nothing to mirror."
  exit 0
fi

# ─── Compare against the Makefile ────────────────────────────────────────────

mk_text=""
if [ -f "$MAKEFILE" ]; then mk_text="$(cat "$MAKEFILE")"; fi
mk_paths="$(script_paths <<< "$mk_text")"                       # named anywhere, comments included
reach_recipes="$(makefile_recipes reach)"
reach_paths="$(script_paths <<< "$reach_recipes")"              # run by a target pre-push-checks depends on
declined_recipes="$(makefile_recipes declined)"
declined_paths="$(script_paths <<< "$declined_recipes")"        # run by a target that records why it is not

missing_gates=""
missing_others=""
absent_gates=""
commented_gates=""
seen=""
mirrored=0
optedout=0

while IFS= read -r p; do
  [ -n "$p" ] || continue
  case "$p" in scripts/* | */scripts/*) ;; *) continue ;; esac   # `scripts` is a whole path component
  named="$p"
  # Strip what a variable left in front of the path (see "Limits") BEFORE judging
  # top-level or nested: GITHUB_WORKSPACE/scripts/x.sh is the top-level x.sh.
  q="$p"
  while [ ! -f "$q" ]; do
    q="${q#*/}"
    case "$q" in scripts/* | */scripts/*) ;; *) q="$p"; break ;; esac
  done
  p="$q"
  if grep -qxF -- "$p" <<< "$seen"; then continue; fi
  seen="${seen}${p}"$'\n'
  base="${p##*/}"
  rest="${p#scripts/}"
  top=0
  if [ "$rest" != "$p" ] && [ "${rest#*/}" = "$rest" ]; then top=1; fi
  gate=0
  if is_gate_name "$base"; then gate=1; fi
  if [ "$top" -eq 0 ] && [ "$gate" -eq 0 ]; then continue; fi    # a nested helper or test, not a gate
  if [ ! -f "$p" ]; then
    # Skipping a gate CI runs is how a mangled path once passed unseen; only a
    # gate named in prose alone may be skipped, and it is listed.
    if [ "$gate" -eq 1 ]; then
      if grep -qxF -- "$named" <<< "$ci_live_scripts"; then
        absent_gates="${absent_gates}${p}"$'\n'
      else
        commented_gates="${commented_gates}${p}"$'\n'
      fi
    fi
    continue
  fi

  if [ "$gate" -eq 1 ]; then
    if grep -qxF -- "$p" <<< "$reach_paths"; then
      mirrored=$((mirrored + 1))
      continue
    fi
    if grep -qxF -- "$p" <<< "$declined_paths"; then
      optedout=$((optedout + 1))
      continue
    fi
  elif grep -qxF -- "$p" <<< "$mk_paths"; then
    mirrored=$((mirrored + 1))
    continue
  fi

  key="$p"
  if [ "$top" -eq 1 ]; then key="$base"; fi
  reason="$(printf '%s\n' "$OPT_OUT" | awk -F'\t' -v n="$key" '$1 == n {print $2}')"
  if [ -n "$reason" ]; then
    optedout=$((optedout + 1))
    continue
  fi

  if [ "$gate" -eq 1 ]; then
    missing_gates="${missing_gates}${p}"$'\n'
  else
    missing_others="${missing_others}${p}"$'\n'
  fi
done <<< "$ci_scripts"

if [ -n "$commented_gates" ]; then
  printf '%s' "$commented_gates" | sed '/^$/d;s/^/NOTE: named only in a workflow comment, and no such file: /'
fi

if [ -n "$missing_gates$missing_others$absent_gates" ]; then
  echo "PRE-PUSH PARITY GAP"
  if [ -n "$absent_gates" ]; then
    echo ""
    echo "These gate scripts are named on a workflow line that is not a comment, but no"
    echo "such file exists from the repository root, even with a leading variable such"
    echo "as \$GITHUB_WORKSPACE/ removed, so nothing can say whether pushing runs them."
    echo "Write the path from the repository root (not relative to working-directory:),"
    echo "or drop the reference to a gate that is gone:"
    printf '%s' "$absent_gates" | sed '/^$/d;s/^/  /'
  fi
  if [ -z "$missing_gates$missing_others" ]; then exit 1; fi
  if [ -n "$missing_gates" ]; then
    echo ""
    echo "These gate scripts run in CI but no target that pre-push-checks depends on"
    echo "runs them, so pushing does not run them and no developer hears of a breach"
    echo "before CI does:"
    printf '%s' "$missing_gates" | sed '/^$/d;s/^/  /'
  fi
  if [ -n "$missing_others" ]; then
    echo ""
    echo "These scripts run in CI but are not named anywhere in the Makefile, so no"
    echo "developer can run them before pushing:"
    printf '%s' "$missing_others" | sed '/^$/d;s/^/  /'
  fi
  echo ""
  echo "Fix one of three ways:"
  echo "  1. Wire it into a Makefile target and list that target as a prerequisite of"
  echo "     pre-push-checks (one 'pre-push-checks: <target>' line per target)."
  echo "  2. If it belongs off the pre-push list, say why in that target's recipe: a"
  echo "     comment starting 'NOT in pre-push-checks' followed by the reason."
  echo "  3. If it genuinely cannot run offline in seconds and has no target, add it to"
  echo "     OPT_OUT in $(basename "$0") WITH THE REASON. An unexplained entry is how"
  echo "     the list rotted the first time."
  exit 1
fi

echo "OK: ${mirrored} CI gate script(s) mirrored in ${MAKEFILE}, ${optedout} opted out with reasons."
