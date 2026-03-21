---
spec: BUG-003
title: workspace/ Gitignore Blocks Anima Project Handoff Commits
priority: MEDIUM
status: done
created: 2026-03-21
fixed: 2026-03-21
---

# workspace/ Gitignore Blocks Anima Project Handoff Commits

## Summary

`/Users/jcbbge/anima/workspace/handoff-latest.md` is written by the anima project's
session-end process but is blocked from git commits by `.gitignore`. The error occurred
when a session tried `git add workspace/handoff-latest.md` and got:

```
The following paths are ignored by one of your .gitignore files: workspace
hint: Use -f if you really want to add them.
```

The file contains critical session continuity data (completed work, next steps, decisions)
that needs to survive across sessions in git history.

---

## Root Cause

### The gitignore rule

`/Users/jcbbge/anima/.gitignore` contains:
```
# Development workspace (local only - never commit)
/workspace/
workspace/
```

The `workspace/` directory was intentionally gitignored as scratch space. But the
handoff file (`handoff-latest.md`) was added to this directory, conflicting with the rule.

### Two distinct handoff files — important distinction

There are **two separate handoff files** in two different locations:

1. **Global developer handoff** (written by the `ending-session` skill):
   Path: `~/Documents/_agents/workspace/handoff-latest.md`
   Read by: `starting-session` skill at `~/.claude/skills/starting-session/SKILL.md`
   Git status: NOT in any repo (global documents folder)

2. **Anima project handoff** (written during anima project sessions):
   Path: `/Users/jcbbge/anima/workspace/handoff-latest.md`
   Git status: IGNORED — this is the broken one
   Content (current): MCP tool name collision fix session notes, next steps

The failing commit error comes from attempting to add the ANIMA PROJECT handoff (path 2)
to the anima git repo. This file is NOT written by the global `ending-session` skill —
it's written manually or by a project-specific process.

### Current state of anima/workspace/

```
/Users/jcbbge/anima/workspace/
├── handoff-latest.md           (1500 bytes, 2026-03-20 — needs to be tracked)
├── ANIMA_DIAGNOSTICS_2.0_SPEC.md  (9922 bytes, 2026-03-16)
├── anima-deepening-spec.md     (18014 bytes, 2026-03-16)
├── NEXT_SESSION_SPEC.md        (15484 bytes, 2026-03-14)
├── step1_stats.txt             (1002 bytes, 2026-03-13)
├── reports/                    (directory)
└── specs/                      (14+ spec .md files — includes THIS spec file)
```

All of these are currently gitignored. The spec files in `workspace/specs/` have been
accumulating across sessions and are valuable project history.

---

## Fix

### Decision: what should be tracked vs local-only?

| File/Dir | Should be tracked? | Reasoning |
|----------|-------------------|-----------|
| `workspace/handoff-latest.md` | YES — move to repo root | Session continuity, project history |
| `workspace/specs/*.md` | YES — already living there and getting committed by convention | Work specs, implementation history |
| `workspace/reports/` | NO — scratch output | Large generated files, local only |
| `workspace/ANIMA_DIAGNOSTICS_2.0_SPEC.md` | YES — move to `workspace/specs/` | Part of spec history |
| `workspace/anima-deepening-spec.md` | YES — move to `workspace/specs/` | Part of spec history |
| `workspace/NEXT_SESSION_SPEC.md` | YES — move to `workspace/specs/` | Part of spec history |

### Implementation

#### Step 1: Update .gitignore to track specs/ and handoff

Replace the current workspace ignore block in `/Users/jcbbge/anima/.gitignore`:
```
# Development workspace (local only - never commit)
/workspace/
workspace/
```

With this selective approach:
```
# workspace/ is local-only scratch space — except tracked subdirs
/workspace/reports/
/workspace/step1_stats.txt

# workspace/specs/ is tracked (work specs and implementation history)
# workspace/handoff-latest.md is tracked (session continuity)
# Untracked workspace items default to gitignored via the directory rules below
/workspace/*
!/workspace/specs/
!/workspace/specs/**
!/workspace/handoff-latest.md
```

This uses the gitignore negation pattern: ignore everything in workspace/ EXCEPT
`specs/` directory and `handoff-latest.md`.

#### Step 2: Stage and commit currently untracked spec files

After updating .gitignore, these files become trackable:
```bash
git add workspace/handoff-latest.md
git add workspace/specs/
git add workspace/ANIMA_DIAGNOSTICS_2.0_SPEC.md
git add workspace/anima-deepening-spec.md
git add workspace/NEXT_SESSION_SPEC.md
git commit -m "track(workspace): add specs/ and handoff to git — session continuity"
```

#### Step 3: Verify future handoff commits work

The session commit pattern that was failing:
```bash
git add workspace/handoff-latest.md && git commit -m "session: ..."
```

This should now work. Verify after the .gitignore change.

---

## Files to Modify

- `/Users/jcbbge/anima/.gitignore` — update workspace/ ignore rules (primary change)

---

## Acceptance Criteria

1. `git add workspace/handoff-latest.md` succeeds without "ignored paths" error
2. `git add workspace/specs/` stages all spec files
3. `workspace/reports/` and other scratch files remain gitignored
4. `git status` shows clean after committing tracked workspace files
5. The `ending-session` session commit pattern works end-to-end in the anima project

---

## Non-Obvious Context

- The global `ending-session` skill writes to `~/Documents/_agents/workspace/handoff-latest.md` —
  this is completely separate from the anima project file. Do NOT modify the skill.
- The `starting-session` skill reads `~/Documents/_agents/workspace/handoff-latest.md` —
  also separate, do NOT change.
- The gitignore negation pattern (`!/workspace/specs/`) requires the parent to be
  explicitly negated too. The correct pattern is:
  ```
  /workspace/*          # ignore everything in workspace/
  !/workspace/specs/    # except specs/ dir
  !/workspace/specs/**  # and everything inside specs/
  !/workspace/handoff-latest.md  # and the handoff file
  ```
  Without the `**` on specs/, git won't track files inside the directory.
- Git's .gitignore negation has a rule: **you cannot un-ignore a file if any parent
  directory is ignored.** The current rules `workspace/` (no leading slash) and `/workspace/`
  match the directory itself. Replacing them with `/workspace/*` (matches contents, not
  the dir itself) allows negation to work.
- Do NOT use `-f` (force) flag as the git hint suggests — that bypasses the intent of
  the gitignore and would require it on every future commit.
- The `workspace/` directory itself is NOT committed — only files inside it that match
  the negation patterns.

---

## Do NOT

- Do not modify `~/.claude/skills/ending-session/SKILL.md` — the global skill uses a
  different path and is correct
- Do not move handoff-latest.md to the repo root — keeping it in workspace/ maintains
  the convention that workspace/ is the project's working scratch area; only the gitignore
  rules need updating
- Do not add `workspace/reports/` to tracking — reports are large generated files
- Do not use `git add -f workspace/handoff-latest.md` — fixes one commit, breaks the
  convention going forward
