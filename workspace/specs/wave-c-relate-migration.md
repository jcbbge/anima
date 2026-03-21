# Wave C: Migrate `memory_associations` to Native SurrealDB RELATE Graph Edges

**Status:** Draft
**Author:** Agent instance
**Date:** 2026-03-18
**Scope:** Schema migration + application layer update only. No new features.

---

## Problem Statement

`memory_associations` is a flat SCHEMAFULL table with `memory_a` and `memory_b` record reference fields acting as a manually-managed join table. This is how graph edges were approximated before SurrealDB had first-class graph support.

SurrealDB 3.0 supports native `RELATE` graph edges. These are different in kind, not just syntax: the database understands them as directed edges in a graph, enabling native traversal operators (`->`, `<-`, `<->`), index-backed path queries, and cleaner schema DDL. The flat table requires two compound indexes (`idx_assoc_a_resonance`, `idx_assoc_b_resonance`) and an application-level `WHERE memory_a = $id OR memory_b = $id` double-query pattern to simulate what a graph edge gives for free.

The current implementation also has an acknowledged TODO in the schema comments: the reverse-reference fields (`associations`, `associations_as_b`) on `memories` were declared as plain writable arrays because the COMPUTED back-reference syntax was unconfirmed. RELATE edges eliminate the need for these fields entirely — the graph traversal IS the back-reference.

---

## Current Schema

```sql
-- Flat table, manually managed
DEFINE TABLE memory_associations SCHEMAFULL;

DEFINE FIELD memory_a            ON memory_associations TYPE record<memories> REFERENCE;
DEFINE FIELD memory_b            ON memory_associations TYPE record<memories> REFERENCE;
DEFINE FIELD strength            ON memory_associations TYPE float DEFAULT 1.0;
DEFINE FIELD co_occurrence_count ON memory_associations TYPE int DEFAULT 1;
DEFINE FIELD session_contexts    ON memory_associations TYPE array DEFAULT [];
DEFINE FIELD resonance_score     ON memory_associations TYPE option<float> DEFAULT 0.0;
DEFINE FIELD resonance_fold_count ON memory_associations TYPE option<int> DEFAULT 0;
DEFINE FIELD created_at          ON memory_associations TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at          ON memory_associations TYPE datetime DEFAULT time::now();

DEFINE INDEX assoc_pair ON memory_associations FIELDS memory_a, memory_b UNIQUE;
DEFINE INDEX idx_assoc_a_resonance ON memory_associations FIELDS memory_a, strength;
DEFINE INDEX idx_assoc_b_resonance ON memory_associations FIELDS memory_b, strength;
```

Plus two dead-weight reverse-ref fields on `memories`:
```sql
DEFINE FIELD IF NOT EXISTS associations       ON memories TYPE option<array<record<memory_associations>>> DEFAULT [];
DEFINE FIELD IF NOT EXISTS associations_as_b  ON memories TYPE option<array<record<memory_associations>>> DEFAULT [];
```

Write path in `associateMemories()` (lib/memory.ts):
```sql
UPSERT memory_associations
  SET memory_a = $a, memory_b = $b,
      co_occurrence_count = IF co_occurrence_count IS NONE THEN 1 ELSE co_occurrence_count + 1 END,
      strength = IF strength IS NONE THEN 1.0 ELSE math::min(5.0, strength + 0.1) END,
      ...
  WHERE memory_a = $a AND memory_b = $b;
```

---

## Target Schema

Replace the flat table with a DEFINE RELATION:

```sql
DEFINE TABLE associated TYPE RELATION IN memories OUT memories SCHEMAFULL;

DEFINE FIELD strength             ON associated TYPE float DEFAULT 1.0;
DEFINE FIELD co_occurrence_count  ON associated TYPE int DEFAULT 1;
DEFINE FIELD session_contexts     ON associated TYPE array DEFAULT [];
DEFINE FIELD resonance_score      ON associated TYPE float DEFAULT 0.0;
DEFINE FIELD resonance_fold_count ON associated TYPE int DEFAULT 0;
DEFINE FIELD created_at           ON associated TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at           ON associated TYPE datetime DEFAULT time::now();

DEFINE INDEX associated_pair ON associated FIELDS in, out UNIQUE;
DEFINE INDEX associated_strength ON associated FIELDS in, strength;
```

Drop from `memories`:
```sql
REMOVE FIELD associations ON memories;
REMOVE FIELD associations_as_b ON memories;
```

The `IN memories OUT memories` constraint makes the UNIQUE pair index on `in, out` enforce unidirectional edges. Since the current code canonicalizes pairs (`a < b` ordering in `associateMemories()`), the directionality is already deterministic — no behavior change needed.

---

## Migration Plan

### Can this be done in-place?

No. SurrealDB does not support `ALTER TABLE … TYPE RELATION`. The migration requires:

1. Export all rows from `memory_associations` to a JSON snapshot.
2. Apply the new DDL (`DEFINE TABLE associated TYPE RELATION …`).
3. Re-import as `RELATE` statements.
4. Drop the old table and the reverse-ref fields from `memories`.

This can be done with zero downtime if the synthesis daemon is paused during the data migration window (typically <1 minute for current dataset sizes).

### Migration Script Outline

