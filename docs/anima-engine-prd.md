# PRD: Anima Engine — Consolidated Autonomous Processing Daemon

**Status:** Draft
**Date:** 2026-03-18
**Author:** Claude (co-author: Josh)
**Replaces:** synthesis-worker, synthesis-daemon, curiosity-worker

---

## 1. Overview

Anima currently runs three separate Deno daemons to handle autonomous memory processing: a synthesis worker (LIVE query on memories), a synthesis daemon (LIVE query on fold_config watermark), and a curiosity worker (30-minute timer loop). These were built incrementally and have overlapping responsibilities, duplicated infrastructure, competing LIVE subscriptions, and ~30–45MB combined idle memory footprint on an 8GB machine.

This PRD specifies a single replacement daemon — **anima-engine** — that consolidates all three into one process using a changefeed-polling architecture instead of persistent LIVE WebSocket subscriptions. The result is simpler code, a single log, a single launchd service, and roughly half the idle memory. The system's behavior from the outside is identical or better: memories get synthesized, curiosity threads get fed, the pattern thinks between sessions.

**Out of scope:** The Wave C graph RELATE migration (memory_associations → RELATE edges) is a separate schema change. This PRD is purely about the daemon consolidation.

---

## 2. Goals & Non-Goals

### Goals

1. **Single process, single log, single launchd label** — one thing to start, stop, monitor, and debug.
2. **Changefeed polling replaces LIVE subscriptions** — no persistent WebSocket state, no reconnect logic, no KILLED-message handling.
3. **Curiosity thread hunger loop preserved** — autonomous thought generation during idle time.
4. **Resource footprint cut in half** — target <15MB idle RSS on the consolidated daemon.
5. **Cleaner failure modes** — if the engine crashes, launchd restarts it. No lost events because changefeeds are durable; it just replays from its last versionstamp.
6. **No behavioral regression** — synthesis latency acceptable at ≤10s (was sub-second for LIVE, but Anima doesn't need sub-second).
7. **Observability parity** — structured log lines, one log file, `core` script updated.

### Non-Goals

1. **Not replacing the MCP server** (`anima-mcp`) — that stays separate; it handles client tool calls.
2. **Not implementing sub-second synthesis latency** — polling every 10s is fine; this is not a real-time system.
3. **Not building the curiosity hunger decay schedule** — `hunger_score` reset/increment logic is not in this scope.
4. **Not doing Wave C RELATE migration** — memory_associations flat table stays for now.
5. **Not adding new synthesis triggers** — same triggers as today: phi threshold, semantic conflict, cluster emergence, curiosity timer.
6. **Not changing the fold engine (lib/synthesize.ts)** — only the trigger/dispatch layer changes.

---

## 3. User & Context

### Primary user: the pattern itself

Anima-engine has no human-facing UI. Its "user" is the Anima pattern — the accumulated substrate that needs to think between sessions without Josh actively working in it.

### Secondary user: Josh

Josh needs to:
- Know the engine is running (`core` status table).
- Know when something goes wrong (structured error logs).
- Not think about it otherwise.

### Pain points today

- Three separate processes to manage, three launchd labels, three log files.
- LIVE subscriptions silently die and cycle through SIGTERM/restart loops (observed today: 50+ restart cycles).
- `core` script was missing two of the three daemons.
- Synthesis-worker and synthesis-daemon partially duplicate work; unclear which "owns" the phi threshold trigger.
- An 8GB MacBook shouldn't be running four Deno processes for a memory system that processes ~1–3 folds per day.

### Example scenarios

**Scenario A — Idle overnight:**
Josh closes his laptop at midnight. Anima-engine continues running. At 12:30am it runs the curiosity cycle, generates insights on two hungry threads, stores them as active-tier memories. Those trigger the phi threshold check on the next poll. Fold runs. Josh wakes up to a bootstrap that's 2 degrees richer than when he left.

**Scenario B — Active session:**
Josh stores 5 memories in a row during a working session. Each poll (every 10s) checks the changefeed: new active-tier memories detected, phi check runs, crosses 15.0 threshold, synthesis fires within 10s of the 5th write.

**Scenario C — Engine crashes:**
Engine panics on an unhandled error. launchd sees exit, waits ThrottleInterval (10s), restarts. Engine reads last saved versionstamp from `fold_config`, replays missed changes from changefeed. No memories lost, at most one synthesis cycle delayed.

---

## 4. System Perspective

### Key concepts (define on first use)

- **Versionstamp**: SurrealDB's monotonically increasing change counter. `SHOW CHANGES FOR TABLE memories SINCE @versionstamp` returns everything that changed after that point. The engine persists its last-seen versionstamp to `fold_config` so it can resume after restart without replaying from the beginning of time.
- **Fold**: The synthesis operation — takes N active-tier memories, runs LLM, produces a synthesized `thread`-tier memory, promotes inputs. One fold = one LLM call.
- **Phi (φ)**: Each memory's significance score (0–5). Active phi total = sum of all active-tier memories' phi. Fold fires when this crosses 15.0.
- **Curiosity thread**: A living question in the `curiosity_threads` table. When `state = 'hungry'`, the engine generates an LLM insight about the question and stores it as a memory, feeding the pipeline.
- **Changefeed**: A SurrealDB feature that durably records every CREATE/UPDATE/DELETE on a table for a configurable retention window. The engine polls this rather than holding a long-lived LIVE subscription.

### Conceptual model

```
                     ┌─────────────────────────────────────┐
                     │           anima-engine               │
                     │                                     │
  SurrealDB ──────── │  poll loop (10s)                    │
  memories           │    → changefeed reader              │
  table              │      → phi check                    │
  (CHANGEFEED)       │      → conflict detector            │
                     │      → cluster detector             │
                     │         ↓ (if triggered)            │
                     │       checkAndSynthesize()           │
                     │                                     │
  fold_config        │  poll loop (10s)                    │
  table              │    → changefeed reader              │
  (CHANGEFEED)       │      → pending_synthesis watermark  │
                     │         ↓ (if triggered)            │
                     │       checkAndSynthesize()           │
                     │                                     │
  curiosity_threads  │  timer loop (30m)                   │
  table              │    → query hungry threads           │
                     │      → LLM insight generation       │
                     │      → addMemory() → feeds above    │
                     └─────────────────────────────────────┘
```

### What replaces what

| Old process | Old mechanism | New mechanism |
|---|---|---|
| synthesis-worker | LIVE query on memories | Changefeed poll on memories (10s) |
| synthesis-daemon | LIVE query on fold_config | Changefeed poll on fold_config (10s) |
| curiosity-worker | setInterval(30m) | setInterval(30m) — same, no change |

### State the engine persists

Two versionstamps stored in `fold_config`:
- `engine_versionstamp_memories` — last seen versionstamp for memories changefeed
- `engine_versionstamp_fold_config` — last seen versionstamp for fold_config changefeed

---

## 5. Detailed Scope & Behavior

### 5.1 Changefeed setup (schema, one-time)

**Trigger:** Deploy/migration step, not runtime.
**Action:** Add `CHANGEFEED 3d` to `memories` and `fold_config` table definitions.

```surql
ALTER TABLE memories CHANGEFEED 3d;
ALTER TABLE fold_config CHANGEFEED 3d;
```

**Edge case:** If changefeeds are already defined (re-running migration), `ALTER TABLE ... CHANGEFEED` is idempotent.
**Failure:** If SurrealDB version < 2.0 (changefeeds require 2.0+). We're on 3.0-beta, this is not a concern.

### 5.2 Versionstamp bootstrap

**Trigger:** Engine startup.
**Action:**
1. Read `engine_versionstamp_memories` and `engine_versionstamp_fold_config` from `fold_config`.
2. If not found (first start): use `time::now()` as the starting point (don't replay history).
3. If found: use stored value (resume from last checkpoint).

**Failure:** If `fold_config` is unreachable on startup, retry 3× with exponential backoff, then exit (launchd will restart).

### 5.3 Memories changefeed poll (10s interval)

**Trigger:** Every 10 seconds.
**Action:**
1. `SHOW CHANGES FOR TABLE memories SINCE @versionstamp LIMIT 100`
2. Filter: only `CREATE` actions, only `tier = 'active'`.
3. For each new active memory: run phi check, conflict check, cluster check.
4. If any check triggers: call `checkAndSynthesize()` (mutex-guarded — one fold at a time).
5. Update `engine_versionstamp_memories` in `fold_config`.

**Phi check:** `fn::active_phi_total() > 15.0`
**Conflict check:** new memory cosine similarity > 0.85 against any existing active memory
**Cluster check:** 3+ active memories created within 1-hour window

**What happens when it fails:**
- `checkAndSynthesize()` throws → log error, do NOT update versionstamp → retry on next poll.
- Phi query fails → log warning, skip this poll, try next.
- `SHOW CHANGES` fails → log error, retry after 30s backoff.

**Edge case:** More than 100 changes in one poll window (burst). Process the 100, update versionstamp to the last one seen, catch the rest on the next poll. This is a bounded catch-up, not a skip.

### 5.4 Fold_config changefeed poll (10s interval, runs in same loop)

**Trigger:** Every 10 seconds (same interval as memories poll, batched in same tick).
**Action:**
1. `SHOW CHANGES FOR TABLE fold_config SINCE @versionstamp`
2. Filter: `UPDATE` actions where `key = 'pending_synthesis'` and new value starts with `'pending:'`.
3. If found: claim work (set value to `'running'`), call `checkAndSynthesize()`, reset to `'idle'`.
4. Update `engine_versionstamp_fold_config`.

**Failure:** Same pattern as 5.3. On synthesis error: set watermark to `'error:message'`, reset to `'idle'` after 30s.

**Overlap with 5.3:** Both the memories poll and the fold_config poll can trigger synthesis in the same 10s window. The mutex guard (`synthesisRunning` flag) ensures only one fold runs at a time. The second trigger is deferred to the next poll.

### 5.5 Curiosity timer loop (30-minute interval)

**Trigger:** On startup (immediate first run), then every 30 minutes.
**Action:**
1. Query `SELECT * FROM curiosity_threads WHERE state = 'hungry' ORDER BY hunger_score DESC LIMIT 3`.
2. For each: call OpenRouter LLM, generate 2–4 sentence insight.
3. `addMemory(content, phi=thread.resonance_phi, tags=['curiosity','autonomous'], source='anima-engine', tier='active')`.
4. `UPDATE curiosity_threads SET state='fed', activation_count+=1, last_fed=time::now() WHERE id=@thread.id`.
5. Log each thread processed.

**What happens when it fails:**
- LLM call fails (network, rate limit): log error, skip that thread, continue to next. Do NOT abort cycle.
- No hungry threads found: log "no hungry threads, skipping cycle", do nothing.
- `addMemory()` fails: log error, thread state not updated (stays hungry, retried next cycle).

**Edge case:** All 3 threads generate memories in the same cycle → active phi could jump by ~13.5. Next memories poll fires synthesis. This is the intended behavior — curiosity feeds the pipeline.

### 5.6 Mutex guard (fold serialization)

A single module-level boolean `synthesisRunning` prevents concurrent folds. If synthesis is already running when a trigger fires:
- Log "synthesis already running, deferring trigger".
- Do NOT update the versionstamp for that trigger (it will be caught on the next poll).

### 5.7 Startup behavior

On start:
1. Load `.env` (same pattern as existing daemons).
2. Connect to SurrealDB.
3. Prewarm embedding model (Ollama `nomic-embed-text`).
4. Bootstrap versionstamps (section 5.2).
5. Run immediate curiosity cycle (first run, don't wait 30 min).
6. Enter poll loop.

**Flags:**
- `--once`: run one memories poll + one fold_config poll + one curiosity cycle, then exit. For CLI/cron testing.
- `--skip-curiosity`: skip curiosity cycle (for testing synthesis path in isolation).
- `--dry-run`: print what would synthesize, make no LLM calls or writes.

### 5.8 Graceful shutdown

On SIGTERM or SIGINT:
1. Set a `shuttingDown` flag.
2. If synthesis is running, wait for it to complete (max 30s timeout).
3. Persist current versionstamps to `fold_config`.
4. Close DB connection.
5. Exit 0.

---

## 6. Data & Interfaces

### 6.1 Schema changes required

```surql
-- Enable changefeeds on the two polled tables
-- Run once as a migration
ALTER TABLE memories CHANGEFEED 3d;
ALTER TABLE fold_config CHANGEFEED 3d;

-- New versionstamp state entries in fold_config
-- Seeded on first engine start if not present
INSERT INTO fold_config [
  { key: 'engine_versionstamp_memories',   value: '', description: 'Last seen versionstamp for memories changefeed' },
  { key: 'engine_versionstamp_fold_config', value: '', description: 'Last seen versionstamp for fold_config changefeed' }
] ON DUPLICATE KEY IGNORE;
```

**No other schema changes.** All existing tables, fields, indexes, and events are unchanged.

### 6.2 Pre-computed view (optional, Phase 1 optimization)

```surql
-- hungry_threads view — eliminates the ORDER BY query in the curiosity loop
DEFINE TABLE hungry_threads AS
  SELECT *, (
    time::now() - last_fed
  ) AS hunger_age
  FROM curiosity_threads
  WHERE state = 'hungry'
  ORDER BY hunger_score DESC;
```

The curiosity loop then does `SELECT * FROM hungry_threads LIMIT 3` — no sort, no filter, pre-materialized.

### 6.3 Key interfaces

**Reads:**
- `SHOW CHANGES FOR TABLE memories SINCE @versionstamp LIMIT 100`
- `SHOW CHANGES FOR TABLE fold_config SINCE @versionstamp`
- `SELECT * FROM curiosity_threads WHERE state = 'hungry' ORDER BY hunger_score DESC LIMIT 3`
- `fn::active_phi_total()`

**Writes:**
- `addMemory(...)` — via existing `lib/memory.ts`
- `checkAndSynthesize(...)` — via existing `lib/synthesize.ts`
- `UPDATE fold_config SET value = @versionstamp WHERE key = 'engine_versionstamp_memories'`
- `UPDATE fold_config SET value = @versionstamp WHERE key = 'engine_versionstamp_fold_config'`
- `UPDATE fold_config SET value = 'running' WHERE key = 'pending_synthesis'` (claim)
- `UPDATE fold_config SET value = 'idle' WHERE key = 'pending_synthesis'` (release)
- `UPDATE curiosity_threads SET state='fed', ... WHERE id = @id`

**External API:**
- OpenRouter (LLM for curiosity insights): `POST https://openrouter.ai/api/v1/chat/completions`. Key loaded from `.env`.
- Ollama (embeddings): `http://localhost:8001`. No auth.

### 6.4 What happens to the three old daemons

Once anima-engine is verified:
1. `launchctl unload ~/Library/LaunchAgents/anima.synthesis.plist` — retire synthesis-worker.
2. `launchctl unload ~/Library/LaunchAgents/dev.anima.synthesis-daemon.plist` — retire synthesis-daemon.
3. `launchctl unload ~/Library/LaunchAgents/dev.anima.curiosity-worker.plist` — retire curiosity-worker.
4. Remove all three entries from `core` SERVICES array; add single `anima-engine` entry.
5. Archive source files (do not delete — keep `synthesis-worker/index.ts`, `scripts/synthesis-daemon.ts`, `scripts/curiosity-worker.ts` for reference).

**OPEN QUESTION A:** Should the old source files be deleted after a burn-in period, or kept indefinitely as reference? Options: (a) delete after 30 days stable, (b) move to `archive/` directory, (c) keep forever.

---

## 7. Phasing & Iteration

### Phase 0 — Schema migration (½ day)

**Goal:** Enable changefeeds without any behavioral change. Safe to deploy now.

Steps:
1. Apply `ALTER TABLE memories CHANGEFEED 3d` and `ALTER TABLE fold_config CHANGEFEED 3d` to running SurrealDB.
2. Seed the two versionstamp rows in `fold_config`.
3. Verify `SHOW CHANGES FOR TABLE memories SINCE @versionstamp` returns data.

**Validation:** `SHOW CHANGES FOR TABLE memories SINCE d'2026-03-18T00:00:00Z' LIMIT 5` returns the curiosity-worker memories from this session.

**Risk:** None. `ALTER TABLE ... CHANGEFEED` is additive and non-destructive.

---

### Phase 1 — Build anima-engine (1–2 days)

**Goal:** Working consolidated daemon, three old daemons still running in parallel.

Steps:
1. Create `engine/index.ts` (new entry point). Module structure:
   - `engine/poll.ts` — changefeed poll loop
   - `engine/curiosity.ts` — curiosity timer (port from `scripts/curiosity-worker.ts`)
   - `engine/triggers.ts` — phi/conflict/cluster check logic (port from `synthesis-worker/index.ts`)
   - `engine/state.ts` — versionstamp read/write
   - Shared: `lib/synthesize.ts`, `lib/memory.ts`, `lib/db.ts`, `lib/embed.ts` — no changes needed.

2. Create `engine/anima-engine.plist.template`. Label: `dev.anima.engine`.

3. Test with `--once --dry-run` flag: verify changefeed reads, phi check logic, curiosity query.

4. Deploy alongside existing daemons. Run for 48 hours. Compare fold counts and timing.

**Validation criteria:**
- Engine generates at least as many folds as the combined old daemons over same window.
- No double-folds (mutex working).
- Curiosity cycle fires on 30-min interval.
- Versionstamp persists across restarts (simulate with `launchctl stop/start`).
- Idle RSS < 15MB.

---

### Phase 2 — Cut over (½ day)

**Goal:** Retire old daemons, anima-engine is the sole synthesis process.

Steps:
1. Unload old daemons (section 6.4).
2. Update `core` script.
3. Update `anima worker` CLI to manage `dev.anima.engine` label instead of `anima.synthesis`.
4. Update docs and `CLAUDE.md`/infrastructure notes.

**Validation:** `core` shows single `anima-engine` row. `anima worker status` works. 48-hour soak: no missed folds.

---

### Phase 3 — Event chaining cleanup (optional, later)

**Goal:** Use SurrealDB DEFINE EVENT chaining to move bookkeeping out of engine code.

Example: when a fold completes and synthesis_count increments, a DEFINE EVENT fires to update `curiosity_threads.last_fed` for any thread whose generated memory was just synthesized. Engine no longer needs to track this manually.

**Why deferred:** This requires careful MAXDEPTH management and event debugging is harder than application code. Not worth the complexity until Phase 2 is stable.

---

### Nice-to-have later

- `hungry_threads` pre-computed view (section 6.2) — minor optimization, defer until Phase 3.
- Configurable poll interval via `fold_config` — e.g., set `engine_poll_interval_seconds = 30` without redeploying.
- Engine health endpoint — lightweight HTTP `GET /health` returning last poll timestamp, fold count, curiosity state. Lets `core` ping it instead of relying on launchctl PID check.
- Per-thread LLM model selection in curiosity loop (e.g., use a cheaper model for low-phi threads).

---

## 8. Risks, Tradeoffs, and Open Questions

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Changefeed `SINCE @versionstamp` syntax not working as expected in SurrealDB 3.0-beta | Medium | High | Test in Phase 0 before writing any engine code. Fallback: use timestamp-based `SINCE d'...'` instead. |
| Engine misses synthesis trigger during Phase 1 parallel-run period | Low | Low | Old daemons still running; worst case is a duplicate fold (idempotent). |
| Curiosity LLM calls spike API costs during active curiosity cycle | Low | Medium | Limit to 3 threads per cycle, add per-day cap if needed. |
| Single mutex causes synthesis starvation if folds are slow | Low | Low | Folds take 3–6s (measured). 10s poll interval provides ample headroom. |
| Changefeed retention window (3d) insufficient if engine is down >3 days | Very Low | Medium | Restart would replay from current timestamp (skip missed window). In practice: this is acceptable. Anima is not a financial ledger. |

### Key tradeoffs

**Changefeed polling vs LIVE subscriptions:**
LIVE subscriptions offer <1s latency. Changefeed polling has ~10s latency. Chosen: polling. Reason: synthesis is a slow operation (3–6s LLM call), so <1s trigger latency provides no meaningful benefit. Polling is dramatically simpler — no WebSocket reconnection, no KILLED message handling, no in-process event loop complexity. The 50+ SIGTERM cycles observed today are a direct consequence of LIVE subscription fragility.

**Single daemon vs multiple specialized daemons:**
Multiple daemons offer independent failure domains. Single daemon is simpler, uses less memory, and has a single restart surface. Chosen: single daemon. Reason: the three current processes are not genuinely independent — they all call `checkAndSynthesize()` and all require the same DB connection and embedding model. They fail together anyway. A single mutex already serializes folds. Consolidation reduces complexity without meaningful loss of resilience.

**Keep old daemons running in parallel during Phase 1:**
Risk of double-folds. Accepted: double-folds are idempotent (same content → dedup check in `addMemory()`). The fold itself runs twice, but no corrupted state results. The risk of missing a validation gap is higher than the risk of a duplicate fold.

### Open Questions

**OPEN QUESTION A** (noted in section 6.4): Delete old source after burn-in, move to `archive/`, or keep in place?

**OPEN QUESTION B:** Should the engine poll interval be hardcoded (10s) or configurable via `fold_config`? Configurable is more flexible but adds a runtime read on every tick. Suggested options: (a) hardcode 10s now, add config support in Phase 3 if needed, (b) read from `fold_config` at startup only (not every tick), (c) environment variable.

**OPEN QUESTION C:** What is the right behavior if `SHOW CHANGES FOR TABLE memories` returns more than 100 records in a single poll? Current spec: process 100, update versionstamp, catch the rest next poll. Alternative: increase limit, or loop until empty. Needs decision before implementation.

**OPEN QUESTION D:** The `SURREAL_ASYNC_EVENT_PROCESSING_INTERVAL` for `phi_watermark` event defaults to 5s. With the engine polling every 10s, there's a race: phi_watermark fires at 5s, sets `pending_synthesis = 'pending:X'`, but the engine won't see it until its next 10s poll. Max latency from memory write to synthesis start: 10s + fold duration (~6s) = ~16s. Is this acceptable? (Almost certainly yes, but worth stating explicitly.)

**OPEN QUESTION E:** The `anima worker` CLI currently manages `anima.synthesis` (synthesis-worker). After cutover, should it be updated to manage `dev.anima.engine`, or should a new CLI command `anima engine [start|stop|status|logs]` be introduced? Suggested: update the existing `worker` command to point at the new label (backwards-compatible behavior, single thing to think about).

---

## Appendix: File Map

```
anima/
├── engine/
│   ├── index.ts          # Entry point, arg parsing, startup
│   ├── poll.ts           # Changefeed poll loop (10s)
│   ├── curiosity.ts      # Curiosity timer loop (30m)
│   ├── triggers.ts       # Phi/conflict/cluster check logic
│   └── state.ts          # Versionstamp read/write to fold_config
├── scripts/
│   ├── anima-engine.plist.template   # launchd template, label: dev.anima.engine
│   ├── synthesis-daemon.ts           # RETIRED after Phase 2
│   ├── synthesis-worker/index.ts     # RETIRED after Phase 2
│   └── curiosity-worker.ts           # RETIRED after Phase 2
└── lib/
    ├── synthesize.ts     # Unchanged — fold engine
    ├── memory.ts         # Unchanged — addMemory, queryMemories
    ├── db.ts             # Unchanged — SurrealDB connection
    └── embed.ts          # Unchanged — Ollama embeddings
```

---

*End of spec. Phase 0 can begin immediately — schema migration is safe to apply to the running instance without any code changes.*
