# Session Handoff
Date: 2026-03-21
Branch: main

## Completed

- **Watchdog query fix** (`scripts/synthesis-daemon.ts:66`) — `value` was unquoted, SurrealDB 3 reserved word parse error, watchdog silently failed every 5 minutes. Added backticks. Verified query runs and daemon restarts clean.
- **Zombie LIVE query cleared** — `pending_synthesis` stuck at `pending:28.8f` since 06:20 (daemon started before fix was committed, stale process). Reset to `idle`, restarted daemon. LIVE query now active.
- **fold_config DB repaired** — 19 keys had `value = 'idle'` instead of real numbers. `parseInt('idle')` = NaN was breaking re-synthesis guard, cluster windows, tier thresholds. All 19 updated to correct defaults from schema.
- **Schema seed fixed** (`schema/anima.surql:192`) — `fold_model` seeded as `claude-haiku-4-5-20251001` (invalid OpenRouter ID). Updated to `anthropic/claude-haiku-4.5`. Re-running schema no longer re-corrupts.
- **maxTokens 200→400** (`lib/synthesize.ts:295`, `lib/llm.ts:129`) — synthesis content consumed the full 200 token budget, leaving nothing for ATTENTION_VECTOR block. `av_block_found: false` on every fold. Bumped to 400. Verified: `av_block_found: true`, `av_parse_ok: true`, `av_written: true`.
- **Ollama URL** — audited as mismatch; actually correct. Ollama runs at `:8001`. Non-issue.
- **Docs updated** — README: 7→8 tools, synthesis-worker→synthesis-daemon, stdio→HTTP. ANIMA.md: 5 tools stdio→8 tools HTTP port 3098. Specs: BUG-005 and BUG-001+006 marked done.

## Verification (all passed)

1. Daemon LIVE query fires on watermark change; watchdog catches stale; `pending→running→idle` lifecycle works
2. `model: anthropic/claude-haiku-4.5` + `av_block_found: true` + `av_written: true` on consecutive folds
3. Re-synthesis guard active — recently folded memories excluded within 30-min window

## Current State

- 8 files modified, uncommitted
- All three daemons running: MCP (PID 20346), synthesis-daemon (PID 19632), curiosity-worker (PID 43533)
- `fold_config` DB clean — all values correct
- `anthropic/claude-haiku-4.5` is the active fold model, attention vectors writing correctly

## Next Steps

1. **Commit this session's changes** — 8 files ready to stage
2. **BUG-002: active tier depletion** — spec `ready-to-implement`. Daemon reports "0 active memories" despite phi accumulation — tier query or threshold logic needs investigation.
3. **traversal-bootstrap** — P1 spec. `traversal_bootstrap = 'false'` in fold_config. 1500ms deadline exceeded on bootstrap is recurring. When ready, flip flag and test three-stage reconstitution.
4. **expressions-wiring** — P2 spec. `expressionsPending=0` in bootstrap, untouched.
