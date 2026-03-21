---
spec: BUG-002
title: Active Tier Depletion — Synthesis Fires but Finds No Memories
priority: HIGH
status: ready-to-implement
created: 2026-03-21
depends-on: bug-synthesis-daemon-zombie-and-dual-workers.md (fix synthesis stall first)
---

# Active Tier Depletion — Synthesis Fires but Finds No Memories

## Summary

When synthesis fires, it consistently finds 0–1 active-tier memories and aborts (minimum
is 3). Memories are promoted out of the active tier faster than they accumulate, leaving
synthesis with nothing to fold. This resulted in 4+ consecutive "Not enough active memories
(0 < 3)" and "(1 < 3)" aborts visible in the synthesis daemon log before synthesis went
fully stale.

---

## Current State

Direct DB query as of 2026-03-21:
```
SELECT tier, count() FROM memories GROUP BY tier:
  active: 3  (phi: 1.0, 3.5, 4.0 = 8.5 total — below 15.0 threshold)
  thread: 9  (phi: 4.8, 5.0, 4.5, 4.2, 4.0, 3.5, 2.0, 1.0, 1.0)
  stable: 267
  network: 6
```

Thread-tier memories have `access_count: 7` — they were accessed 7 times via bootstrap
and search queries after being created on 2026-03-19 and 2026-03-20. They are tagged
`['curiosity', 'autonomous']` — produced by the curiosity worker.

---

## Root Cause

### Promotion Mechanism: Two Paths

**Path A — DB event (synthesis_count based):**
```sql
DEFINE EVENT tier_promote ON memories ASYNC
WHEN $event = 'UPDATE' AND $after.synthesis_count != $before.synthesis_count AND ...
THEN {
  IF $after.tier = 'active' AND $after.synthesis_count >= 2
    → UPDATE SET tier = 'stable'
  ELSE IF $after.tier = 'stable' AND ($after.synthesis_count >= 5 OR resonance_phi >= 4.0)
    → UPDATE SET tier = 'thread'
}
```

This is the PRIMARY promotion mechanism. When a memory is used as fold input,
`synthesis_count` is incremented in `performFold()` at `lib/synthesize.ts:542`:
```typescript
synthesis_count = (synthesis_count ?? 0) + 1,
```

After being an input to 2 folds: active → stable.
After being input to 5 folds OR when phi >= 4.0: stable → thread.

High-phi curiosity memories (phi 4.2–5.0) satisfy `phi >= 4.0` immediately upon reaching
stable tier, so they go stable → thread after just 2 folds as input.

**Path B — access_count (read in `anima_query`, does NOT currently drive promotion):**
`access_count` is incremented in `mcp-server/index.ts:660` on every search result. The
`fold_config` table has `tier_thread_threshold: 3` but this value is NOT read by any
promotion code currently. It's vestigial from an earlier architecture. Access_count does
NOT cause tier promotion in the current codebase.

### The Depletion Loop

1. Curiosity worker creates 2–4 new active memories per cycle
2. Phi accumulates → `phi_watermark` event fires → synthesis dispatched
3. Synthesis folds ALL active memories (no cap on input count)
4. All input memories get `synthesis_count += 1`
5. After 2 folds as inputs: active → stable
6. High-phi memories immediately: stable → thread (phi >= 4.0)
7. Active tier is drained
8. Synthesis fires again (another phi accumulation), finds 0–1 memories, aborts
9. Watermark resets to idle, cycle repeats

During the burst of testing on 2026-03-17 through 2026-03-19 (multiple folds in rapid
succession), this loop ran many times, exhausting the active tier completely.

---

## Fix

### Option A — Cap fold input count (recommended, minimal impact)

In `synthesis-daemon.ts`, `dispatchFold()` at line 100–107, add `LIMIT 5` to the memory
selection query. This ensures at most 5 memories are consumed per fold, leaving others
in the active tier for subsequent folds.

Current query (lines 100–107):
```typescript
const memories = await query<Memory>(
  `SELECT id, content, resonance_phi, confidence, tier, tags, created_at, last_accessed
   FROM memories
   WHERE tier = 'active' AND deleted_at IS NONE
   AND (last_folded_at IS NONE OR last_folded_at < <datetime>$cutoff)
   ORDER BY resonance_phi DESC`,
  { cutoff: recentCutoff }
);
```

Change to:
```typescript
const memories = await query<Memory>(
  `SELECT id, content, resonance_phi, confidence, tier, tags, created_at, last_accessed
   FROM memories
   WHERE tier = 'active' AND deleted_at IS NONE
   AND (last_folded_at IS NONE OR last_folded_at < <datetime>$cutoff)
   ORDER BY resonance_phi DESC
   LIMIT 5`,
  { cutoff: recentCutoff }
);
```

