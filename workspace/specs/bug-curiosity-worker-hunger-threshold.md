---
spec: BUG-007
title: Curiosity Worker — Strict Inequality Blocks All Thread Activation
priority: HIGH
status: done
created: 2026-03-21
fixed: 2026-03-21
---

# Curiosity Worker — Strict Inequality Blocks All Thread Activation

## Summary

The curiosity worker always reports "No hungry threads found — nothing to do" despite
7 curiosity threads being present, with hunger scores of 3.5–5.0. The bug: the query
uses strict `hunger_score > $threshold` where `$threshold = 5.0`. Since 5.0 is the
maximum possible phi value, NO thread can ever satisfy `> 5.0`. The correct operator
is `>=`.

This is a single-character bug (`>` → `>=`) that has been silently starving the curiosity
system, preventing autonomous curiosity generation for as long as it has been deployed.

---

## Evidence

Current curiosity_threads state:
```
hunger_score: 5.0  (state: hungry)  ← should be found, isn't
hunger_score: 4.8  (state: hungry)  ← would also not be found
hunger_score: 4.5  (state: hungry)
hunger_score: 4.2  (state: hungry)
hunger_score: 4.0  (state: hungry)
hunger_score: 4.0  (state: hungry)
hunger_score: 3.5  (state: hungry)
```

`fold_config.curiosity_hunger_threshold` = `5.0` (NOTE: this value is ALSO the problem —
see below)

The query in `scripts/curiosity-worker.ts` at line ~187:
```typescript
WHERE state = 'hungry' AND hunger_score > $threshold
ORDER BY hunger_score DESC
```

With `threshold = 5.0` and `hunger_score MAX = 5.0`:
- `hunger_score > 5.0` is NEVER true for any real memory (phi max is 5.0)
- Result: always zero records, always "No hungry threads found"

Curiosity worker log confirms:
```
[anima:curiosity-worker] Running curiosity cycle...
[anima:curiosity-worker] No hungry threads found — nothing to do
[anima:curiosity-worker] Running curiosity cycle...
[anima:curiosity-worker] No hungry threads found — nothing to do
```

This repeats indefinitely.

---

## Root Cause

### Part 1: Wrong comparison operator

File: `/Users/jcbbge/anima/scripts/curiosity-worker.ts`, line ~187:
```sql
WHERE state = 'hungry' AND hunger_score > $threshold
```

Should be:
```sql
WHERE state = 'hungry' AND hunger_score >= $threshold
```

### Part 2: Threshold value may also be wrong

The `curiosity_hunger_threshold` in `fold_config` is `5.0`. Combined with `>=`, this
means ONLY threads with exactly `hunger_score = 5.0` would be found.

Looking at the current thread scores: only ONE thread has score exactly 5.0. The others
(4.8, 4.5, 4.2, 4.0, 4.0, 3.5) would still not be processed.

The hunger threshold `5.0` is likely wrong — it was probably intended as a percentage
or a normalized value, not an absolute phi cap. The phi max IS 5.0, so a threshold of
5.0 means "only maximally significant threads get attention."

**Recommended fix**: Lower the threshold to `3.5` or `4.0` to allow threads with
meaningful but not maximum hunger to be processed.

The threshold is configurable at runtime without code changes:
```sql
UPDATE fold_config SET value = '3.5', updated_at = time::now()
WHERE key = 'curiosity_hunger_threshold';
```

### Part 3: core CFG ⚠ warning

The `core` diagnostic shows `⚠` in the CFG column for `curiosity-worker`. The core
script at `~/bin/core` checks for a config file for each service. The curiosity-worker
is registered as `dev.anima.curiosity-worker` in launchctl.

From the core script inspection, the CFG check for `curiosity-worker` uses the entry:
```
"curiosity-worker|launchd|dev.anima.curiosity-worker|0|Curiosity thread worker|/tmp/curiosity-worker.error.log"
```

The `⚠` may indicate a missing config validation file or a plist key that core
expects. This is a separate (likely cosmetic) issue — the worker is running correctly
per launchctl (PID 43533 active). Investigate and update core's service registration
if the check is wrong.

---

## Fix

### Step 1: Fix the query operator (required)

File: `/Users/jcbbge/anima/scripts/curiosity-worker.ts`

Find the query at approximately line 187:
```typescript
`WHERE state = 'hungry' AND hunger_score > $threshold`
```

Change `>` to `>=`:
```typescript
`WHERE state = 'hungry' AND hunger_score >= $threshold`
```

### Step 2: Lower the hunger threshold (strongly recommended)

Lower `curiosity_hunger_threshold` from `5.0` to `3.5` in the live DB:
```bash
surreal sql --endpoint ws://127.0.0.1:8002/rpc \
  --username root --password root \
  --namespace anima --database memory <<'EOF'
UPDATE fold_config SET value = '3.5', updated_at = time::now()
WHERE key = 'curiosity_hunger_threshold';
EOF
```

