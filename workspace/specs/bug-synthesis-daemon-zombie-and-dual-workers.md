---
spec: BUG-001 + BUG-006
title: Synthesis Daemon — Zombie LIVE Query + Dual Worker Conflict
priority: CRITICAL
status: done
created: 2026-03-21
---

# Synthesis Daemon — Zombie LIVE Query + Dual Worker Conflict

## Summary

Two compounding issues have caused complete synthesis stall for 44+ hours:

1. **BUG-001**: The synthesis daemon (`dev.anima.synthesis-daemon`, PID 28132) has a silently
   dead SurrealDB LIVE query. The daemon is running but its `for await` loop hung after the
   connection dropped on March 18 23:03. It never received the watermark update to
   `pending:15.8f` set on March 19 16:11.

2. **BUG-006**: Two synthesis workers run simultaneously — the old `anima.synthesis`
   (`synthesis-worker/index.ts`) and the new `dev.anima.synthesis-daemon`
   (`scripts/synthesis-daemon.ts`). They fire on the same events, write to the same tables
   concurrently, and produce transaction write conflicts. The old worker must be decommissioned.

Neither issue alone caused the stall — the zombie LIVE query is the proximate cause, but the
dual-worker conflict was causing intermittent fold failures that masked the underlying fragility.

---

## Current State (as of 2026-03-21)

- `fold_config.pending_synthesis` = `'pending:15.8f'` (set 2026-03-19T16:11:33 — stuck there)
- `lastFoldAt` = `2026-03-19T04:21:06` (44+ hours stale, `synthesisStaleDays: 2`)
- PID 28132 (`dev.anima.synthesis-daemon`) — alive but silent since 2026-03-18T23:03
- PID 43484 (`anima.synthesis`) — alive but silent since 2026-03-18T16:34
- Log file: `/tmp/synthesis-daemon.error.log` — last entry shows folds succeeded then
  "Not enough active memories (1 < 3) — resetting watermark to idle" as the final state
  before going silent. But DB still shows `pending:15.8f` — the watermark reset failed.

---

## Root Cause — BUG-001: Zombie LIVE Query

### How the synthesis daemon triggers

1. A new memory is stored (via `anima_store` MCP call)
2. SurrealDB fires the `phi_watermark` DB event (defined on the `memories` table)
3. That event updates `fold_config.pending_synthesis` from `'idle'` → `'pending:15.8f'`
4. The synthesis daemon's LIVE query on `fold_config` receives the UPDATE event
5. Daemon dispatches `dispatchFold()`, runs synthesis, resets watermark to `'idle'`

### Why it fails silently

The SurrealDB connection drops periodically (the curiosity worker log shows this:
`Connection error detected — resetting and retrying once` every ~30 minutes). When this
happens, LIVE subscriptions can be silently killed without emitting a `KILLED` action. The
daemon's `for await (const message of await subscription)` iterator hangs indefinitely.

The code at `synthesis-daemon.ts:184` handles KILLED:
```typescript
if (message.action === "KILLED") {
  log("LIVE query killed — outer retry loop will reconnect");
  return; // exits startLiveListener, outer while(true) restarts it
}
```
But if KILLED is never delivered, `return` never runs, the outer `while(true)` never
retries, and the daemon is stuck.

### Why the watermark is stuck at pending:15.8f (not 'idle')

In `dispatchFold()` at line 115-116:
```typescript
log("Fold complete — resetting watermark to 'idle'");
await setWatermark("idle");
```

`setWatermark()` (lines 66-76) silently swallows errors:
```typescript
async function setWatermark(value: string): Promise<void> {
  try {
    await query(`UPDATE fold_config SET value = $value ...`, { value });
  } catch (err) {
    log(`Failed to set watermark to '${value}': ${(err as Error).message}`);
    // does NOT rethrow — caller never knows it failed
  }
}
```

The final "Not enough active memories" dispatch attempted to reset to idle, but the
`setWatermark("idle")` call failed (connection issue during that same period), silently
left the watermark at `pending:15.8f`, and logged to stderr (which we can see). But because
the daemon then went into zombie state, no new folds were ever attempted.

### Why new memories don't re-trigger

The `phi_watermark` DB event (on `memories` table) has this condition:
```sql
WHERE key = 'pending_synthesis' AND (
  value IS NONE OR value = 'idle' OR
  string::starts_with(value, 'pending:') = false
)
```
Since the watermark is already `pending:15.8f`, the condition `string::starts_with(value, 'pending:') = false` evaluates to FALSE. No update fires. No new LIVE event is emitted. Daemon stays stuck.

