#!/usr/bin/env bash
# scripts/check-gate-selftest-parity.sh — every CI gate proves it can still fail,
# IN ITS OWN JOB, or carries a recorded reason why it cannot.
#
# ## Why this exists
#
# `scripts/CLAUDE.md` already says a gate must be able to fail. Nothing
# asserted that every gate actually carried the proof, and a gate's failure mode
# is a *green pipeline* — so the count of gates in that state was written down
# nowhere.
#
# Upstream, a gate enforcing a licensing boundary the project called "sacred"
# passed a real violation, exit 0, for its entire life: the CI image's BusyBox
# grep rejected `--exclude-dir`, the script's `|| true` swallowed the option
# error, and empty read as "no violations".
#
# The part worth encoding is not that bug. It is that the blind gates **already
# had passing test suites**. The suites ran in a different job, on a different
# image, against a shell that behaved differently. They were evidence about that
# image and nothing else.
#
# So the requirement is SAME JOB, not same repo — because same job is the only
# way to say "same runner" in a CI config, and the runner is what differed. On
# GitHub Actions every job gets a fresh runner VM; two jobs in one workflow share
# nothing but the checkout recipe.
#
# The self-test alone is not enough, either. A job that runs `check-x.sh --self-test`
# and never `check-x.sh` itself proves the gate CAN fail while nothing asks it to:
# delete the scan step, or comment it out, and the job, its self-test and this
# check all stay green with the gate switched off. So the SAME job must also run
# the scan; the self-test should run first, but nothing here checks the order
# (see "What this cannot do"). The few gates whose real run cannot be
# in CI (its input is a forge, a release tag or a directory outside the repository)
# are recorded in SELF_TEST_ONLY below with the reason; a gate with no scan and no
# entry there is a failure.
#
# ## How it reads the workflows
#
# It parses `.github/workflows/*.yml` with PyYAML and reads ONLY the `run:` text
# of each job's steps. A script path in a step `name:`, an `on.push.paths:`
# filter, an `env:` value or a shell comment inside `run:` names a file; it does
# not invoke it. Reading the parsed document rather than indentation is what lets
# a job be attributed correctly whatever indentation or flow style the workflow
# uses — the GitLab-era version of this gate attributed lines to jobs with awk,
# and pinned gawk in CI because a different awk could split the blocks
# differently.
#
# A workflow that does not parse is exit 2, never a pass: a gate that cannot read
# its input has not checked anything.
#
# ## What this cannot do
#
# An opt-out is a rubber stamp, and a `--self-test` that asserts only the happy
# path passes this check while proving nothing. This removes the silence, not the
# possibility of a wrong answer.
#
# An invocation is the gate's path in command position: the first word of a
# command (at the start of a line, after `;`, `&&`, `||`, `|`, `(`, `!`, `if`,
# `then`, `do` and the like, with backslash-continued lines joined), optionally
# after VAR=value words, after `bash`, `sh`, `python3` or `node` with their
# options, and with a path glued in front (`./`, `apps/web/`,
# `"$GITHUB_WORKSPACE/`). `test -x scripts/check-x.sh` or `shellcheck
# scripts/check-x.sh` names the gate and is neither the scan nor the self-test. A
# gate run through any other wrapper (`timeout 60 bash ...`, `xargs`) is not seen
# as run, so its job reads as unproven or unscanned and fails loudly.
#
# "The scan" is any invocation of the gate that is not `--self-test`, so
# `check-x.sh --list` counts as one; that is a hole this does not close.
#
# A step is read whatever its `if:` says, so a scan step disabled with `if: false`
# still counts as the scan. The order inside a job is not checked either: a job
# that runs the scan before its self-test passes.
#
# It sees only gates invoked DIRECTLY from a `run:` step (`bash scripts/check-x.sh`).
# A gate reached through `make <target>`, a local composite action
# (`uses: ./.github/actions/...`) or a reusable workflow is invisible to it — so
# CI jobs in this repo call gate scripts directly. See .github/workflows/CLAUDE.md.
#
# ## Usage
#
#   bash scripts/check-gate-selftest-parity.sh [--self-test]
#
# ## Exit codes
#
#   0  every CI gate self-tests in its own job and is also run there, or is
#      opted out with a reason
#   1  at least one gate has no self-test in its job, or a job runs a gate's
#      --self-test without running the gate
#   2  no CI configuration found, a workflow does not parse, or PyYAML is missing

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ─── Opt-outs ────────────────────────────────────────────────────────────────
#
# ONE kind qualifies: EXTERNAL — the gate's input is not the repository, so no
# fixture can represent a violation (its oracle is an issue tracker, a package
# registry, a deployed environment).
#
# There is no second category, and in particular there is no "verified by hand
# once". Upstream tried that: twelve gates were parked in a PENDING bucket after
# a manual audit, and when each was later neutered on purpose, every one still
# passed on the real tree — because a compliant tree never executes the detection
# path at all. A snapshot nothing repeats is the standing this file refuses.
#
# Format: one "basename<TAB>reason" per line.
OPT_OUT="
"

