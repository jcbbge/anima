# Session Handoff
Date: 2026-03-18
Branch: main

Completed:
- Fixed dev-brain "Anonymous access not allowed" — `getDb()` now checks `db.status === "connected"` before returning cached singleton; subscribes to `"disconnected"` event to proactively reset so next call creates fresh authenticated connection instead of using stale auth
- Fixed ALL plist PATH gaps — surreal, anima-worker, anima-daemon, curiosity-worker, ollama all had missing/wrong PATHs; cleaned up surreal plist which had stray KOTADB/OLLAMA env vars that don't belong there
- Redesigned `core` dashboard — live port check (HTTP/TCP) as primary status indicator instead of launchd cache; added CFG column showing plist health inline; removed redundant `validate` and `status` commands; `status`/`st` now aliases to `dash`

Current State:
- 3 files modified in anima repo (uncommitted): hooks/capture-interaction.sh, schema/anima.surql, workspace/handoff-latest.md
- Untracked: .claude/, cli/anima (wrapper), docs/anima-engine-prd.md, scripts/curiosity-worker.plist.template, scripts/curiosity-worker.ts
- Infrastructure changes (bin/core, dev-backbone/mcp-server/index.js, LaunchAgents plists) live outside any git repo — not committed anywhere

Next Steps:
1. Commit the anima repo changes (hooks port fix + schema changes) — ask Josh if ready
2. Apply the same `disconnected` event + `db.status` fix to anima-mcp (same SurrealDB client pattern, same stale auth risk)
3. Verify ~/bin/anima deno wrapper works end-to-end against cli/anima.ts
