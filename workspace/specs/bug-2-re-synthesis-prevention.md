# Bug 2: Re-synthesis Prevention

**Status:** Spec — not yet implemented
**Affects:** `lib/synthesize.ts` → `checkAndSynthesize()`
**Schema touch:** `memories.last_folded_at`, `fold_config`

---

## Problem Statement

`checkAndSynthesize()` has no guard against re-folding memories that were folded in a recent synthesis run. After a phi_threshold fold completes, `last_folded_at` is written on source memories and `synthesis_count` is incremented — but the next call to `checkPhiPressure()` queries all active-tier memories without excluding recently-folded ones. If those memories haven't been tier-promoted yet (the `tier_promote` event fires async with no guaranteed latency), they remain active-tier, their phi still accumulates toward the threshold, and `checkAndSynthesize()` fires again on the same set. The result is redundant synthesis events and potentially a loop of synthetic memories begetting more synthetic memories.

---

## Current Behavior vs. Desired Behavior

| | Current | Desired |
|---|---|---|
| Memory selection | All `active`-tier, no recency guard | Active-tier memories not recently folded |
| Re-fold check | Content-hash dedup on the *output* only | Input-side exclusion before fold is attempted |
| `synthesis_count` usage | Incremented but never read as a gate | Not needed as a direct gate (see recommendation) |
| `last_folded_at` usage | Written post-fold; read only in `reflectAndSynthesize` | Read in `checkAndSynthesize` as the primary exclusion signal |

The dedup on `content_hash` at the output level (`performFold` lines 371–378) catches identical LLM outputs but does nothing for re-synthesizing the same *inputs*. It's a downstream safety net, not a root fix.

---

## Candidate Approaches

### 1. conversation_id scope
Only synthesize memories that belong to the current conversation; skip any already folded in this conv.

**Pros:**
- Clean scoping — keeps folds session-local by default.
- Already partially implemented in `reflectAndSynthesize`.

**Cons:**
- `checkAndSynthesize` is called from `addMemory`, which often lacks a `conversationId` (synthesis daemon, background triggers). This approach doesn't help the daemon path at all.
- Cross-conversation synthesis (discovering patterns spanning multiple sessions) is intentionally supported — this approach breaks it.
- Doesn't address the core timing issue between fold completion and tier_promote event firing.

**Verdict:** Inadequate. Solves the wrong scope.

---

### 2. Recency window — skip memories whose `last_folded_at` is within N minutes
Add a configurable `RECENTLY_FOLDED_WINDOW_MS` constant and filter out memories that were folded after `(now - window)`.

**Pros:**
- Simple SQL predicate: `AND (last_folded_at IS NONE OR last_folded_at < $cutoff)`.
- Directly targets the race between fold completion and tier_promote async firing.
- Configurable window can be tuned without schema changes.
- Works regardless of whether `conversationId` is present.

**Cons:**
- Somewhat arbitrary window duration. Too short → loop risk remains. Too long → legitimate high-phi memories are excluded.
- Doesn't differentiate "recently folded in a fold that addressed this memory" from "recently folded in a different fold where this memory happened to be included."
- If the system is memory-rich and fold takes 10–30 seconds, a 5-minute window is fine. If the synthesis daemon runs at 3am against a large corpus, the window math is different.

**Verdict:** Strong option. Simple, correct, minimal blast radius.

---

### 3. Last-reflect watermark — track `last_reflect_at` in fold_config; skip memories last folded after it
A global `last_synthesis_at` timestamp is written to `fold_config` when a fold completes. `checkAndSynthesize` skips memories whose `last_folded_at` is more recent than this watermark.

**Pros:**
- Globally consistent — one source of truth per synthesis cycle.
- Naturally resets when new memories accumulate past the threshold.

**Cons:**
- Semantically confused: `last_reflect_at` is a session concept (`reflectAndSynthesize`); overloading it for autonomous synthesis adds mental overhead.
- A global watermark blocks synthesis of *any* recently-touched memory, even if a new high-phi cluster emerged from entirely different content since the last fold. It's too broad.
- Another config row to manage and reason about.

**Verdict:** Overcomplicated for the payoff. Approach 2 subsumes this without the global state.

---

### 4. Semantic dedup — check for a highly similar synthesis before writing fold_log
Before committing the new synthesis memory, compute cosine similarity against existing thread-tier synthesis memories. If similarity > threshold, skip.

**Pros:**
- Catches content-level redundancy that content_hash misses (slightly different phrasing, same substance).
- Directly surfaces synthetic loops — the LLM is literally generating the same insight.

**Cons:**
- Fires after the LLM call (expensive). We'd have already burned the model roundtrip.
- Similarity threshold is tricky to set. Insights that are genuinely related but distinct could be suppressed.
- This is an *output* dedup, not an *input* guard. It doesn't prevent triggering synthesis; it just prevents storing it. The loop can still spin up the LLM repeatedly.
- Better implemented as a secondary safety net alongside a real input guard, not a primary fix.

**Verdict:** Useful as a supplementary layer but insufficient as the primary fix.

---