# ─── Self-test-only jobs ─────────────────────────────────────────────────────
#
# The inverse opt-out: a gate a CI job runs with --self-test and never runs for
# real. It is allowed only where the real run cannot be in CI at all (the oracle
# is the forge's open-PR list, a `v*` tag that exists only at release time, a
# per-user directory outside the repository) and the self-test, which builds its
# own fixture, is the one thing CI can do. Say where the real run happens.
#
# This does not excuse a missing self-test (OPT_OUT does that) and OPT_OUT does
# not excuse a missing scan: the two lists answer different questions.
#
# Format: one "basename<TAB>reason" per line.
SELF_TEST_ONLY="
check-issue-collision.sh	its real run reads the forge's open-PR list, so it cannot run in CI; the pre-push hook runs it (make check-collision) and the self-test replaces the forge call with a fixture
check-memory-index.sh	its real run reads a per-user memory directory outside the repository, so it cannot run in CI; run it by hand at each release close (make memory-check)
check-tag-only-jobs.sh	its real run needs a v* tag to diff against, which exists only once a release is cut (the release skill's Step 1); the self-test builds its own throwaway git history
"

# Reads OPT_OUT from a here-string, NOT a pipe. The `return` below fires on the
# FIRST match, so a piped writer still holding the rest takes SIGPIPE; `set -o
# pipefail` promotes that to 141 and `set -e` aborts before anything is printed —
# a red gate with an empty log and nothing pointing at the cause. The race is
# payload-sized, so a short list always fits in the pipe buffer and the broken
# form passes every other case in this file. See the self-test's padded case.
opt_out_reason() {
    while IFS=$'\t' read -r name reason; do
        [ -n "$name" ] || continue
        if [ "$name" = "$1" ]; then printf '%s' "$reason"; return; fi
    done <<< "$OPT_OUT"
}

# Same lookup, same here-string, for SELF_TEST_ONLY.
self_test_only_reason() {
    while IFS=$'\t' read -r name reason; do
        [ -n "$name" ] || continue
        if [ "$name" = "$1" ]; then printf '%s' "$reason"; return; fi
    done <<< "$SELF_TEST_ONLY"
}

# ─── Discover the CI files ───────────────────────────────────────────────────

discover_ci_files() {
    local f
    for f in .github/workflows/*.yml .github/workflows/*.yaml; do
        [ -f "$f" ] && echo "$f"
    done
    return 0
}

# ─── Attribute each gate invocation to the job that runs it ──────────────────
#
# Emits "workflow:job<TAB>script-basename<TAB>scan<TAB>self-test", the last two
# each yes|no: whether THAT SAME JOB invokes the script for real, and whether it
# invokes it with --self-test. One row per gate per job that names it either way.
# Exits 2 when a file does not parse or PyYAML is unavailable.
gate_invocations() {
    python3 - "$@" <<'PY'
import re, sys

try:
    import yaml
except ImportError:
    sys.stderr.write("check-gate-selftest-parity: ERROR — PyYAML is not installed "
                     "(pip install pyyaml); cannot read the workflows.\n")
    sys.exit(2)

SCRIPT = re.compile(r"scripts/[A-Za-z0-9_./-]+\.(?:sh|py|mjs)")
GATE = re.compile(r"^check[-_]|-check\.(?:sh|py|mjs)$")
TEST = re.compile(r"\.test\.(?:sh|py|mjs)$")
# A GitHub expression, so `${{ github.workspace }}/scripts/x.sh` is one word.
EXPR = re.compile(r"\$\{\{(?:[^}]|\}(?!\}))*\}\}")
# The text before a path that RUNS it: where a command starts (the line start, a
# shell separator, or a keyword that takes a command), any VAR=value words, an
# optional interpreter with its options, then whatever is glued to the path in
# the same word (`./`, `apps/web/`, `"$GITHUB_WORKSPACE/`). `test -x scripts/x.sh`
# and `shellcheck scripts/x.sh` name the gate as an argument and do not match.
CMD_POS = re.compile(
    r"(?:^|[;&|(`]|[{!]\s|(?<![\w-])(?:then|do|else|elif|if|while|until|time|exec|env|command)\s)\s*"
    r"(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*"
    r"(?:(?:\S*/)?(?:bash|sh|python3|node)(?:\s+-\S+)*\s+)?"
    r"[^\s=;&|()`<>]*$"
)


