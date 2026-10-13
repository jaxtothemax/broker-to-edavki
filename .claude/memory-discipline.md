# Memory discipline

The policy for the Claude Code memory store (`~/.claude/projects/…/memory/`): what goes in,
how it is written so it can be recalled, and when it is evicted. `/memory-audit`
(`.claude/skills/memory-audit/SKILL.md`) enforces it, and `scripts/check-memory-index.sh`
checks the index against it. It applies only to contributors who use Claude Code; nobody
else needs to read it.

## Write for recall, and evict on a rule

Claude Code accumulates project learnings in `~/.claude/projects/<project>/memory/`.
This complements `CLAUDE.md`:

- `CLAUDE.md` — durable rules written by you, committed to git, apply to everyone
- Memory — learnings written by Claude, machine-local, apply to you

The store is **append-mostly by default, and that is the failure mode**. Left alone it
reaches hundreds of files, many with no `description:` and many indexed by nothing.
Nothing in the write path pushes back, so the eviction rule has to be explicit.

**Write it only if a future session would get it wrong without it.** Not "this
happened" — "this is not derivable from the repo, and the obvious assumption is
wrong." A closeout log of a merged batch is not that. The trap you hit inside that
batch is.

**Every file carries `name`, `description`, and `metadata.type`.** `description:` is
what recall ranks on — a file without one is invisible to relevance no matter how good
its contents. It is the only retrieval handle, not optional metadata.

**One fact per file.** If it needs sub-headings for separate findings, it is several
memories. A 2 KB file is normal; an 8 KB file is a session transcript that will never
be recalled as a unit.

### Where a memory goes — decide at write time

| Kind | Destination |
|---|---|
| A durable trap, constraint, or rule | file **+** a `MEMORY.md` line |
| A batch / wave / closeout / audit run | file **+** `MEMORY-archive.md` line — never `MEMORY.md` |
| A per-issue record whose lesson an existing memory already owns | file only; link it from that memory |

`MEMORY.md` is loaded on **every turn**; `MEMORY-archive.md` is not loaded at all.
That split is the whole point. The test for `MEMORY.md` is not "is this true" or "was
this hard work" — it is **"would a session that never opens the file still make the
right call?"** If the index line is a bare pointer (`#123 → #456`, `blueprint`), it
belongs in the archive: nobody can act on a pointer, and it costs context every turn.

Judge by the **hook text, not the filename**. A file named `..._batch_2026` whose hook
states a reusable trap is durable and stays.

### Eviction — three triggers, all cheap

1. **On write.** Before adding a `MEMORY.md` line, check whether an existing memory
   already owns the lesson. Update that file instead of adding a sibling.
2. **On contradiction.** When a change invalidates a memory, fix the memory in the
   same session. Memories are point-in-time and nothing re-validates them, so the only
   moment anyone knows one went stale is the moment they make it stale. Prefer a dated
   **Superseded** note naming the PR over a silent rewrite — the old belief is often
   why a decision looks strange later.
3. **At each release close.** Sweep `MEMORY.md` for entries whose issues all closed and
   whose hooks state no reusable rule; demote them to a dated `## Archived` section in
   the archive. Put it on the release checklist.

Run **`/memory-audit`** at each release close to execute all three triggers at once —
it finds files with no `description:` (invisible to recall), multi-fact files, index
lines that are bare pointers, dead wiki-links, and grounding claims naming things that
no longer exist. A policy with no sweep is a rule that lives only in prose.

**The index has a hard read limit, and truncation is silent.** `MEMORY.md` is loaded on
every turn and cut off past roughly 24.4 KB: the harness loads part of it and says so
once, in a notice nobody is required to read, so indexed memories stop arriving with
nothing failing anywhere. Upstream hit it five times in four weeks. Each hand-compaction
bought 1-2 KB, and the index refilled in about eight days. **Compaction is not the fix;
the entry budget is.** `make memory-check` fails over a 23.8 KB budget or on a dangling
index link. When it fires, run a demotion pass *before* touching the threshold, and
record what the pass yielded — a budget raised instead of looking launders a regression.

**Never delete a memory to shrink the store.** Deleting for size destroys findings that
cost real debugging. The fix for an unreachable memory is a `description:`; the fix for
a noisy index is the archive. Delete only what is *wrong* and not worth recording as
superseded.

### Grounding claims degrade

A memory naming a file, line, flag, skill, or persona records what was true when it was
written. **Verify the referent still exists before recommending on it.** A document
asserting a thing exists is not the thing existing — gates and roster files have
survived in prose for months after being deleted or rewritten.