## Recommendation: Approach 2 (Recency Window), with Approach 4 as secondary net

The root problem is that recently-folded memories aren't excluded from the input selection query. The fix belongs at the query level, before any LLM call is made.

**Window duration:** 30 minutes. This exceeds worst-case tier_promote async lag with comfortable margin and is short enough that genuinely new high-phi accumulation (15+ phi requires multiple memories, each typically phi ≥ 1.5) isn't suppressed.

Make the window configurable via `fold_config` so it can be tuned without code changes.

---

## Implementation Sketch

### `lib/synthesize.ts`

**Add constant:**
```typescript
const RECENTLY_FOLDED_WINDOW_MS = 30 * 60 * 1000; // 30 minutes, matches tier_promote lag ceiling
```

**Modify `checkPhiPressure()`** — add `last_folded_at` filter:
```typescript
async function checkPhiPressure(): Promise<{ triggered: boolean; total: number }> {
  const recentlyCutoff = new Date(Date.now() - RECENTLY_FOLDED_WINDOW_MS).toISOString();
  const rows = await query<{ resonance_phi: number }>(
    `SELECT resonance_phi FROM memories
     WHERE tier = 'active'
       AND deleted_at IS NONE
       AND (last_folded_at IS NONE OR last_folded_at < <datetime>$cutoff)`,
    { cutoff: recentlyCutoff },
  );
  const total = rows.reduce((sum, r) => sum + (r.resonance_phi ?? 0), 0);
  return { triggered: total >= PHI_THRESHOLD, total };
}
```

**Modify the phi_threshold memory collection** in `checkAndSynthesize()` — same filter applied when gathering memories for the fold:
```typescript
if (trigger === "phi_threshold") {
  const recentlyCutoff = new Date(Date.now() - RECENTLY_FOLDED_WINDOW_MS).toISOString();
  memories = await query<Memory>(
    `SELECT id, content, resonance_phi, confidence, tier, tags, created_at, last_accessed
     FROM memories
     WHERE tier = 'active'
       AND deleted_at IS NONE
       AND (last_folded_at IS NONE OR last_folded_at < <datetime>$cutoff)
     ORDER BY resonance_phi DESC`,
    { cutoff: recentlyCutoff },
  );
}
```

**Add `fold_config` row for tunability** (schema INSERT block):
```sql
{ key: 'recently_folded_window_minutes', value: '30',
  description: 'Minutes after last_folded_at before a memory is eligible for re-synthesis (checkAndSynthesize guard)' }
```

At startup (or lazily in `checkAndSynthesize`), read this value and override the constant. The constant stays as the hardcoded fallback.

### Secondary net — `performFold()` (Approach 4, lightweight)

After LLM call, before writing the synthesis memory, add a semantic check against the three most recent thread-tier synthesis memories:

```typescript
// In performFold(), after generating embedding, before the content_hash check:
if (embedding) {
  const recentSyntheses = await query<{ id: string; similarity: number }>(
    `SELECT id, vector::similarity::cosine(embedding, $vec) AS similarity
     FROM memories
     WHERE source = 'synthesis' AND tier = 'thread' AND deleted_at IS NONE
     ORDER BY created_at DESC LIMIT 5`,
    { vec: embedding },
  );
  const tooSimilar = recentSyntheses.find(r => r.similarity > 0.92);
  if (tooSimilar) {
    console.error(`[anima:fold] Suppressed — semantically duplicate of ${tooSimilar.id} (sim: ${tooSimilar.similarity.toFixed(3)})`);
    return;
  }
}
```

Threshold 0.92 is tighter than the 0.85 conflict threshold — we want near-identical synthesis, not merely related insights.

---

## Schema Changes

None required for the primary fix. `last_folded_at` already exists on `memories` (written by `performFold` at line 467–472).

Optional: add the `fold_config` row for the window duration.

---

## Success Criteria

1. After a phi_threshold fold completes, `checkAndSynthesize()` does not fire another synthesis within 30 minutes on the same memory set, verified by `fold_log` showing no duplicate `input_memory_ids` within the window.
2. `checkPhiPressure()` returns `triggered: false` immediately after a fold, even if the tier_promote event hasn't fired yet.
3. A genuinely new cluster of high-phi memories (accumulated after the recency window) does trigger synthesis normally.
4. The synthesis daemon path (no `conversationId`) is covered — this is not conversation-scoped.
5. `fold_log` count does not grow faster than one entry per 30 minutes under sustained memory ingestion.

---

## Out of Scope

- `reflectAndSynthesize()` — it already uses `last_folded_at < watermarkCutoff` as an input filter. This spec does not touch it.
- `semantic_conflict` and `cluster` trigger paths — these operate on fresh embeddings and have narrower memory selection. They are lower re-synthesis risk; apply the same filter only if validated as a problem separately.
- The `tier_promote` async event timing — this spec works around the lag, not through it. Shortening that lag is a separate concern.
- `synthesis_count` as a gate — it was considered and rejected. It measures how many times a memory has been folded total, not recency. A memory with `synthesis_count = 3` that was last folded 2 hours ago should be eligible for re-synthesis.