---

## Root Cause — BUG-006: Dual Workers

Two workers, two roles:

| Worker | Label | Script | LIVE target | What it handles |
|--------|-------|---------|-------------|-----------------|
| Old | `anima.synthesis` | `synthesis-worker/index.ts` | `memories` table CREATEs | Semantic conflict + cluster triggers |
| New | `dev.anima.synthesis-daemon` | `scripts/synthesis-daemon.ts` | `fold_config` watermark | φ threshold trigger |

When a new active memory is created:
1. Both workers see events within milliseconds of each other
2. Both call into synthesis functions that write `fold_log`, update `synthesis_count` on memories, write output memories
3. These concurrent writes cause: `Transaction conflict: Transaction write conflict.`

Evidence from `/tmp/synthesis-daemon.error.log`:
```
[anima:synthesis-daemon] Fold error: Transaction conflict: Transaction write conflict.
  This transaction can be retried — setting watermark to 'error:...' then 'idle' in 30s
```
This appears 3 times in the log.

The old worker handles conflict and cluster triggers. The new daemon handles phi threshold.
This division was never intentional — it emerged from incomplete migration. The old worker
should be fully decommissioned.

---

## Fix: Two-Phase Implementation

### Phase 1 — Immediate (reset and restart)

**Do this before starting the code changes:**

```bash
# 1. Reset the stuck watermark
surreal sql --endpoint ws://127.0.0.1:8002/rpc \
  --username root --password root \
  --namespace anima --database memory \
  <<'EOF'
UPDATE fold_config SET value = 'idle', updated_at = time::now()
WHERE key = 'pending_synthesis';
EOF

# 2. Stop the old synthesis worker permanently
launchctl stop anima.synthesis
launchctl disable anima.synthesis

# 3. Restart the synthesis daemon (force kill and launchd re-launches)
launchctl kickstart -k gui/$(id -u)/dev.anima.synthesis-daemon
```

Verify restart:
```bash
tail -f /tmp/synthesis-daemon.error.log
# Should see: "Starting synthesis daemon..." → "Startup: watermark is 'idle'" → "LIVE query active"
```

### Phase 2 — Structural fix (what this spec implements)

**Files to modify:**
- `/Users/jcbbge/anima/scripts/synthesis-daemon.ts`
- `/Users/jcbbge/anima/synthesis-worker/index.ts` (do NOT delete — archive/disable only)

#### 2a. Add watchdog timer to synthesis-daemon.ts

Add a periodic check that runs independently of the LIVE query, catching any pending
watermarks that were missed due to connection drops.

Location: **After** `await checkStartupWatermark();` and **before** the `while(true)` LIVE
loop in the entry point (around line 247).

```typescript
// ============================================================================
// Watchdog — catches pending watermarks missed by zombie LIVE queries
// Fires every 5 minutes. If watermark has been pending for >2 minutes, dispatch.
// ============================================================================

const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WATCHDOG_STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

function startWatchdog(): void {
  setInterval(async () => {
    try {
      const rows = await query<{ value: string; updated_at: string }>(
        `SELECT value, updated_at FROM fold_config WHERE key = 'pending_synthesis' LIMIT 1`,
        {},
      );
      const row = rows[0];
      if (!row?.value?.startsWith("pending:")) return;

      const staleness = Date.now() - new Date(row.updated_at).getTime();
      if (staleness < WATCHDOG_STALE_THRESHOLD_MS) return;

      log(`Watchdog: pending watermark '${row.value}' stale for ${Math.round(staleness / 1000)}s — dispatching fold`);
      dispatchFold().catch((err) =>
        log(`Watchdog fold error: ${(err as Error).message}`)
      );
    } catch (err) {
      log(`Watchdog check failed: ${(err as Error).message}`);
    }
  }, WATCHDOG_INTERVAL_MS);
}
```

Call it in the entry point, before the LIVE loop:
```typescript
// After checkStartupWatermark():
startWatchdog();

// Then the existing while(true) LIVE loop:
while (true) {
  try {
    await startLiveListener();
    ...
  }
}
```

#### 2b. Make setWatermark propagate failures

The silent error swallowing means watermark updates fail without any retry. Change
`setWatermark` to rethrow, and update callers to handle it.

