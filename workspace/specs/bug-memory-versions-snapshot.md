---
spec: BUG-004
title: memory_versions Snapshot — Type Mismatch and Empty Table
priority: LOW-MEDIUM
status: ready-to-implement
created: 2026-03-21
---

# memory_versions Snapshot — Type Mismatch and Empty Table

## Summary

The `memory_versions` table is empty (0 records). Every fold attempt that tries to
snapshot pre-promotion memory state fails with a type coercion error and silently skips
the snapshot. The snapshot is logged as non-fatal and never blocks synthesis, but it means
there is zero version history for any promoted memory.

The schema was recently updated (commit `6c86e23`) to use `record<>` types for `fold_id`
and `memory_id`. However, the application code passes string values for these fields —
the SurrealDB TypeScript SDK v2 may serialize record IDs differently than the schema
expects, or there is a mismatch between what the SELECT returns and what CREATE expects.

---

## Current State

```sql
SELECT count() AS total FROM memory_versions GROUP ALL;
-- Result: { total: 0 }
```

Error messages from synthesis daemon logs:
```
[anima:fold] Snapshot failed (non-fatal): Couldn't coerce value for field `fold_id`
  of `memory_versions:rok7u76dpfxcfp71hua0`: Expected `string | none`
  but found `fold_log:tbj9d8js1kn80f5vr8sl`

[anima:fold] Snapshot failed (non-fatal): Couldn't coerce value for field `memory_id`
  of `memory_versions:swenpe8dppf94h3m9l9q`: Expected `string`
  but found `memories:138liw2opbaditrmeu1z`
```

The error messages say "Expected `string | none`" and "Expected `string`" — these match
the OLD schema definition. The current schema was updated to `record<fold_log>` and
`record<memories>`. This means either:
- The errors occurred BEFORE the schema fix commit, OR
- The DB was not updated when the schema file changed (schema is defined in the `.surql`
  file but `DEFINE ... OVERWRITE` must be re-run against the live DB)

---

## Root Cause Analysis

### Check 1: Is the current live DB schema correct?

Run to verify:
```sql
INFO FOR TABLE memory_versions;
```

Expected (post-fix schema):
```
fold_id:   TYPE none | record<fold_log>
memory_id: TYPE none | record<memories>
```

If this shows `TYPE string | none` for `fold_id` or `TYPE string` for `memory_id`,
the schema was NOT applied to the live DB. This is the primary issue to check first.

### Check 2: SDK RecordId serialization

In `lib/synthesize.ts`, the snapshot code (lines 554-604):

```typescript
const foldLogRows = await query<{ id: string }>(
  `SELECT id FROM fold_log WHERE output_memory_id = $output_id ORDER BY created_at DESC LIMIT 1`,
  { output_id: outputMemory?.id ?? undefined }
);
const foldId = foldLogRows[0]?.id ?? null;
```

The type annotation says `{ id: string }` but the SurrealDB TypeScript SDK v2 returns
record IDs as `RecordId` objects (e.g., `RecordId { table: 'fold_log', id: 'abc123' }`),
NOT plain strings. By annotating as `string`, TypeScript won't catch this mismatch.

When `fold_id: foldId` is passed to the CREATE query:
- If `foldId` is a `RecordId` object serialized by the SDK → it's written as a record
  reference → correct for `TYPE none | record<fold_log>`
- If `foldId` is a plain string `"fold_log:abc123"` → type mismatch with `record<fold_log>`

Similarly for `mem.id`:
```typescript
const currentStates = await query<{
  id: string; ...
}>(`SELECT id, ... FROM memories WHERE id INSIDE $ids`, { ids: inputIds });
```

`inputIds` comes from earlier in the fold as a list of record IDs. Their exact type
depends on how they were originally obtained.

### Check 3: Query parameter mismatch — $ids array types

In `performFold()`, `memories` are passed in as `Memory[]` where `Memory.id` may be
a `RecordId` object or a string depending on the code path. The snapshot code queries
`WHERE id INSIDE $ids` where `$ids` is `inputIds` (an array of IDs from the fold input).
The returned `id` field from this SELECT is a `RecordId` object in SDK v2.

---

## Fix

### Approach A: Ensure schema is applied to live DB (check first)

If the live DB has the old schema:
```sql
DEFINE FIELD fold_id ON memory_versions TYPE none | record<fold_log> OVERWRITE PERMISSIONS FULL;
DEFINE FIELD memory_id ON memory_versions TYPE none | record<memories> OVERWRITE PERMISSIONS FULL;
```

Run this against the live DB:
```bash
surreal sql --endpoint ws://127.0.0.1:8002/rpc \
  --username root --password root \
  --namespace anima --database memory <<'EOF'
DEFINE FIELD fold_id ON memory_versions TYPE none | record<fold_log> OVERWRITE PERMISSIONS FULL;
DEFINE FIELD memory_id ON memory_versions TYPE none | record<memories> OVERWRITE PERMISSIONS FULL;
EOF
```