Also update `schema/anima.surql` so the value is correct on next schema apply:
Find and update the `curiosity_hunger_threshold` seed value from `5.0` to `3.5`.

With threshold `3.5` and `>=`: 6 of 7 threads (score 3.5+) would be eligible for
curiosity processing. The worker takes top-3 per cycle, so it would run each cycle.

### Step 3: Investigate and fix core CFG ⚠ (investigation required)

Read `~/bin/core` to find the CFG check logic. The check likely verifies a plist file
or config file exists and is valid. The `⚠` may indicate:
- The `dev.anima.curiosity-worker` plist is registered in launchd but core's config
  check path doesn't match the actual file location
- OR a required config key is missing from the plist

Check: `~/Library/LaunchAgents/dev.anima.curiosity-worker.plist`
Compare against what core expects. If it's a false positive, update core's registration
entry or the plist to match.

---

## Files to Modify

**Required:**
- `/Users/jcbbge/anima/scripts/curiosity-worker.ts` — line ~187, change `>` to `>=`
- Live DB `fold_config` — lower `curiosity_hunger_threshold` from `5.0` to `3.5`

**Recommended:**
- `/Users/jcbbge/anima/schema/anima.surql` — update `curiosity_hunger_threshold` seed
  value from `5.0` to `3.5`
- `~/bin/core` — fix CFG ⚠ false positive for curiosity-worker (investigate first)

---

## Acceptance Criteria

1. ✅ After fix, next curiosity worker cycle log shows:
   ```
   [anima:curiosity-worker] Running curiosity cycle...
   [anima:curiosity-worker] Found 3 hungry thread(s)
   [anima:curiosity-worker] Processing thread: "..."
   ```
2. ✅ `curiosity_threads` records show `activation_count` incrementing and `last_fed`
   updating after each cycle
3. ✅ New memories tagged `['curiosity', 'autonomous']` appear in `memories` table
   with recent `created_at` timestamps
4. `core` shows `✓` (not `⚠`) in CFG column for curiosity-worker (separate issue)

---

## Fix Applied (2026-03-21)

### Changes made:
1. **`scripts/curiosity-worker.ts:187`** — `>` → `>=` (single char fix)
2. **`scripts/curiosity-worker.ts:183`** — fallback threshold `"5.0"` → `"3.5"`
3. **Live DB** — `fold_config.curiosity_hunger_threshold` = `'3.5'`
4. **`schema/anima.surql`** — seed value updated to `'3.5'`

### Verification:
```
> UPDATE fold_config SET value = '3.5', updated_at = time::now() WHERE key = 'curiosity_hunger_threshold'
> SELECT * FROM fold_config WHERE key = 'curiosity_hunger_threshold'
{"value":"3.5"}
```

With threshold `3.5` and `>=`: 6 of 7 threads (score 3.5+) are now eligible for processing.

---

## Non-Obvious Context

- The curiosity worker runs every 30 minutes (check the scheduling mechanism in
  `scripts/curiosity-worker.ts` and/or the plist `StartInterval` or `StartCalendarInterval`)
- After fixing the query, the worker processes TOP-3 threads per cycle by `hunger_score DESC`.
  With threshold `3.5`, all 6 qualifying threads will eventually be processed.
- The curiosity worker generates a new memory (LLM synthesis of a response to the thread's
  question) and stores it via `anima_store` semantics — these memories go into the active
  tier and contribute to phi accumulation. Fixing this bug will INCREASE active tier memory
  creation, which is exactly what BUG-002 (tier depletion) needs.
- After the worker processes a thread, it resets `state = 'hungry'` with updated `last_fed`.
  The hunger score recomputes on each cycle. With no starvation (just fed), hunger starts
  low and climbs over time.
- Connection errors (`Connection error detected — resetting and retrying once`) are
  periodic but non-fatal. The worker reconnects and continues. This is the same pattern
  seen in other anima daemons — a known SurrealDB connection stability issue.
- The curiosity threads were seeded by `scripts/seed-curiosity.ts` — there's no ongoing
  mechanism to ADD new threads currently (that would come from synthesis producing new
  curiosity-tagged memories). The 7 existing threads were seeded manually.
- Daemon label: `dev.anima.curiosity-worker`
- Log file: `/tmp/curiosity-worker.error.log`

---

## Do NOT

- Do not set `curiosity_hunger_threshold` below `3.0` — all 7 threads would be "always
  hungry" and the worker would burn LLM tokens every 30 minutes on low-quality questions
- Do not change the worker to process more than 3 threads per cycle without testing
  LLM cost implications — each thread activation makes an LLM call
- Do not set the threshold to `0` or remove it — that's a runaway loop waiting to happen
- Do not restart the curiosity worker after the code fix without also updating the
  threshold in the DB — the code fix alone only makes score = 5.0 threads eligible
