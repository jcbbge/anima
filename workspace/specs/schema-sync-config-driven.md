# Spec: Schema Sync + Config-Driven Recency Window

**Status**: Ready for delegation
**Priority**: P0 — blocks synthesis worker verification and traversal bootstrap enablement
**Estimated complexity**: Small (< 2h)
**Can parallelize with**: Expressions wiring, curiosity threads, tension fields, origin attribution

---

## Context

The live SurrealDB (`anima/memory`) has drifted from `schema/anima.surql`. Two `fold_config` rows are missing from the live DB (`fold_model`, `traversal_bootstrap`). Additionally, the recency window constant used in Bug 2's re-synthesis prevention is hardcoded in `lib/synthesize.ts` — it should be config-driven so it can be tuned at runtime without a redeploy. `pending_synthesis` is stuck at `"pending:19f"` and needs a reset.

---

## Deliverables

### 1. Add `recently_folded_window_minutes` to schema

In `schema/anima.surql`, add one row to the `INSERT INTO fold_config` block:

```sql
{ key: 'recently_folded_window_minutes', value: '30', description: 'Minutes after a fold fires before the same memories are eligible for re-synthesis. Guards against re-synthesis loops.' },
```

### 2. Update `lib/synthesize.ts` — read window from fold_config

Replace the hardcoded constant with a fold_config lookup. The constant currently reads:

```typescript
const RECENTLY_FOLDED_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
```

Change to read from `fold_config` at the top of both `checkPhiPressure()` and `checkAndSynthesize()` (or extract a shared helper). Pattern to follow:

```typescript
// Read from fold_config, fall back to 30min if row missing
const windowRow = await query<{ value: string }>(
  "SELECT `value` FROM fold_config WHERE key = 'recently_folded_window_minutes' LIMIT 1"
);
const RECENTLY_FOLDED_WINDOW_MS = parseInt(windowRow[0]?.value ?? "30", 10) * 60 * 1000;
```

**Important**: The backtick-escape on `` `value` `` is required — `value` is a reserved keyword in SurrealDB 3.0 SELECT context. Do not remove it.

### 3. Run schema apply

```bash
cd /Users/jcbbge/anima
deno task schema
```

This inserts `fold_model`, `traversal_bootstrap`, and `recently_folded_window_minutes` (new). Existing rows are unaffected (INSERT skips on unique key conflict).

### 4. Reset stuck pending_synthesis watermark

Run directly against SurrealDB:

```bash
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' \
  -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["UPDATE fold_config SET `value` = '\''idle'\'' WHERE key = '\''pending_synthesis'\''"]}'
```

---

## Verification

After completing all steps, verify:

```bash
# 1. All four rows present with correct values
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' \
  -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["SELECT key, `value` FROM fold_config WHERE key INSIDE [\"fold_model\", \"traversal_bootstrap\", \"recently_folded_window_minutes\", \"pending_synthesis\"]"]}'

# Expected:
# fold_model                   → "claude-haiku-4-5-20251001"
# traversal_bootstrap          → "false"
# recently_folded_window_minutes → "30"
# pending_synthesis            → "idle"

# 2. TypeScript compiles cleanly
cd /Users/jcbbge/anima && npx tsc --noEmit 2>&1
```

---

## Files Modified

- `schema/anima.surql` — add `recently_folded_window_minutes` to INSERT block
- `lib/synthesize.ts` — replace hardcoded constant with fold_config lookup in `checkPhiPressure()` and `checkAndSynthesize()`

---

## Notes

- `recently_folded_window_minutes` feeds the recency guard introduced in Bug 2 fix (spec: `workspace/specs/bug-2-re-synthesis-prevention.md`).
- The `fold_model` row controls which LLM is called for synthesis folds. Code currently has a hardcoded fallback — this row makes it tuneable.
- `traversal_bootstrap = "false"` is intentional default. It gets flipped to `"true"` in a separate task once the bootstrap path is verified.