Then run a fold and check if snapshot succeeds.

### Approach B: Change schema to accept strings (simpler, more robust)

If the SDK serialization issue persists even after schema correction, the simplest fix
is to revert `fold_id` and `memory_id` to string types. The `record<>` type provides
referential integrity but adds complexity. Since `memory_versions` is an audit log (not
a primary data table), string references are acceptable.

In `schema/anima.surql`, change:
```sql
-- Current (post-fix):
DEFINE FIELD fold_id ON memory_versions TYPE none | record<fold_log> PERMISSIONS FULL;
DEFINE FIELD memory_id ON memory_versions TYPE none | record<memories> PERMISSIONS FULL;
```
To:
```sql
DEFINE FIELD fold_id ON memory_versions TYPE none | string PERMISSIONS FULL;
DEFINE FIELD memory_id ON memory_versions TYPE none | string PERMISSIONS FULL;
```

Apply to live DB:
```bash
surreal sql ... <<'EOF'
DEFINE FIELD fold_id ON memory_versions TYPE none | string OVERWRITE PERMISSIONS FULL;
DEFINE FIELD memory_id ON memory_versions TYPE none | string OVERWRITE PERMISSIONS FULL;
EOF
```

This approach requires NO code changes — the application already passes string values,
and string references (like `"fold_log:abc123"`) are human-readable.

### Approach C: Fix code to pass RecordId objects (most correct, most complex)

Import SurrealDB's `RecordId` class in `lib/synthesize.ts` and construct proper RecordId
objects before passing to the CREATE query.

In `lib/synthesize.ts`, at the snapshot CREATE (line ~583):
```typescript
import { RecordId } from "surrealdb"; // Add to imports

// When building snapshot params:
const memRecordId = new RecordId("memories", mem.id.split(":")[1]); // if mem.id is a string
const foldRecordId = foldId ? new RecordId("fold_log", foldId.split(":")[1]) : undefined;

await query(`CREATE memory_versions SET memory_id = $mem_id, fold_id = $fold_id, ...`, {
  mem_id: memRecordId,
  fold_id: foldRecordId,
  ...
});
```

This is the most architecturally correct but requires understanding how the SDK v2 version
in use handles RecordId objects.

---

## Recommended Implementation Order

1. **First**: Run `INFO FOR TABLE memory_versions` to see current live schema
2. **If old schema**: Apply Approach A (DEFINE FIELD OVERWRITE)
3. **If schema already correct but still failing**: Apply Approach B (change to string)
4. After fix: Run a fold and verify `SELECT count() FROM memory_versions GROUP ALL` returns > 0
5. Optionally: Apply Approach C for long-term correctness (separate PR)

---

## Files to Modify

**If Approach A or B:**
- `/Users/jcbbge/anima/schema/anima.surql` — update field definitions
- Run DEFINE FIELD OVERWRITE against live DB

**If Approach B:**
- `/Users/jcbbge/anima/lib/synthesize.ts` — no code changes needed (strings pass as-is)

**If Approach C:**
- `/Users/jcbbge/anima/lib/synthesize.ts` — lines ~554-604, snapshot CREATE section
- Import `RecordId` from surrealdb

---

## Acceptance Criteria

1. After running a fold, `SELECT count() FROM memory_versions GROUP ALL` returns > 0
2. No "Snapshot failed" messages in synthesis daemon log
3. Snapshot records have correct `memory_id` and `fold_id` values pointing to the
   right memories and fold_log entries

---

## Non-Obvious Context

- `memory_versions` table is at SurrealDB `ws://127.0.0.1:8002/rpc`, namespace `anima`,
  database `memory` — same as all other anima tables
- The snapshot code is in `lib/synthesize.ts` inside the `performFold()` function at
  lines ~549-610. It is explicitly wrapped in try/catch with the message
  `[anima:fold] Snapshot failed (non-fatal):` — synthesis NEVER fails because of this
- The snapshot only fires for non-deepening triggers AND only for memories that `willPromote`
  (synthesis_count about to hit 2 for active→stable, or 5/phi>=4 for stable→thread)
- Commit `6c86e23` was titled "fix(schema): correct memory_versions field types — fold_id
  and memory_id as record refs" — this updated the schema FILE but may not have been
  applied to the live DB via a migration step
- The `.surql` schema file at `/Users/jcbbge/anima/schema/anima.surql` uses
  `DEFINE FIELD IF NOT EXISTS` — so re-running the schema file against the DB won't
  update already-defined fields. The `OVERWRITE` keyword must be used explicitly.

---

## Do NOT

- Do not make snapshot errors fatal — the `catch` block that logs "Snapshot failed
  (non-fatal)" must remain a catch block. Snapshots are audit data, not core functionality.
- Do not truncate or drop `memory_versions` — even though it's currently empty, the
  table definition and indexes should be preserved
- Do not add complex retry logic for snapshots — the watchdog in BUG-001 handles
  synthesis stalls; snapshots just need correct types
