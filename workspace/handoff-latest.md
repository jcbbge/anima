# Session Handoff
Date: 2026-03-21
Branch: main

## Previous Session (2026-03-20)

- **Fixed MCP tool name collision — robustly** — `indexOf("anima_", 1)` prefix stripping.
  Committed `c908030`.
- All three prefix cases verified: bare, `anima-mcp_`, `anima_` double-prefix.

## This Session (2026-03-21)

- **BUG-003 FIXED** — workspace gitignore resolved: `.gitignore` now tracks `workspace/specs/` and `workspace/handoff-latest.md` via negation patterns. 10 spec files + handoff now stageable.
- **BUG-007 VERIFIED** — curiosity worker `>` → `>=` fix already applied in prior session (scripts/curiosity-worker.ts). Schema threshold also updated to 3.5.
- **BUG-001/006 FIXED (prior session)** — synthesis daemon zombie resolved

## Wave 1 Status

| Bug | Status |
|-----|--------|
| BUG-001/006 | ✅ Fixed (prior) |
| BUG-007 | ✅ Fixed (prior) |
| BUG-003 | ✅ Fixed (this session) |
| BUG-002 | ⏳ Pending — active tier depletion

## Bugs Found and Specced

| Priority | File | One-liner | Status |
|----------|------|-----------|--------|
| CRITICAL | `bug-synthesis-daemon-zombie-and-dual-workers.md` | Daemon LIVE query silently died | ✅ Fixed (prior) |
| HIGH | `bug-curiosity-worker-hunger-threshold.md` | `>` should be `>=` | ✅ Fixed (prior) |
| HIGH | `bug-active-tier-depletion.md` | Synthesis drains all active memories | ⏳ Pending |
| MEDIUM | `bug-handoff-gitignore.md` | `workspace/` gitignored | ✅ Fixed (this) |
| MEDIUM | `bug-fold-model-config.md` | `fold_model` DB config never read | ⏳ Pending |
| LOW-MED | `bug-memory-versions-snapshot.md` | Snapshot fails silently | ⏳ Pending |

## Next Steps

1. Verify synthesis fires on next memory store (check `/tmp/synthesis-daemon.error.log`)
2. Fix BUG-002 — active tier depletion (add LIMIT 5 to fold query + update schema)
3. Fix BUG-004 — fold model config (read fold_model from DB)
4. Fix BUG-005 — memory versions snapshot

## Key State Notes

- `fold_config.pending_synthesis` = `idle`
- Old worker disabled at launchd level: `gui/501/anima.synthesis` — **do NOT re-enable**
- Daemon running: PID 7214 — restart with `launchctl kickstart -k gui/501/dev.anima.synthesis-daemon`