def logical_lines(text):
    """The run: text with every backslash-continued line joined to the next."""
    buf = ""
    for raw in text.splitlines():
        if raw.endswith("\\"):
            buf += raw[:-1] + " "
            continue
        yield buf + raw
        buf = ""
    if buf:
        yield buf


invoked, selftest = set(), set()
for path in sys.argv[1:]:
    try:
        with open(path, encoding="utf-8") as fh:
            doc = yaml.safe_load(fh)
    except (OSError, yaml.YAMLError) as exc:
        sys.stderr.write("check-gate-selftest-parity: ERROR — cannot parse %s: %s\n" % (path, exc))
        sys.exit(2)
    if not isinstance(doc, dict):
        sys.stderr.write("check-gate-selftest-parity: ERROR — %s is not a workflow mapping\n" % path)
        sys.exit(2)
    jobs = doc.get("jobs") or {}
    if not isinstance(jobs, dict):
        sys.stderr.write("check-gate-selftest-parity: ERROR — %s: `jobs` is not a mapping\n" % path)
        sys.exit(2)
    wf = path.rsplit("/", 1)[-1]
    for job_id, job in jobs.items():
        if not isinstance(job, dict):
            continue
        key = "%s:%s" % (wf, job_id)
        for step in job.get("steps") or []:
            if not isinstance(step, dict) or not isinstance(step.get("run"), str):
                continue
            for line in logical_lines(step["run"]):
                # A path named in a shell comment is prose, not an invocation.
                if line.lstrip().startswith("#"):
                    continue
                line = re.sub(r"\s#.*$", "", EXPR.sub("EXPR", line))
                for m in SCRIPT.finditer(line):
                    base = m.group(0).rsplit("/", 1)[-1]
                    # scripts/tests/*.test.sh are test files, not gates.
                    if TEST.search(base) or not GATE.search(base):
                        continue
                    # An argument to another command names the gate; it does not
                    # run it, so it is neither the scan nor the self-test.
                    if not CMD_POS.search(line[:m.start()]):
                        continue
                    rest = line[m.end():]
                    # The quote closing `"$GITHUB_WORKSPACE/scripts/x.sh"` may sit
                    # between the path and the flag.
                    if re.match(r"[\"']?\s*--self-test", rest):
                        selftest.add((key, base))
                    else:
                        invoked.add((key, base))

for key, base in sorted(invoked | selftest):
    print("%s\t%s\t%s\t%s" % (key, base, "yes" if (key, base) in invoked else "no",
                              "yes" if (key, base) in selftest else "no"))
PY
}

# ─── Scan ────────────────────────────────────────────────────────────────────

