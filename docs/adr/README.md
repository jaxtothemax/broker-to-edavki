# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for TaxReporter.

An ADR captures a significant architectural decision: what was decided, why, and
what the consequences are. It is a permanent record — once accepted, ADRs are not
deleted or edited. If a decision is reversed, a new ADR supersedes the old one.

## Naming

```
NNNN-short-title.md
```

- `NNNN` — zero-padded sequence number starting at `0001`
- `short-title` — lowercase, hyphen-separated

Examples:
```
0001-record-architecture-decisions.md
0002-local-first-processing-on-the-users-device.md
0003-typescript-monorepo-with-pnpm-workspaces.md
```

## Creating a new ADR

Copy `docs/adr/0001-record-architecture-decisions.md` and increment the number.

If you work in Claude Code, the `/adr` command does the same, and it is optional:

```
/adr Title of the decision
```

## Status values

- **Proposed** — under discussion, not yet decided
- **Accepted** — the decision is in effect
- **Deprecated** — the decision was valid but is no longer relevant
- **Superseded by [NNNN]** — a later ADR reversed or replaced this one

There is deliberately no status for "accepted but not built". `Accepted` is about
the **decision**, never about the code. When the two differ, add an
`Implementation status` **blockquote** directly under the Status line:

```markdown
**Status:** Accepted (YYYY-MM-DD)

> **Implementation status (YYYY-MM-DD):** the *decision* stands, but part of it
> is not built yet: name what exists on `main` and what does not, verified
> against the code.
```

A blockquote is invisible to a status parser by construction, which is why it is a
blockquote and not a second `**Field:**` line. Remove it when the ADR ships — a
stale "not built" note is the same misinformation reversed. See
`.claude/skills/adr/SKILL.md`.

## When an ADR moves to Accepted

Re-read every open issue that names it. An issue arguing for an ADR is written
*before* the ADR settles; the delta between the two is the set of **rejected**
options, and nothing else in the pipeline compares them.

```bash
python3 scripts/adr-accepted-issue-sweep.py --adr NNNN
```

Record the count in the ADR's `## On Acceptance` block, including when it is zero.
