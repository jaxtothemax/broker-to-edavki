# Contributing to TaxReporter

Thank you for helping Slovenian investors file correct returns without handing their
statements to anyone. You do not need to be a tax expert: most contributions are broker
adapters, fixtures, docs and bug reports. Read `docs/research/README.md` before changing
anything that affects a computed figure.

You do not need Claude Code, or any AI tool, to contribute. A pull request you write by hand
is held to the same checks as any other. Claude Code is an
[optional extra](#optional-claude-code-and-the-ai-agents).

---

## What you need installed

- **Git** and **GNU Make** (the Makefile is the one list of commands).
- **Node.js 24** and **pnpm 10**. Run `corepack enable` once and Node provides pnpm.
- **python3** on your `PATH`. Several of the checks that run before a push need it (version
  lockstep, docs links, NUL bytes, invisible characters). A missing python3 fails the push;
  it is not skipped.
- **PyYAML** for that python3 (`pip install pyyaml`). Two pre-push checks read the CI
  workflows with it, `check-selftest-parity` and `check-artifact-asserts`. Without it each
  exits 2, which means "could not check" and not a pass, so the push fails.

Optional: **gitleaks** (secret scan on commit) and **shellcheck** (the shell-script check) are
skipped with a message when absent. **xmllint** (checking generated XML against the FURS
schemas by hand) is not run by any hook. The GitHub CLI **gh** (the duplicate-pull-request
check) is skipped without any message: the check exits quietly, so nothing tells you it did
not run.

`make doctor` reports most of what your machine is missing. It checks for python3 but not for
PyYAML, so a clean `make doctor` does not mean the push checks can run.

---

## Workflow

This project follows GitHub Flow: every change goes through a short-lived branch and a
pull request (PR) into `main`. There are no direct pushes to `main`: it is protected, and a
PR merges only once its required status checks are green.

You will not have write access to this repository, so **fork it and open the PR from your
fork**:

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/broker-to-edavki.git
cd broker-to-edavki
git remote add upstream https://github.com/jaxtothemax/broker-to-edavki.git

# 2. Once per clone: install the dependencies and the git hooks
make setup

# 3. Start from the current main of the project, on a new branch
#    (put the issue number first when there is one)
git fetch upstream
git checkout -b feat/123-your-feature upstream/main   # or fix/, docs/, chore/

# 4. Make changes, commit
git add <files>
git commit -m "feat(scope): short description"

# 5. Push to your fork
git push -u origin "$(git branch --show-current)"
```

Then open a pull request on GitHub from your fork's branch to `main` of
`jaxtothemax/broker-to-edavki` (GitHub offers a **Compare & pull request** button after the
push). To catch up with the project later: `git fetch upstream && git rebase upstream/main`.

Checks must be green before merging. Never merge a PR with a failing check, and never bypass
one: fix the root cause.

### What a pull request needs

- **A branch from `main`**, named by the [prefix table](#branch-naming), with one change in it.
  Put `Closes #123` on its own line in the description when it resolves an issue.
- **Tests next to the code.** A new feature or bug fix comes with a `*.test.ts` or
  `*.test.tsx` file beside the source, in `packages/*/src/` or `apps/*/src/`. Fixtures go in
  `packages/<package>/test/fixtures/`, synthetic or anonymized.
- **A changelog fragment** named `changelog.d/SLUG.TYPE.md`, where `TYPE` is `added`,
  `changed`, `fixed` or `security` (see [Changelog](#changelog)).
- **For a change to a tax rule, a rate rule or a FURS schema:** a primary source (the law,
  FURS instructions or schemas, Banka Slovenije) cited in `docs/research/` in the same PR,
  the golden XML files updated with the reason in the same commit, and a `changed`
  changelog fragment that names the returns affected (see
  [Changing a tax rule](#changing-a-tax-rule-an-exchange-rate-rule-or-a-furs-schema)).
- **Documentation in the same commit** as the code it describes: user docs in
  `website/src/content/docs/`, contributor docs in `docs/`.
- **Green local checks:** `make format-check`, `make lint`, `make typecheck` and `make test`
  (see [Local commands](#local-commands)).
- **The pull request template filled in.** Its Gates section records the results of the
  optional review agents; if you did not run them, say so there. A description that names a
  follow-up must point to an open issue, or the `pr-followups` check fails.
- **No personal data**: no real broker export, tax number, name, address, or account or order
  ID, in a file, a fixture, a commit message or the PR description.

### Local commands

Run these before you push. Each one is a `make` target that calls a root `package.json`
script, and CI runs the same targets.

```bash
make format-check    # Prettier, without writing ('make format' rewrites the files)
make lint            # ESLint, with no warnings allowed
make typecheck       # tsc -b --force over every project, tests and config included
make test            # Vitest over every package, with coverage
```

Also available: `make build` (every package and both apps), `make test-e2e` (browser tests,
see [Tests](#tests)) and `make pre-push-checks` (the repository-wide checks the push hook runs).

### Git hooks

`make setup` installs the dependencies (`pnpm install --frozen-lockfile`) and links two git
hooks from `hooks/` into your git hooks directory. An existing hook of the same name is
moved to `<name>.bak`.

- **`pre-commit`** scans the staged changes for secrets (gitleaks, when installed), then
  runs `make format-check`, `make lint` and `make typecheck`.
- **`pre-push`** runs `make pre-push-checks`, which mirrors every CI check that can run
  locally, so a red result shows up before the push rather than on the PR. It needs python3
  with PyYAML (see above). A missing tool is handled check by check, not alike:
  - Without `shellcheck`, the shell-script check skips with a message.
  - Without `node`, `check-added-files-covered` and `check-app-fixture-gates` skip with a
    message, and so does `check-licenses` without `node` or `pnpm`.
  - Without `gh`, the duplicate-pull-request check exits quietly with no message.
  - The Pages build check (`check-pages-build`) has no skip: without `node` it fails, and so
    does the push.

Both hooks need the dependencies installed first. `git commit --no-verify` and
`git push --no-verify` skip them, but CI runs the same checks again and a failing check
blocks the merge.

---

## Branch naming

| Prefix | When to use |
|---|---|
| `feat/` | New feature or capability |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `chore/` | Tooling, CI, dependency bumps — no behavior change |
| `refactor/` | Code restructure with no behavior change |
| `perf/` | Performance improvement |

---

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body — explain why, not what]
```

Examples:
```
feat(import): read the dividends section of a broker activity statement
fix(xml): round withholding tax to two decimals before summing
chore(ci): bump actions/checkout to the latest patch release
```

---

## Changelog

Every PR that changes user-visible behavior needs a changelog fragment. Do not edit
`CHANGELOG.md` directly. Fragments are assembled into it at release time.

```bash
# Create a fragment file:
echo "- **Your change**: what changed and why it matters." \
  > changelog.d/<slug>.<type>.md

# Types: added  changed  fixed  security
# Example:
echo "- **Dividend import**: dividends from the activity statement now fill the dividend form." \
  > changelog.d/dividend-import.added.md
```

The CI `changelog-check` job fails if the fragment is missing. It skips the check when:

- the branch starts with `chore/`, or
- every changed file is non-product: CI config (`.github/`), anything under `docs/` or
  `scripts/`, `README*`, `CLAUDE.md`, `Makefile`, `.gitignore`, or any `*.md` / `*.sh`
  file, or
- the PR carries the `no-changelog` label.

A `docs/` or `ci/` branch is **not** skipped because of its name. It passes only because
of the files it changes.

---

## Tests

Run tests before pushing:

```bash
make test                          # every package, with coverage
pnpm vitest run packages/brokers   # one package or file while iterating
make test-e2e                      # browser tests on the built web app
```

`make test-e2e` runs the Playwright tests in `apps/web/e2e/` against the production build,
in Chromium, Firefox and WebKit. Fetch the browsers once with
`pnpm --dir apps/web exec playwright install chromium firefox webkit`. It is not part of
the pre-push checks; CI's `e2e` job runs it on every pull request.

Every new feature and bug fix needs test coverage in the same PR. The
`check-added-files-covered` gate fails a PR that adds a source file no test executes.
Anything FURS ingests is covered by a golden XML file that is also validated against the
vendored XSD (`packages/furs/schemas/`).

---

## Changing a tax rule, an exchange-rate rule or a FURS schema

A wrong number here becomes a wrong tax return that a real person signs, so a change to any
rule below needs more than a passing test:

- **A primary source, in the same PR.** Cite the law text, the FURS instructions or schema,
  or Banka Slovenije in `docs/research/` (start with its README). A blog post or another
  tool's behavior is a lead, not a source.
- **Golden files, with the reason.** Every form builder change is covered by an expected-XML
  golden file that is also validated against the vendored XSD. Rewrite them with
  `UPDATE_GOLDEN=1 pnpm vitest run packages/furs`, and commit the new files together with
  the rule or source that changed them.
- **A `changed` changelog fragment** that names the returns affected, whenever the same input
  now produces a different figure (a rate rule, rounding, lot matching or a field mapping).
- **FURS edits its XSDs in place,** so a schema change is a tax-rule change. Re-vendor the
  file byte for byte in `packages/furs/schemas/`, update its SHA-256 row in that folder's
  `README.md` in the same commit (a test checks it), and review the schema diff.

The rules that every change has to keep:

- Exchange rates come from Banka Slovenije only, and each converted amount keeps its rate,
  list date and source. Never use the broker's rate or an ECB rate silently.
- An acquisition or disposal is dated by the trade date, never the settlement date; a dividend
  by the date it was paid.
- No binary floating point for money, quantities or rates. Use the project's decimal type and
  round only when writing a form field.
- FIFO runs per security (by ISIN) across every broker and account of the taxpayer.
- No input row is dropped silently: it becomes a ledger event, an explicit "ignored (reason)"
  record, or a blocking diagnostic. An unsupported corporate action is refused, never guessed.
- The generated XML follows the schema order and validates against the vendored XSDs.

---

## Reporting a broker export change

Brokers change their export formats without notice. If a file stops importing:

1. Open a **Bug** issue naming the broker, the export type (for example "Trading 212 →
   History → Export CSV"), and the date you exported it.
2. Paste **only the header row** and, if needed, one or two rows with every number,
   identifier and name replaced by made-up values.
3. Never attach the real file. Real exports belong in the gitignored `private/` folder of
   your own clone.

---

## Adding a broker adapter

An adapter turns one broker's export into the normalized ledger events in
`packages/core`; FX conversion, FIFO lot matching and XML generation are shared, so an
adapter never touches them. The interface an adapter implements and the place to register
it are in [`packages/brokers/README.md`](packages/brokers/README.md). A new adapter PR needs:

- detection by header or structure (never by file name), with one fixture per known
  header revision under `packages/brokers/test/fixtures/<broker>/`;
- every input row accounted for: an event, an explicit "ignored (reason)" record, or a
  blocking diagnostic — nothing is dropped silently;
- the import contract of `docs/adr/0011-import-contract-for-broker-files.md`:
  - `read` takes a `ReadContext`, the file's ID and account group, and never sees a file
    name; a CSV adapter gets the parsed table, an XML adapter the text, which it reads with
    the strict scanner in `packages/brokers/src/xml.ts`;
  - every event carries its account, the broker's own clock (`at`) and a key from core's
    `keyBuilder()`, or `keyOf()` where the broker gives each row an ID it never reuses;
  - dates come from core's `taxDate`, never from a rule of the adapter's own;
  - text copied from the file reaches a finding only through `untrusted()`;
- synthetic or anonymized fixtures only, plus a short `docs/research/` note on where the
  format is documented and which fields are trusted;
- a review of the parser against the untrusted-input rules: bounded file size, row count and
  decompressed size; no code executed from data; no network; no pattern that can backtrack
  catastrophically on file content. The `security-review` and `regression-check` agents do
  this review for people who use Claude Code, and they are optional.

---

## Issues

Open issues from the forms on the **New issue** page (bug, feature, task, feedback).
Blank issues are disabled. **Never attach a real broker export or a generated tax file,
and never paste personal or tax identifiers.** Issues are public.

Report security vulnerabilities privately through **Security → Report a vulnerability**
(GitHub private vulnerability reporting). Do not open a public issue for them.

---

## Optional: Claude Code and the AI agents

This repository is also set up for AI coding agents. `CLAUDE.md` and the `.claude/`
directory (skills, agents, hooks and settings) are instructions for them. If you write your
pull request yourself, you can ignore both: nothing in them is a condition of contributing.
The rules in `CLAUDE.md` on tax correctness, privacy and secure code are the project's rules
for every change, whoever writes it, and review applies them; the rest of that file describes
the agents' workflow.

If you do use Claude Code, it can run the review agents before you open a PR:

```
changelog        — create a changelog fragment
regression-check — audit for regressions
security-review  — OWASP Top 10 + project-specific checks (parsers, importers, generated XML)
```

And before starting a new feature:

```
/voc all <feature description>  — persona feedback
architect                       — technical design review
```

The `/mr`, `/fix-mr` and `/mass-merge` skills keep their upstream Blueprint names. In
this repository, an MR is a GitHub pull request. They use the GitHub CLI, so run
`gh auth login` first. `CLAUDE.md` has the full agent workflow and says when each agent
applies.

Working on several issues at once? `scripts/wt new <issue>` creates an isolated git worktree.
It also tries to label the issue `status:wip` and comment on it, so that a parallel session
does not pick it up. It sends both to the repository that `origin` points at. In a fork that
is your fork, never the project, so the project's issue is not touched and the check-out
protects nothing there. A fork usually has issues turned off, and then `gh` fails and
`scripts/wt` warns and carries on. The worktree itself works the same either way.

---

## Getting help

- Open an issue for bugs or feature requests (use the **Feedback** form for questions and
  ideas)
- For a security problem, use private vulnerability reporting (see `SECURITY.md`)
- TaxReporter is not tax advice. For questions about your own return, ask FURS or a tax
  adviser