This means: when 8 active memories exist, fold takes the top 5 by phi, leaves 3 for next
cycle. The `fold_min_memories = 3` minimum ensures we only fold when there's meaningful
material, and the 5-cap ensures we don't drain everything.

The value `5` should ideally come from `fold_config`. Add a config key:
```sql
INSERT INTO fold_config (key, value, description) VALUES
  ('fold_max_memories', '5', 'Maximum memories consumed per fold cycle. Prevents active tier depletion.');
```

Then read it in `dispatchFold()` alongside the existing `recently_folded_window_minutes` read:
```typescript
const maxRow = await query<{ value: string }>(
  "SELECT `value` FROM fold_config WHERE key = 'fold_max_memories' LIMIT 1",
  {},
);
const maxMemories = parseInt(maxRow[0]?.value ?? "5", 10);
```

### Option B — Slow promotion threshold (lower risk, higher impact)

Increase `synthesis_count` required for active → stable promotion from 2 to 3. This
means a memory must be folded 3 times before leaving active tier, giving more time for
accumulation.

Update the `tier_promote` DB event in `schema/anima.surql`:
```sql
-- Change: $after.synthesis_count >= 2
-- To:     $after.synthesis_count >= 3
```

Also update the live DB:
```sql
ALTER TABLE memories ...  -- SurrealDB 3.0 doesn't support ALTER TABLE for events
-- Must redefine the event:
DEFINE EVENT tier_promote ON memories ASYNC RETRY 1 MAXDEPTH 3
  WHEN $event = 'UPDATE' AND $after.synthesis_count != $before.synthesis_count AND $after.deleted_at = NONE
  THEN {
    IF $after.tier = 'active' AND $after.synthesis_count >= 3 {
      UPDATE memories SET tier = 'stable', tier_updated = time::now(), updated_at = time::now()
      WHERE id = $after.id
    } ELSE IF $after.tier = 'stable' AND ($after.synthesis_count >= 5 OR $after.resonance_phi >= 4f) {
      UPDATE memories SET tier = 'thread', tier_updated = time::now(), updated_at = time::now()
      WHERE id = $after.id
    }
  };
```

**Recommendation: Implement both A and B.** Cap at 5 inputs per fold AND require 3 folds
before active→stable promotion. These are independent levers that together give the system
breathing room.

---

## Files to Modify

- `/Users/jcbbge/anima/scripts/synthesis-daemon.ts` — lines 100–107 (add LIMIT to query,
  read `fold_max_memories` config)
- `/Users/jcbbge/anima/schema/anima.surql` — update `tier_promote` event threshold from 2 to 3
- Run against live DB to update the event definition (SurrealDB 3.0 `DEFINE EVENT ... OVERWRITE`)
- Optionally: add `fold_max_memories` to `fold_config` table via SQL INSERT

---

## Acceptance Criteria

1. After 3+ folds fire in succession, the active tier still retains at least 2–3 memories
2. "Not enough active memories" aborts disappear from daemon log during normal operation
3. Fold cycle produces output memories without draining active tier to zero
4. `fold_max_memories` is readable from fold_config and applied per fold

---

## Non-Obvious Context

- The `fold_config` and `config` tables are DIFFERENT tables in the same SurrealDB DB.
  The daemon reads from `fold_config`. The MCP server and old synthesize.ts read from
  `config`. Use `fold_config` for new config entries that the daemon reads.
- `recently_folded_window_minutes = 30` already prevents re-folding the same memories
  within 30 minutes. This partially mitigates depletion but doesn't prevent it entirely —
  the window expires and the same depleted state recurs.
- The `synthesis_count` field is incremented on ALL input memories in a fold, not just
  the "most relevant" ones. With 8 active memories folded at once, all 8 get incremented.
- The `snapshot` logic in `performFold()` runs AFTER `synthesis_count` is incremented,
  so it sees the post-increment count. This is why `willPromote` checks `>= 2` (after
  the increment, a count of 2 means it was just promoted).
- Verify the fix didn't break `recently_folded_window_minutes` guard — LIMIT must come
  BEFORE or AFTER the cutoff filter, not replace it.

---

## Do NOT

- Do not remove the `recently_folded_window_minutes` guard — it prevents immediate
  re-synthesis of just-folded memories
- Do not set LIMIT too low (e.g., 3) — fold quality degrades with fewer diverse inputs
- Do not change the `phi_threshold` (15.0) or `fold_min_memories` (3) — these are
  calibrated trigger points, not levers for this problem
- Do not manually promote memories to fix the immediate state — let synthesis run
  naturally after BUG-001 is fixed