```typescript
// scripts/migrate-associations.ts
// 1. Read all rows from memory_associations
const rows = await query(`SELECT * FROM memory_associations`);

// 2. Write as RELATE edges
for (const row of rows) {
  await query(`
    RELATE $source->associated->$target
    SET
      strength             = $strength,
      co_occurrence_count  = $count,
      session_contexts     = $contexts,
      resonance_score      = $rscore,
      resonance_fold_count = $rfold,
      created_at           = $created,
      updated_at           = $updated
  `, {
    source: row.memory_a,
    target: row.memory_b,
    strength: row.strength,
    count: row.co_occurrence_count,
    contexts: row.session_contexts,
    rscore: row.resonance_score ?? 0.0,
    rfold: row.resonance_fold_count ?? 0,
    created: row.created_at,
    updated: row.updated_at,
  });
}

// 3. Verify counts match
// 4. DROP TABLE memory_associations
```

Run order:
1. `launchctl stop anima.synthesis` — pause daemon
2. Run migration script
3. Apply schema DDL changes (new RELATE table, REMOVE dead fields)
4. `launchctl start anima.synthesis` — resume

---

## API Surface Changes

### lib/memory.ts — `associateMemories()`

**Before:** UPSERT into `memory_associations` flat table with WHERE clause.

**After:** Use `RELATE` with an `IF NOT EXISTS` guard, then UPDATE for existing edges:

```typescript
// Per pair — replace the UPSERT block:
await query(`
  IF NOT (SELECT id FROM associated WHERE in = $a AND out = $b LIMIT 1) {
    RELATE $a->associated->$b SET
      strength = 1.0,
      co_occurrence_count = 1,
      session_contexts = [$ctx],
      created_at = time::now(),
      updated_at = time::now();
  } ELSE {
    UPDATE associated SET
      co_occurrence_count += 1,
      strength = math::min(5.0, strength + 0.1),
      session_contexts = array::append(session_contexts, $ctx),
      updated_at = time::now()
    WHERE in = $a AND out = $b;
  }
`, { a, b, ctx: sessionContext ?? "" });
```

The canonicalization logic (`a < b` ordering) stays unchanged — it still ensures we always write `a->associated->b` in one direction.

### lib/synthesize.ts — resonance scoring in `performFold()`

**Before:**
```typescript
query(`UPDATE memory_associations SET
  resonance_score = (resonance_score ?? 0) + $delta,
  resonance_fold_count = (resonance_fold_count ?? 0) + 1,
  updated_at = time::now()
WHERE (memory_a = $a AND memory_b = $b) OR (memory_a = $b AND memory_b = $a)`, ...)
```

**After:**
```typescript
query(`UPDATE associated SET
  resonance_score += $delta,
  resonance_fold_count += 1,
  updated_at = time::now()
WHERE (in = $a AND out = $b) OR (in = $b AND out = $a)`, ...)
```

The OR clause still needed here because resonance scoring does NOT canonicalize — it uses the raw pair from `validInputIds`. Either fix the ordering at call site or keep the OR. Fixing at call site is cleaner.

---

## Query Examples: Before / After

### 1. Look up all associations for a memory (currently requires two queries or OR)

**Before:**
```sql
SELECT * FROM memory_associations
WHERE memory_a = memories:abc OR memory_b = memories:abc
ORDER BY strength DESC;
```

**After:**
```sql
SELECT ->associated AS edges FROM memories:abc;
-- or for full edge records:
SELECT ->associated->memories AS neighbors FROM memories:abc;
```

### 2. UPSERT / strengthen an edge

**Before:** Multi-field UPSERT with IS NONE guards on every field.

**After:** RELATE + UPDATE (two queries, but each is cleaner and the RELATE is idempotent with a UNIQUE index guard).

### 3. Find strongly resonant pairs (used in future graph-based bootstrap)

**Before:**
```sql
SELECT memory_a, memory_b, strength, resonance_score
FROM memory_associations
WHERE memory_a = $id OR memory_b = $id
ORDER BY resonance_score DESC
LIMIT 5;
```

**After:**
```sql
SELECT ->associated[WHERE resonance_score > 1.0]->memories AS resonant
FROM memories:$id
ORDER BY ->associated.resonance_score DESC
LIMIT 5;
```

---

## Backward Compatibility

- `memory_associations` table name is not exposed in any public MCP tool response. The MCP tools (`anima_associate`, `anima_query`) delegate entirely to `lib/memory.ts`. Callers see no change.
- The `associations` and `associations_as_b` fields on `memories` are schema-declared but the schema comment already flags them as provisional. No code reads them (confirmed: no calls to these fields in `memory.ts` or `synthesize.ts`). Safe to remove.
- `fold_log.input_memory_ids` stores raw memory IDs as strings — unaffected.
- `ghost_logs.top_phi_memory_ids` — same, unaffected.

---

## Success Criteria

- [ ] All rows from `memory_associations` successfully migrated to `associated` relation (count matches).
- [ ] `associateMemories()` writes RELATE edges; all existing tests pass.
- [ ] `performFold()` resonance scoring updates `associated` edges correctly.
- [ ] `SELECT ->associated->memories` traversal returns correct neighbors for a known memory.
- [ ] Old `memory_associations` table removed. Dead `associations` / `associations_as_b` fields removed from `memories`.
- [ ] Synthesis daemon restarts cleanly post-migration. `getStats()` still returns correct counts.
- [ ] No references to `memory_associations` remain in any `.ts` or `.surql` file.

---

## Out of Scope

- Graph traversal in bootstrap (multi-hop resonance walk). That is Wave D or later — this migration only creates the foundation.
- Changing the canonicalization strategy (always `a < b`) — keep as-is.
- Adding new edge types (e.g., a separate `conflicts` relation for semantic conflict pairs). Future work.
- Bidirectional RELATE (undirected edges). Current data is logically undirected but stored directionally via canonicalization. Leave that model intact.
- Performance benchmarking. Run after migration, not before.