In `synthesis-daemon.ts`, change `setWatermark`:
```typescript
async function setWatermark(value: string): Promise<void> {
  await query(
    `UPDATE fold_config SET value = $value, updated_at = time::now()
     WHERE key = 'pending_synthesis'`,
    { value },
  );
  // Let errors propagate — callers must handle. Watchdog will recover stuck watermarks.
}
```

Update callers to handle gracefully — the `dispatchFold` `finally` block already logs,
just ensure it logs clearly:
```typescript
} finally {
  synthesisRunning = false;
  try {
    await setWatermark("idle");
    log("Watermark reset to 'idle'");
  } catch (err) {
    log(`WARN: Failed to reset watermark to idle — watchdog will recover: ${(err as Error).message}`);
  }
}
```

#### 2c. Disable old synthesis worker (do NOT delete)

The old worker (`synthesis-worker/index.ts`) handles semantic conflict and cluster
emergence triggers. These are NOT currently implemented in the new daemon. Until they
are ported, disabling the old worker means we lose those triggers.

**Decision: Accept this tradeoff for now.** The phi threshold trigger is the primary
one. Conflict/cluster can be a follow-up spec.

```bash
# Disable (prevents launchd from auto-starting it)
launchctl disable anima.synthesis

# DO NOT delete the plist or source file — archive it:
# The plist: ~/Library/LaunchAgents/anima.synthesis.plist — leave in place, disabled
# The source: /Users/jcbbge/anima/synthesis-worker/index.ts — leave as-is
```

Add a comment at the top of `synthesis-worker/index.ts`:
```typescript
/**
 * DEPRECATED: This worker has been superseded by scripts/synthesis-daemon.ts
 * which uses a decoupled watermark architecture.
 *
 * The launchd service (anima.synthesis) is DISABLED but not removed.
 * Semantic conflict and cluster emergence triggers (handled here) need to be
 * ported to synthesis-daemon.ts before this file can be fully removed.
 *
 * DO NOT re-enable without first resolving the dual-worker transaction conflict.
 * See: workspace/specs/bug-synthesis-daemon-zombie-and-dual-workers.md
 */
```

---

## Acceptance Criteria

1. `tail -f /tmp/synthesis-daemon.error.log` shows the daemon running with active LIVE query
2. After storing a new memory (via `anima_store`), synthesis fires within 60 seconds
3. `anima_stats` returns `synthesisStaleDays: 0` after the next fold runs
4. No "Transaction conflict" errors appear in the daemon log after the old worker is disabled
5. If the SurrealDB connection drops and reconnects, the watchdog detects any pending
   watermark within 5 minutes and fires synthesis
6. `launchctl list anima.synthesis` shows PID 0 (not running)
7. `launchctl list dev.anima.synthesis-daemon` shows non-zero PID with recent log activity

---

## Non-Obvious Context for Implementer

- The daemon reads `fold_model` from `fold_config` table? **No.** It uses `PROFILES` in
  `lib/llm.ts`. That's a separate bug (see spec `bug-fold-model-config.md`).
- The `phi_watermark` DB event fires ONLY on `tier = 'active'` memories. If the
  curiosity worker creates memories with a different tier, the event won't fire.
- The `anima.synthesis` plist has `KeepAlive: true` — if you just `launchctl stop` it, it
  will restart. You must `launchctl disable` it to prevent restart.
- The synthesis daemon plist is at `~/Library/LaunchAgents/dev.anima.synthesis-daemon.plist`
- Logs: synthesis daemon → `/tmp/synthesis-daemon.error.log`; old worker → `~/Library/Logs/anima-synthesis.log`
- SurrealDB is at `ws://127.0.0.1:8002/rpc`, namespace `anima`, database `memory`
- Do NOT edit the plist directly to change env vars — use `deploy-plist` script per
  `~/bin/deploy-plist` and the secrets.md rules

---

## Do NOT

- Do not delete `synthesis-worker/index.ts` — it contains conflict/cluster trigger logic
  that isn't in the daemon yet
- Do not add retries to `setWatermark` with exponential backoff — the watchdog handles
  recovery; retries inside setWatermark create re-entrancy issues with `synthesisRunning`
- Do not change the LIVE query target table (fold_config) — that architecture is correct
- Do not restart SurrealDB as a fix — the daemon reconnects, but the watermark state is
  preserved in the DB

---

## Dependencies

- This spec should be implemented before `bug-active-tier-depletion.md` — tier depletion
  is a downstream consequence of synthesis being stalled. Fix the stall first, then
  evaluate if tier depletion is still a problem.
- `bug-fold-model-config.md` can be implemented in parallel (independent file).