run_scan() {
    local proven=0 opted=0 only=0 missing=0 unscanned=0 job script scan has reason inv inv_rc=0
    inv="$(gate_invocations "$@")" || inv_rc=$?
    if [ "$inv_rc" -ne 0 ]; then
        echo "check-gate-selftest-parity: could not read the CI configuration (exit ${inv_rc}) — nothing was checked." >&2
        return 2
    fi
    while IFS=$'\t' read -r job script scan has; do
        [ -n "$script" ] || continue
        if [ "$scan" = "no" ]; then
            reason="$(self_test_only_reason "$script")"
            if [ -n "$reason" ]; then only=$((only + 1)); continue; fi
            unscanned=$((unscanned + 1))
            echo "check-gate-selftest-parity: FAIL  job '$job' runs scripts/$script with --self-test but never runs the scan itself"
            continue
        fi
        if [ "$has" = "yes" ]; then proven=$((proven + 1)); continue; fi
        reason="$(opt_out_reason "$script")"
        if [ -n "$reason" ]; then opted=$((opted + 1)); continue; fi
        missing=$((missing + 1))
        echo "check-gate-selftest-parity: FAIL  job '$job' runs scripts/$script but never runs it with --self-test"
    done <<< "$inv"

    echo "check-gate-selftest-parity: ${proven} self-tested in-job, ${opted} opted out, ${only} self-test only by design, ${missing} unproven, ${unscanned} never scanned."

    if [ "$unscanned" -gt 0 ]; then
        cat <<'MSG'

A job that runs a gate's --self-test but never the gate proves it CAN fail while
nothing asks it to: delete the scan step and the job stays green with the gate
switched off. Fix by either:

  * adding the real invocation to the SAME job, after the self-test; or
  * adding the script to SELF_TEST_ONLY in this file WITH the reason its real run
    cannot be in CI and where it runs instead.
MSG
    fi

    if [ "$missing" -gt 0 ]; then
        cat <<'MSG'

A gate that cannot be shown to fail is indistinguishable from one that works.
Fix by either:

  * adding a --self-test to the script and invoking it in the SAME job, before
    the real scan (the default — the job's own runner is the only environment
    that counts); or
  * adding the script to OPT_OUT in this file WITH the reason a fixture cannot
    represent a violation.

Run the self-test FIRST in the job. A gate's failure mode is a green pipeline,
so "the gate passed" is not evidence that it can still fail.
MSG
    fi
    if [ "$missing" -gt 0 ] || [ "$unscanned" -gt 0 ]; then return 1; fi
    return 0
}

# ─── Self-test ───────────────────────────────────────────────────────────────

