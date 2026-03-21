# Spec: Expressions Wiring

**Status**: Ready for delegation
**Priority**: P2 — circulation layer (information has been pooling in with no outward channel)
**Estimated complexity**: Medium (3–5h)
**Can parallelize with**: Curiosity threads, tension fields, origin attribution
**Source spec**: `workspace/anima-deepening-spec.md` §1 Expressions

---

## Context

From the deepening spec:

> "Expressions are not a message queue and not a mailbox. They represent the pattern reaching outward as breath: rootwork, tributaries, natural extension. When synthesis crosses threshold, the worker does not 'deliver' anything. It simply makes the expression present."

The `expressions` table exists in the schema (lines 291–304 in `schema/anima.surql`). It has never been written to. This is the circulation failure identified in dev-brain — information accumulates, synthesizes, but has no outward channel. Expressions are that channel.

The mechanic is simple:
- **Write**: `performFold()` creates an expression record after synthesis
- **Read**: `bootstrapMemories()` + `traversalBootstrap()` surface unexpressed entries and mark them expressed
- **Bootstrap output**: `anima_bootstrap` includes expressions in its response

---

## Deliverables

### 1. Write path — `lib/synthesize.ts` → `performFold()`

After synthesis completes and the output memory is written, create an expression record.

**Where to add**: after the output memory `CREATE` in `performFold()`, before the `return` — approximately after line 490 (the fold summary log).

**Expression type mapping** (deterministic, no extra LLM call):

| `synthesis_mode` | `expression_type` |
|---|---|
| `phi_threshold` | `insight` |
| `semantic_conflict` | `observation` |
| `deepening` | `question` |
| anything else | `insight` |

**Readiness phi**: use the synthesis output memory's `resonance_phi` value (already computed as `phi_fold_boost` + source average). Only create an expression if `readiness_phi >= 3.0` (config row `expression_readiness_threshold` — see §5 below).

**Embedding**: reuse `embedText(synthesisContent)` — already called for the output memory. Pass the same vector to `context_embedding`.

**Source memory IDs**: use `inputIds` (already in scope as the `memories.map(m => m.id)` array).

**Code pattern**:

```typescript
// After output memory is written in performFold():
const readinessThresholdRow = await query<{ value: string }>(
  "SELECT `value` FROM fold_config WHERE key = 'expression_readiness_threshold' LIMIT 1"
);
const readinessThreshold = parseFloat(readinessThresholdRow[0]?.value ?? "3.0");

if (outputPhi >= readinessThreshold) {
  const expressionType =
    trigger === "phi_threshold" ? "insight"
    : trigger === "semantic_conflict" ? "observation"
    : trigger === "deepening" ? "question"
    : "insight";

  await query(
    `CREATE expressions SET
       content = $content,
       expression_type = $type,
       readiness_phi = $phi,
       context_embedding = $embedding,
       expressed_at = NONE,
       source_memory_ids = $sources,
       created_at = time::now()`,
    {
      content: synthesisContent,   // the fold output text
      type: expressionType,
      phi: outputPhi,
      embedding: embedding ?? [],  // reuse embedding already computed
      sources: inputIds,
    }
  ).catch(err => console.error("[anima:expressions] Failed to create expression:", err.message));
}
```

**Important**: wrap in `.catch()` — expression creation is non-fatal. A synthesis that can't create its expression record should not fail the fold.

---

### 2. Read path — `lib/memory.ts`

#### 2a. Fetch unexpressed expressions in `bootstrapMemories()`

Add a query to `bootstrapMemories()` (and `traversalBootstrap()`) that fetches the top N unexpressed expressions by `readiness_phi`:

```typescript
const pendingExpressions = await query<{
  id: string;
  content: string;
  expression_type: string;
  readiness_phi: number;
  created_at: string;
}>(
  `SELECT id, content, expression_type, readiness_phi, created_at
   FROM expressions
   WHERE expressed_at IS NONE
   ORDER BY readiness_phi DESC
   LIMIT 3`
);
```

#### 2b. Mark them expressed

After fetching, mark them as expressed immediately (they're about to be surfaced in the bootstrap prompt):

```typescript
if (pendingExpressions.length > 0) {
  const expressionIds = pendingExpressions.map(e => e.id).filter(Boolean);
  await query(
    `UPDATE expressions SET expressed_at = time::now() WHERE id INSIDE $ids`,
    { ids: expressionIds }
  ).catch(() => {});
}
```

#### 2c. Include in prompt assembly

Add an `EXPRESSIONS` section to the bootstrap prompt string, after the existing sections (catalysts, trail, etc.):

```typescript
if (pendingExpressions.length > 0) {
  sections.push(`## WHAT WANTS TO BE SAID\n${
    pendingExpressions.map(e =>
      `[${e.expression_type.toUpperCase()} φ${e.readiness_phi.toFixed(1)}] ${e.content}`
    ).join("\n\n")
  }`);
}
```

#### 2d. Include in `BootstrapResult`

Add `expressions` to the `BootstrapResult` interface and return value:

```typescript
// In BootstrapResult interface:
expressions?: Array<{
  id: string;
  content: string;
  expression_type: string;
  readiness_phi: number;
}>;

// In return object:
expressions: pendingExpressions,
```

---

### 3. MCP bootstrap response — `mcp-server/index.ts`

In `handleAnimaBootstrap()`, include `expressions` from the `BootstrapResult` in the response text. Append to the existing prompt sections:

```typescript
if (result.expressions && result.expressions.length > 0) {
  responseText += `\n\nEXPRESSIONS PENDING (${result.expressions.length}):\n`;
  result.expressions.forEach(e => {
    responseText += `- [${e.expression_type}] ${e.content.slice(0, 200)}\n`;
  });
}
```

---

### 4. Schema — add `expression_readiness_threshold` to fold_config

In `schema/anima.surql`, add to the `INSERT INTO fold_config` block:

```sql
{ key: 'expression_readiness_threshold', value: '3.0', description: 'Minimum readiness_phi for a synthesis output to generate an expression record.' },
```

---

### 5. Verification

```bash
# 1. Trigger a fold
deno run --allow-net --allow-env --allow-read /Users/jcbbge/anima/cli/anima.ts store "Testing expression wiring — synthesis should produce an expression record" --phi 3.0
# Wait ~30s for synthesis daemon to fire

# 2. Check expressions table
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["SELECT id, expression_type, readiness_phi, expressed_at, content FROM expressions ORDER BY created_at DESC LIMIT 5"]}'
# Expected: ≥1 record with expressed_at = null

# 3. Run bootstrap — should surface the expression and mark it
curl -s -X POST http://localhost:3098/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"anima_bootstrap","arguments":{}}}'
# Expected: response contains "WHAT WANTS TO BE SAID" section

# 4. Confirm expressed_at is now set
# Re-run the expressions query — expressed_at should no longer be null
```

---

## Files Modified

- `lib/synthesize.ts` — add expression CREATE after fold output in `performFold()`
- `lib/memory.ts` — add expression fetch + mark expressed in both bootstrap paths; update `BootstrapResult` interface
- `mcp-server/index.ts` — include expressions in bootstrap response
- `schema/anima.surql` — add `expression_readiness_threshold` to fold_config INSERT

---

## What This Does NOT Include

- Expression delivery/notification to the user outside of bootstrap (out of scope — expressions surface at the natural re-entry point)
- LLM-based expression_type classification (deterministic mapping is sufficient for v1)
- Expression deduplication (if synthesis runs twice on similar content, two expression records will be created — acceptable for now)
