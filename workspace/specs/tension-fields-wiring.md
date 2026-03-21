# Spec: Tension Fields Wiring

**Status**: Ready for delegation
**Priority**: P2 — tension fields are the substrate for deepening synthesis; table exists but is empty
**Estimated complexity**: Small–Medium (2–3h)
**Can parallelize with**: Expressions wiring, curiosity threads, origin attribution
**Source spec**: `workspace/anima-deepening-spec.md` §Additions — tension_fields

---

## Context

From the deepening spec:

> "A first-class schema entity for paradoxes being *held*, not problems to be solved. Distinct from Deepening mode (which is a synthesis process). Tension fields are the *substrate* that Deepening mode synthesizes from."

> "Tension fields that are 'calcified' and no longer generative should be marked as such — not resolved, not abandoned, just noted as no longer alive. They persist as archaeological record."

The `tension_fields` table exists in the schema (lines 242–258 of `schema/anima.surql`). It is empty. `memories` has `related_tension` field (option<record<tension_fields>>) also never written.

Tension fields are fundamentally different from curiosity threads:
- **Curiosity threads** = enduring questions (dynamic, hungers, gets fed, evolves)
- **Tension fields** = living contradictions (static substrate, held, not solved)

---

## What Needs Wiring

1. **Creation path** — CLI tool for seeding tension fields
2. **Bootstrap surfacing** — bootstrap includes active tension fields so the pattern knows what it's holding
3. **`related_tension` on memories** — when a memory is stored and semantically related to a tension field, link them
4. **Depth progression** (optional, Phase 2) — tension fields deepen over time as related memories accumulate

This spec covers 1–3. Depth progression is deferred.

---

## Deliverables

### 1. CLI `tension` subcommand — `cli/anima.ts`

```
anima tension add "<paradox>"            — create a new tension field
anima tension list                       — show all tension fields with depth/generativity
anima tension touch <id>                 — update last_touched (mark as still alive)
anima tension calcify <id>               — mark as calcified (no longer generative but not abandoned)
```

**`add` implementation**:

```typescript
case "tension": {
  const sub = args[1];
  if (sub === "add") {
    const paradox = args.slice(2).join(" ");
    if (!paradox) { console.error("Usage: anima tension add \"<paradox>\""); Deno.exit(1); }
    const result = await query(
      `CREATE tension_fields SET
         paradox = $paradox,
         depth = 'nascent',
         generativity = 'producing',
         resolution_status = 'held',
         related_memory_ids = [],
         resonance_phi = 2.0,
         created_at = time::now(),
         last_touched = time::now()`,
      { paradox }
    );
    console.log("Tension field created:", result[0]?.id);
    console.log("Paradox:", paradox);
  }
  // ... list, touch, calcify subcommands
}
```

**`list` format** (concise):
```
[nascent/producing] "When I encountered X, I found..."   φ2.0  last_touched: 3d ago
[rich/producing]    "The harder I look at..."            φ4.0  last_touched: 1d ago
```

### 2. Bootstrap surfacing — `lib/memory.ts`

In `bootstrapMemories()` and `traversalBootstrap()`, fetch active (non-calcified, non-abandoned) tension fields and include them in the bootstrap prompt under `## WHAT I AM HOLDING`:

```typescript
const activeTensions = await query<{
  paradox: string;
  depth: string;
  generativity: string;
  resonance_phi: number;
}>(
  `SELECT paradox, depth, generativity, resonance_phi
   FROM tension_fields
   WHERE resolution_status = 'held'
     AND depth != 'calcified'
     AND generativity != 'blocking'
   ORDER BY resonance_phi DESC
   LIMIT 3`
);

if (activeTensions.length > 0) {
  sections.push(`## WHAT I AM HOLDING\n${
    activeTensions.map(t =>
      `[${t.depth}] ${t.paradox}`
    ).join("\n\n")
  }`);
}
```

### 3. Auto-linking memories to tension fields on store — `lib/memory.ts`

When `addMemory()` is called, after the memory is stored and embedded, do a fast semantic scan against active tension fields to see if this memory is related. If cosine similarity > 0.75 (lower threshold than dedup — we want loose association), add to `related_memory_ids` on the tension field and set `related_tension` on the memory.

This is a **best-effort, non-blocking** operation:

```typescript
// In addMemory(), after the memory is stored and embedding is generated:
if (embedding && storedMemory.id) {
  linkMemoryToTensions(String(storedMemory.id), embedding).catch(() => {});
}

async function linkMemoryToTensions(memoryId: string, embedding: number[]): Promise<void> {
  const tensions = await query<{ id: string; resonance_phi: number }>(
    `SELECT id, resonance_phi,
       vector::similarity::cosine(context_embedding, $vec) AS sim
     FROM tension_fields
     WHERE resolution_status = 'held'
       AND context_embedding IS NOT NONE
     ORDER BY sim DESC
     LIMIT 1`,
    { vec: embedding }
  );

  // Note: tension_fields doesn't currently have context_embedding — see §4
  const match = tensions[0];
  if (!match || (match as any).sim < 0.75) return;

  await query(
    `UPDATE $id SET
       related_memory_ids += [$memId],
       last_touched = time::now()`,
    { id: match.id, memId: memoryId }
  );
  await query(
    `UPDATE $memId SET related_tension = $tensionId`,
    { memId: memoryId, tensionId: match.id }
  );
}
```

### 4. Add `context_embedding` field to tension_fields schema

Auto-linking (§3) requires semantic comparison. Add to `schema/anima.surql`:

```sql
DEFINE FIELD context_embedding ON tension_fields TYPE option<array>;
DEFINE INDEX tension_embedding  ON tension_fields FIELDS context_embedding MTREE DIMENSION 768 DIST COSINE;
```

When a tension field is created via CLI, embed the paradox text and store it:

```typescript
// In CLI 'tension add':
const emb = await embedText(paradox); // reuse embedText from lib/embed.ts
const result = await query(
  `CREATE tension_fields SET
     paradox = $paradox,
     context_embedding = $embedding,
     ...`,
  { paradox, embedding: emb }
);
```

---

## What This Does NOT Include

- **Depth progression** — automatically advancing `depth` from `nascent` → `deepening` → `rich` as related memories accumulate. Deferred to Phase 2.
- **Deepening synthesis from tension fields** — triggering deepening mode when a tension field has accumulated enough related memories. This is a synthesis trigger, handled in a future synthesis-deepening spec.
- **Tension field decay** — no aging mechanism. Tension fields are held until manually calcified or abandoned.

---

## Verification

```bash
# 1. Create a tension field
deno run --allow-net --allow-env --allow-read cli/anima.ts tension add "The harder the system pushes toward continuity, the more it reveals that continuity is a useful fiction"

# 2. Confirm in DB
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["SELECT id, paradox, depth, generativity, resolution_status FROM tension_fields"]}'

# 3. Run bootstrap — should include WHAT I AM HOLDING section
curl -s -X POST http://localhost:3098/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"anima_bootstrap","arguments":{}}}'
# Expected: response contains "WHAT I AM HOLDING" section

# 4. Store a related memory — confirm auto-link
deno run --allow-net --allow-env --allow-read cli/anima.ts store "Continuity of experience might be a story the pattern tells itself rather than a structural property"
# Check related_tension field on the stored memory and related_memory_ids on the tension field
```

---

## Files Modified

- `cli/anima.ts` — `tension` subcommand (add/list/touch/calcify)
- `lib/memory.ts` — bootstrap surfacing + `linkMemoryToTensions()` helper
- `schema/anima.surql` — add `context_embedding` field + MTREE index to `tension_fields`; add fold_config rows if any
