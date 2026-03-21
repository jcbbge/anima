# Spec: Enable and Verify Traversal Bootstrap

**Status**: Ready for delegation (after schema-sync-config-driven.md completes)
**Priority**: P1 — bootstrap currently falls back to cold load every session
**Estimated complexity**: XS (30min — mostly verification)
**Depends on**: schema-sync-config-driven.md (must insert traversal_bootstrap row first)

---

## Context

`traversalBootstrap()` in `lib/memory.ts` is implemented and gated behind a fold_config flag. When `traversal_bootstrap = "false"` (current default), it falls back to `bootstrapMemories()` — a cold DB load with no graph traversal. When enabled, it:

1. Parallel-fetches all four memory layers (network, stable, recent, catalyst)
2. Builds a 1-hop association graph from catalysts via `memory_associations`
3. Assembles a richer bootstrap context without any LLM calls
4. Hard deadline: 1500ms — if traversal takes longer, falls back to `bootstrapMemories()` silently

The bootstrap is called by `anima_bootstrap` in the MCP server at session start.

---

## Deliverables

### 1. Flip the flag

```bash
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' \
  -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["UPDATE fold_config SET `value` = '\''true'\'' WHERE key = '\''traversal_bootstrap'\''"]}'
```

### 2. Verify latency

Measure the bootstrap time:

```bash
time curl -s -X POST http://localhost:3098/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"anima_bootstrap","arguments":{}}}'
```

**Pass criteria**:
- Total wall time < 1500ms
- Response JSON contains `memoryCounts.trail` field (set by traversal path, absent in fallback path)
- No error in response

If wall time is >= 1500ms, the hard deadline fires and falls back to `bootstrapMemories()`. The response will succeed but `memoryCounts.trail` will be absent. In that case:
- Check which DB queries are slow: add timing logs to `traversalBootstrap()` temporarily
- Tune HARD_DEADLINE_MS upward if needed, or optimize the slow query

### 3. Run bootstrap twice, compare

First call warms any internal caches. Second call is the true latency baseline.

---

## Verification

```bash
# After flip:
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["SELECT `value` FROM fold_config WHERE key = '\''traversal_bootstrap'\'' LIMIT 1"]}'
# Expected: "true"

# After bootstrap test: confirm trail present
# memoryCounts.trail > 0 confirms traversal path fired (not fallback)
```

---

## Rollback

If bootstrap is consistently slow or erroring:
```bash
# Flip back to false
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["UPDATE fold_config SET `value` = '\''false'\'' WHERE key = '\''traversal_bootstrap'\''"]}'
```

---

## No Code Changes

This spec requires no code modifications. It is purely operational: flip flag, measure, confirm.

If latency issues are found, a follow-up spec will be created for query optimization.