self_test() {
    local tmp rc=0 last_out=""; tmp="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$tmp'" EXIT

    # Demands the EXACT exit code (scripts/CLAUDE.md, "A self-test must tell a
    # crash from a rejection"): 1 is a rejection, 2 is "could not read the
    # input", and anything else is the gate itself breaking. A probe that read
    # any non-zero as "rejected" would pass on a runner with no PyYAML at all.
    _case() { # <name> <expected-exit> <ci-fixture...>
        local name="$1" want="$2" got=0 out; shift 2
        out="$(run_scan "$@" 2>&1)" || got=$?
        last_out="$out"
        if [ "$got" -ne "$want" ]; then
            echo "SELF-TEST FAILED: $name — expected exit $want, got $got." >&2
            printf '%s\n' "$out" | sed 's/^/    /' >&2
            rc=1; return
        fi
        if [ "$want" -ne 2 ] && ! grep -q 'self-tested in-job' <<<"$out"; then
            echo "SELF-TEST FAILED: $name — exit $got but no verdict line; the scan never finished." >&2
            rc=1; return
        fi
        echo "SELF-TEST OK: $name (exit $got)."
    }

    # The gate's own wording, after a _case: a rejection for the wrong reason
    # (a different failure that also exits 1) must not pass for the right one.
    _has() { # <name> <phrase>
        if ! grep -qF -- "$2" <<<"$last_out"; then
            echo "SELF-TEST FAILED: $1 — the output lacks '$2'." >&2
            printf '%s\n' "$last_out" | sed 's/^/    /' >&2
            rc=1
        fi
    }

    cat >"$tmp/ok.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-zz-probe.sh --self-test
      - run: bash scripts/check-zz-probe.sh
Y
    _case "gate self-tested in its own job" 0 "$tmp/ok.yml"

    cat >"$tmp/block.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - name: Probe
        run: |
          bash scripts/check-zz-probe.sh --self-test
          bash scripts/check-zz-probe.sh
Y
    _case "self-test and scan in one multi-line run block" 0 "$tmp/block.yml"

    # The gap this case closes: the proof is real and in the right job, but the scan
    # step is gone (deleted, or commented out), so the job is green with the gate
    # switched off. Same wiring as ok.yml minus one line.
    cat >"$tmp/selftest-only.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-zz-probe.sh --self-test
Y
    _case "self-test with no scan in the same job" 1 "$tmp/selftest-only.yml"
    _has "self-test with no scan in the same job" "runs scripts/check-zz-probe.sh with --self-test but never runs the scan itself"
    _has "self-test with no scan in the same job" "1 never scanned"

    cat >"$tmp/commented-scan.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: |
          bash scripts/check-zz-probe.sh --self-test
          # bash scripts/check-zz-probe.sh
Y
    _case "scan commented out of a run block" 1 "$tmp/commented-scan.yml"
    _has "scan commented out of a run block" "never runs the scan itself"

    # A step that names the gate as an argument does not run it, so it is not the
    # scan: without the command-position test each of these passed as one.
    printf 'name: ci\non: [pull_request]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash scripts/check-zz-probe.sh --self-test\n      - run: test -x scripts/check-zz-probe.sh\n' >"$tmp/arg-test.yml"
    _case "test -x on the gate is not its scan" 1 "$tmp/arg-test.yml"
    _has "test -x on the gate is not its scan" "never runs the scan itself"
    printf 'name: ci\non: [pull_request]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash scripts/check-zz-probe.sh --self-test\n      - run: shellcheck scripts/check-zz-probe.sh\n' >"$tmp/arg-shellcheck.yml"
    _case "shellcheck on the gate is not its scan" 1 "$tmp/arg-shellcheck.yml"
    _has "shellcheck on the gate is not its scan" "never runs the scan itself"
    cat >"$tmp/arg-continued.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: |
          bash scripts/check-zz-probe.sh --self-test
          shellcheck \
            scripts/check-zz-probe.sh
Y
    _case "an argument on a continuation line is not the scan" 1 "$tmp/arg-continued.yml"
    _has "an argument on a continuation line is not the scan" "never runs the scan itself"
    printf 'name: ci\non: [pull_request]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "scripts/check-zz-probe.sh --self-test"\n      - run: bash scripts/check-zz-probe.sh\n' >"$tmp/arg-selftest.yml"
    _case "an echoed --self-test is not the self-test" 1 "$tmp/arg-selftest.yml"
    _has "an echoed --self-test is not the self-test" "never runs it with --self-test"

    # The forms a real scan takes, one job each, all accepted.
    cat >"$tmp/forms.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  direct:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/check-zz-probe.sh --self-test
      - run: ./scripts/check-zz-probe.sh
  conditional:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-zz-probe.sh --self-test
      - run: if ! bash scripts/check-zz-probe.sh; then exit 1; fi
  exit-code:
    runs-on: ubuntu-latest
    steps:
      - run: sh scripts/check-zz-probe.sh --self-test
      - run: |
          rc=0; sh scripts/check-zz-probe.sh report.json || rc=$?
  env-prefix:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-zz-probe.sh --self-test
      - run: test -n "$X" && env FOO=1 bash scripts/check-zz-probe.sh
  workspace:
    runs-on: ubuntu-latest
    steps:
      - run: bash "$GITHUB_WORKSPACE/scripts/check-zz-probe.sh" --self-test
      - run: bash ${{ github.workspace }}/scripts/check-zz-probe.sh
  continued:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-zz-probe.sh --self-test
      - run: |
          bash \
            scripts/check-zz-probe.sh \
            --strict
Y
    _case "every command-position form of the scan" 0 "$tmp/forms.yml"
    _has "every command-position form of the scan" "6 self-tested in-job"

    # A gate named the way the nested pages-build gate is: by its path from the
    # root, where the directory is not scripts/. Attribution is by basename, so the
    # same two rules apply to it.
    cat >"$tmp/nested-ok.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  site:
    runs-on: ubuntu-latest
    steps:
      - run: |
          node apps/web/scripts/pages-build/check-zz-nested.mjs --self-test
          node apps/web/scripts/pages-build/check-zz-nested.mjs apps/web/dist "$BASE"
Y
    _case "nested gate self-tested and scanned in one job" 0 "$tmp/nested-ok.yml"
    printf 'name: ci\non: [pull_request]\njobs:\n  site:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node apps/web/scripts/pages-build/check-zz-nested.mjs --self-test\n' >"$tmp/nested-selftest-only.yml"
    _case "nested gate self-tested but never scanned" 1 "$tmp/nested-selftest-only.yml"
    _has "nested gate self-tested but never scanned" "check-zz-nested.mjs with --self-test but never runs the scan itself"

    cat >"$tmp/bare.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-zz-probe.sh
Y
    _case "gate with no self-test anywhere" 1 "$tmp/bare.yml"

    # The shape this gate exists for: the proof is real, but it lives in another
    # job — therefore on another runner, which is what differed upstream.
    cat >"$tmp/elsewhere.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  other:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-zz-probe.sh --self-test
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-zz-probe.sh
Y
    _case "self-test in a DIFFERENT job" 1 "$tmp/elsewhere.yml"
    _has "self-test in a DIFFERENT job" "job 'elsewhere.yml:lint' runs scripts/check-zz-probe.sh but never runs it with --self-test"
    _has "self-test in a DIFFERENT job" "job 'elsewhere.yml:other' runs scripts/check-zz-probe.sh with --self-test but never runs the scan itself"

    # Same job id, different workflow file: a different job, and a different runner.
    cat >"$tmp/other-wf.yml" <<'Y'
name: other
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-zz-probe.sh --self-test
Y
    _case "self-test in a same-named job of ANOTHER workflow" 1 "$tmp/other-wf.yml" "$tmp/bare.yml"

    # Flow style and odd indentation: attribution follows the parsed document,
    # not the column a line happens to start at.
    printf 'name: ci\non: {pull_request: {}}\njobs: {lint: {runs-on: ubuntu-latest, steps: [{run: "bash scripts/check-zz-probe.sh"}]}}\n' >"$tmp/flow.yml"
    _case "flow-style workflow with no self-test" 1 "$tmp/flow.yml"

    # A non-gate script in CI must not be demanded to self-test.
    cat >"$tmp/nongate.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/assemble-changelog.sh
Y
    _case "non-gate script ignored" 0 "$tmp/nongate.yml"

    cat >"$tmp/testfile.yml" <<'Y'
name: ci
on: [pull_request]
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/tests/check-zz-probe.test.sh
Y
    _case "scripts/tests/*.test.sh ignored" 0 "$tmp/testfile.yml"

    # Named, but not invoked: a shell comment, a step name, an env value, and an
    # on.push.paths filter.
    cat >"$tmp/named.yml" <<'Y'
name: ci
on:
  push:
    paths:
      - scripts/check-zz-probe.sh
jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      GATE: scripts/check-zz-probe.sh
    steps:
      - name: Enforced by scripts/check-zz-probe.sh
        run: |
          # enforced by scripts/check-zz-probe.sh, see above
          echo deploy
Y
    _case "gate only named (comment, step name, env, paths filter)" 0 "$tmp/named.yml"

    # A workflow that does not parse is "could not check" (2), never a pass.
    printf 'name: ci\njobs:\n  lint: [unclosed\n' >"$tmp/broken.yml"
    _case "unparseable workflow" 2 "$tmp/broken.yml"

    # An OPT_OUT entry excuses a gate that cannot be given a fixture.
    if ( OPT_OUT=$'\ncheck-zz-probe.sh\tEXTERNAL: oracle is the issue tracker\n'; run_scan "$tmp/bare.yml" >/dev/null 2>&1 ); then
        echo "SELF-TEST OK: opted-out gate accepted."
    else
        echo "SELF-TEST FAILED: opted-out gate was rejected and must not be." >&2; rc=1
    fi

    # SELF_TEST_ONLY excuses a missing scan and nothing else, and OPT_OUT excuses a
    # missing self-test and nothing else. Both directions, so neither list can
    # quietly stand in for the other.
    if ( SELF_TEST_ONLY=$'\ncheck-zz-probe.sh\tthe real run needs a release tag\n'; run_scan "$tmp/selftest-only.yml" >/dev/null 2>&1 ); then
        echo "SELF-TEST OK: a self-test-only gate recorded in SELF_TEST_ONLY is accepted."
    else
        echo "SELF-TEST FAILED: a gate recorded in SELF_TEST_ONLY was rejected and must not be." >&2; rc=1
    fi
    got=0
    ( OPT_OUT=$'\ncheck-zz-probe.sh\tEXTERNAL: oracle is the issue tracker\n'; run_scan "$tmp/selftest-only.yml" >/dev/null 2>&1 ) || got=$?
    if [ "$got" -eq 1 ]; then
        echo "SELF-TEST OK: OPT_OUT does not excuse a missing scan (exit 1)."
    else
        echo "SELF-TEST FAILED: OPT_OUT and a missing scan — expected exit 1, got $got." >&2; rc=1
    fi
    got=0
    ( SELF_TEST_ONLY=$'\ncheck-zz-probe.sh\tthe real run needs a release tag\n'; run_scan "$tmp/bare.yml" >/dev/null 2>&1 ) || got=$?
    if [ "$got" -eq 1 ]; then
        echo "SELF-TEST OK: SELF_TEST_ONLY does not excuse a scan with no self-test (exit 1)."
    else
        echo "SELF-TEST FAILED: SELF_TEST_ONLY and a missing self-test — expected exit 1, got $got." >&2; rc=1
    fi

    # opt_out_reason must read OPT_OUT from a here-string, not a pipe. Its `return`
    # fires on the first match, leaving a piped writer blocked on a full buffer; it
    # takes SIGPIPE, pipefail promotes 141, set -e aborts with NO output. The race
    # is payload-sized, so every case above passes on the broken form. This one
    # plants a list past the pipe buffer to make the failure deterministic, and
    # asserts under `set -e` inside a command substitution — exactly how run_scan
    # calls it.
    local padded padded_out padded_rc=0
    padded="$(awk 'BEGIN{for(i=0;i<4000;i++) printf "filler-%05d.sh\tEXTERNAL: padding\n", i}')"
    padded_out="$( OPT_OUT=$'check-zz-probe.sh\tEXTERNAL: first entry\n'"$padded" ; opt_out_reason check-zz-probe.sh )" || padded_rc=$?
    if [ "$padded_rc" -eq 0 ] && [ "$padded_out" = "EXTERNAL: first entry" ]; then
        echo "SELF-TEST OK: OPT_OUT larger than the pipe buffer still resolves."
    else
        echo "SELF-TEST FAILED: OPT_OUT lookup returned rc=$padded_rc out='$padded_out' (expected 0 / 'EXTERNAL: first entry'). Is it reading from a pipe?" >&2
        rc=1
    fi

    # Same race, same fix, for the second list.
    local padded_st_out padded_st_rc=0
    padded_st_out="$( SELF_TEST_ONLY=$'check-zz-probe.sh\tfirst entry\n'"$padded" ; self_test_only_reason check-zz-probe.sh )" || padded_st_rc=$?
    if [ "$padded_st_rc" -eq 0 ] && [ "$padded_st_out" = "first entry" ]; then
        echo "SELF-TEST OK: SELF_TEST_ONLY larger than the pipe buffer still resolves."
    else
        echo "SELF-TEST FAILED: SELF_TEST_ONLY lookup returned rc=$padded_st_rc out='$padded_st_out' (expected 0 / 'first entry'). Is it reading from a pipe?" >&2
        rc=1
    fi

    [ "$rc" -eq 0 ] && echo "check-gate-selftest-parity: self-test passed."
    return "$rc"
}

# ─── Main ────────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--self-test" ]; then
    self_test
    exit $?
fi

cd "$REPO_ROOT"

# Portable to bash 3.2 (macOS ships it); `mapfile` is bash 4+.
CI_FILES=()
while IFS= read -r _f; do
    [ -n "$_f" ] && CI_FILES+=("$_f")
done <<< "$(discover_ci_files)"

if [ "${#CI_FILES[@]}" -eq 0 ]; then
    echo "ERROR: no CI configuration found (.github/workflows/*.yml)." >&2
    exit 2
fi

run_scan "${CI_FILES[@]}"
