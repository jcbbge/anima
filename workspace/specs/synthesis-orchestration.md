# Spec: Synthesis Orchestration — Trigger Domain Separation

**Status**: Ready for delegation
**Priority**: P0 — transaction conflicts are causing fold failures; phi watermark gets stuck
**Estimated complexity**: Small (1–2h — no new code, just domain reassignment)
**Must run before**: traversal-bootstrap-enable.md
**Source**: Systems analysis — two cognitive operations collapsed into one function

---

## The Problem

Two daemons call `checkAndSynthesize()` simultaneously with no cross-process coordination:

- `synthesis-worker/index.ts` — LIVE query on `memories` table → fires on every new active-tier memory → calls `checkAndSynthesize()` → checks phi, conflict, cluster, deepening
- `scripts/synthesis-daemon.ts` — LIVE query on `fold_config` → fires when phi watermark is set → calls `checkAndSynthesize()` → also checks phi

When a new memory trips phi threshold:
1. `phi_watermark` DB event fires → sets `fold_config.pending_synthesis = "pending:Xf"`
2. synthesis-daemon sees watermark → calls `checkAndSynthesize()` → runs phi fold
3. synthesis-worker LIVE query sees new memory → ALSO calls `checkAndSynthesize()` → ALSO tries phi fold
4. Transaction conflict — both write to `fold_log`, `memories` simultaneously
5. Daemon catches conflict error → sets watermark to `error:...` → 30s backoff → resets to `idle`
6. But phi is still high → next memory trips threshold again → repeat

The `pending:19f` stuck watermark is a symptom of this loop.

---

## The Reframe

These are not competing processes. They are two distinct cognitive operations that should never share trigger domains:

| Process | Cognitive type | Triggers it should own |
|---|---|---|
| `synthesis-worker` | **Reactive** — immune response to novelty | `semantic_conflict`, `cluster`, `deepening` |
| `synthesis-daemon` | **Accumulative** — sleep consolidation | `phi_threshold` |

Reactive synthesis fires while the pattern is present and engaged. Accumulative synthesis fires from built-up pressure, often between sessions. They produce different outputs, operate on different timescales, and should be entirely independent.

---

## Deliverables

### 1. Add `skipPhi` option to `checkAndSynthesize()` — `lib/synthesize.ts`

```typescript
export async function checkAndSynthesize(
  newMemoryId: string,
  newEmbedding: number[] | null,
  conversationId?: string,
  options?: { skipPhi?: boolean },  // ← ADD
): Promise<void> {
  // ...existing backpressure guard...

  const [phiResult, clusterResult, deepeningResult] = await Promise.all([
    options?.skipPhi
      ? Promise.resolve({ triggered: false, total: 0 })  // ← SKIP phi check
      : checkPhiPressure(),
    newEmbedding ? checkClusterPressure(newEmbedding) : Promise.resolve({ triggered: false, count: 0 }),
    newEmbedding ? checkDeepeningPressure(newEmbedding) : Promise.resolve<DeepeningResult>({ triggered: false }),
  ]);
  // ...rest unchanged
```

### 2. Pass `skipPhi: true` from synthesis-worker — `synthesis-worker/index.ts`

Find the `checkAndSynthesize()` call in the new memory handler and add the option:

```typescript
// In the LIVE query new memory handler:
await checkAndSynthesize(idStr, embeddingVec, conversation_id, { skipPhi: true });
```

The synthesis-worker now handles: `semantic_conflict`, `cluster`, `deepening` — never `phi_threshold`.

### 3. Remove redundant phi check from synthesis-daemon — `scripts/synthesis-daemon.ts`

The synthesis-daemon is already gated by the phi watermark — it only runs when `fold_config.pending_synthesis` starts with `"pending:"`. That IS the phi check. The `checkAndSynthesize()` call inside `dispatchFold()` then does a redundant phi pressure check.

**Option A (minimal change):** Pass `{ skipPhi: false }` (default) — daemon keeps phi check as a safety assertion. Acceptable since daemon only fires on watermark.

**Option B (cleaner):** In `dispatchFold()`, call `performFold()` directly with `phi_threshold` trigger and collect active memories inline, bypassing `checkAndSynthesize()` entirely. The watermark IS the phi check — no need to re-verify.

**Recommendation: Option B.** The daemon owns phi. It should call `performFold()` directly, not route through `checkAndSynthesize()` which was designed for reactive in-session use.

```typescript
// In synthesis-daemon.ts dispatchFold(), replace checkAndSynthesize() call with:
const memories = await query<Memory>(
  `SELECT id, content, resonance_phi, confidence, tier, tags, created_at, last_accessed
   FROM memories
   WHERE tier = 'active' AND deleted_at IS NONE
   AND (last_folded_at IS NONE OR last_folded_at < <datetime>$cutoff)
   ORDER BY resonance_phi DESC`,
  { cutoff: new Date(Date.now() - RECENTLY_FOLDED_WINDOW_MS).toISOString() }
);

if (memories.length >= FOLD_MIN_MEMORIES) {
  await performFold({ trigger: "phi_threshold", memories, conversationId: undefined });
}
```

Import `performFold`, `FOLD_MIN_MEMORIES`, `RECENTLY_FOLDED_WINDOW_MS` from `../lib/synthesize.ts`.

---

## Verification

```bash
# 1. Store several memories to trip phi threshold
for i in 1 2 3 4 5; do
  deno run --allow-net --allow-env --allow-read cli/anima.ts store "Test memory $i for synthesis orchestration verification" --phi 3.5
  sleep 2
done

# 2. Watch daemon log — should see ONE fold, no transaction conflicts
tail -20 /tmp/synthesis-daemon.error.log

# 3. Watch worker log — should see conflict/cluster checks only, no phi
tail -20 ~/Library/Logs/anima-synthesis.log

# 4. Confirm fold_config.pending_synthesis returns to 'idle'
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["SELECT `value` FROM fold_config WHERE key = '\''pending_synthesis'\''"]}'
# Expected: "idle"
```

---

## Files Modified

- `lib/synthesize.ts` — add `options?: { skipPhi?: boolean }` to `checkAndSynthesize()`
- `synthesis-worker/index.ts` — pass `{ skipPhi: true }` to all `checkAndSynthesize()` calls
- `scripts/synthesis-daemon.ts` — replace `checkAndSynthesize()` call with direct `performFold()` (Option B)

---

## What This Does NOT Change

- `phi_watermark` DB event still fires and sets the watermark — unchanged
- synthesis-worker still runs all three reactive checks (conflict, cluster, deepening) — unchanged
- `checkAndSynthesize()` interface is backward-compatible — `options` is optional
- No plist changes, no restart required after deploy (both daemons will pick up new code on next launchd restart)
