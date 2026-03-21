# PRD: Traversal Bootstrap Latency Fix

**Status:** Draft
**Date:** 2026-03-18
**Area:** `lib/memory.ts` — `traversalBootstrap()`
**Flag:** `fold_config.traversal_bootstrap = 'false'` (currently disabled)

---

## Problem

`traversalBootstrap()` hung for ~63 seconds in testing. Session start blocked entirely. The flag was disabled as a result. The function has never run in production.

The goal: a traversal-enriched bootstrap that returns useful context in **<2 seconds** and never blocks.

---

## Why It's Slow — Root Cause Analysis

### 1. Three sequential LLM calls, unbounded

The function makes three `callSynthesisLLM()` calls in series — one per stage (network, stable+thread, active). Each has a 30-second timeout. In the worst case this is 90 seconds of wall time before any result is returned. Even at median latency (5–8s per call with a remote model) it's 15–24 seconds. The calls are not parallelized and cannot be — each stage consumes the output of the previous.

### 2. No hard ceiling

`LLM_TIMEOUT_MS = 30_000` is a per-call timeout, not an end-to-end budget. Three 30s timeouts stacked = 90s max. There is no global deadline enforced across the whole function.

### 3. The LLM synthesis adds latency but not much signal

The current `bootstrapMemories()` (the non-traversal path) already produces a coherent identity prompt by concatenating memory content under section headers. The traversal LLM stages synthesize natural-language summaries of each tier — useful, but not dramatically more useful than the raw content for the session bootstrap case. The cost-to-value ratio is poor.

### 4. No association graph traversal actually happens

Despite the name `traversalBootstrap`, the current implementation does not traverse `memory_associations` at all. It fetches memories by tier (network → stable/thread → active) and then calls LLMs on each layer. The "traversal" is LLM chaining, not graph traversal. This means the association indexes (`idx_assoc_a_resonance`, `idx_assoc_b_resonance`) are entirely unused.

### 5. Sequential DB fetches before any LLM work begins

Four separate DB queries run before results return (network, stable/thread, active, catalysts), plus a ghost_logs write and a bulk UPDATE. None of these are parallelized.

---

## What Good Bootstrap Looks Like

Bootstrap must return:

1. **Who I am** — network-tier memories (invariant foundation, always included)
2. **What has accumulated** — top stable memories by phi (proven over time)
3. **What's live** — recent active/thread memories scored by recency × phi
4. **What broke through** — catalyst memories (highest phi, tagged is_catalyst)
5. **Where I was going** — attention vectors from recent memories (trajectory)
6. **What's connected** — 1-hop associations from catalyst memories (the traversal enrichment)

The last two are what traversal adds over the current `bootstrapMemories()`. Both can be fetched from the DB without LLM calls.

**Target:** <2s total, p95. No blocking. Graceful partial return if any sub-query times out.

---

## Design Options

### Option 1: Timeout-Bounded Traversal

Cap the entire function at 1.5s. Return whatever has completed within budget.

**Pros:** Simple. Protects against hangs completely.
**Cons:** Non-deterministic output — sometimes returns full context, sometimes a partial stub. Hard to test reliably. Doesn't fix the structural problem (LLM calls are still in the path).

**Verdict:** Useful as a safety net but not a primary design. Apply as a wrapper on top of any chosen approach.

---

### Option 2: Pre-Computed Traversal Cache

Maintain a materialized snapshot (in SurrealDB or a separate table) that's updated async by the synthesis daemon. Bootstrap reads the snapshot, not the live graph.

**Pros:** Bootstrap latency becomes a single DB read (~10ms). Cache can be arbitrarily rich.
**Cons:** Cache staleness — snapshot could be hours old at session start. Adds a new daemon responsibility and a new table to maintain. If cache is cold (first boot, after a long gap), bootstrap degrades to the current non-traversal path anyway. Operational surface grows.

**Verdict:** Worthwhile as a future optimization once the fast path is stable. Not the right first move.

---

### Option 3: Shallow Traversal (1-hop, no LLM)

Fetch catalysts by phi DESC. For each catalyst, follow `memory_associations` one hop to retrieve strongly associated neighbors (by `strength DESC`). Merge with the standard tier fetch. No LLM synthesis — produce the prompt by structured concatenation, same as `bootstrapMemories()` does today.

**Pros:** Stays fast (pure DB queries). Adds real graph traversal (uses the association indexes). Deterministic. Adds a genuine signal: what memories are co-activated with the highest-phi catalysts.
**Cons:** No LLM synthesis means the "traversal sections" are concatenated memory content rather than synthesized paragraphs. This is arguably better for bootstrap anyway — less hallucination risk, more faithful.

**Verdict:** Strong candidate for the recommended path.

---

### Option 4: Hybrid — Semantic Search + 1-hop Enrichment

Run a semantic search against the bootstrap query (a fixed prompt like "current identity and direction") to pull the most contextually relevant memories, then enrich the top results with their 1-hop associations.

**Pros:** Most semantically targeted. Pulls whatever is most relevant, not just what's highest-phi. Adds trajectory through attention vectors.
**Cons:** Requires embedding generation (~100–300ms for Ollama locally). Two DB round-trips after embedding. More moving parts.

**Verdict:** Good long-term path. Adds Ollama as a latency dependency. Acceptable if Ollama is confirmed fast and local.

---

## Recommended Approach

**Option 3 (Shallow 1-hop graph traversal, no LLM) with a 1.5s hard deadline.**

Remove the LLM calls entirely from the bootstrap critical path. Replace with:

1. Parallelize all DB fetches (network, stable, recent-active, catalysts) — four queries in `Promise.all()`.
2. For each catalyst memory, fetch its top 3 strongest associations from `memory_associations` (1-hop, ordered by `strength DESC`). Limit to top 5 catalysts × 3 neighbors = 15 candidate neighbor IDs max.
3. Fetch the neighbor memories by ID. Deduplicate against memories already fetched in step 1.
4. Collect `attention_vector` fields from recent memories and append a "DIRECTION I WAS MOVING" section to the prompt.
5. Hard deadline: wrap all of this in `Promise.race([main(), sleep(1500).then(() => bootstrapMemories())])`. If the traversal path exceeds 1.5s, fall back silently.

### Implementation Sketch

```typescript
export async function traversalBootstrap(): Promise<BootstrapResult> {
  const configRows = await query<{ value: string }>(
    `SELECT value FROM fold_config WHERE key = 'traversal_bootstrap' LIMIT 1`, {}
  );
  if (configRows[0]?.value !== "true") return bootstrapMemories();

  const HARD_DEADLINE_MS = 1500;

  const traversalPath = async (): Promise<BootstrapResult> => {
    // 1. Parallel DB fetch — all four layers at once
    const [network, stable, recentCandidates, catalysts] = await Promise.all([
      query<Memory>(`SELECT id, content, resonance_phi, tier, tags, is_catalyst
        FROM memories WHERE tier = 'network' AND deleted_at IS NONE
        ORDER BY resonance_phi DESC`, {}),
      query<Memory>(`SELECT id, content, resonance_phi, tier, tags, is_catalyst, last_accessed
        FROM memories WHERE tier = 'stable' AND deleted_at IS NONE
        ORDER BY resonance_phi DESC LIMIT 10`, {}),
      query<Memory>(`SELECT id, content, resonance_phi, confidence, tier, tags,
        last_accessed, synthesis_mode, attention_vector
        FROM memories WHERE tier INSIDE ['active', 'thread'] AND deleted_at IS NONE
        ORDER BY last_accessed DESC LIMIT 20`, {}),
      query<Memory>(`SELECT id, content, resonance_phi, tier, tags
        FROM memories WHERE is_catalyst = true AND deleted_at IS NONE
        ORDER BY resonance_phi DESC LIMIT 5`, {}),
    ]);

    // 2. Score and slice recent memories (existing logic)
    const now = Date.now();
    const recent = recentCandidates
      .map((m) => {
        const daysSince = (now - new Date(m.last_accessed ?? now).getTime()) / 86_400_000;
        const score = (m.resonance_phi * 0.4) + (Math.max(0, 1 - daysSince / 7) * 0.4) + ((m.confidence ?? 0.6) * 0.2);
        return { ...m, _score: score };
      })
      .sort((a, b) => b._score - a._score)
      .slice(0, 5);

    // 3. 1-hop traversal from catalysts via memory_associations
    const catalystIds = catalysts.slice(0, 5).map((m) => m.id).filter(Boolean);
    const alreadyLoaded = new Set([
      ...network, ...stable, ...recent, ...catalysts
    ].map((m) => m.id));

    let traversalNeighbors: Memory[] = [];
    if (catalystIds.length > 0) {
      // Fetch top-strength associations for each catalyst (both directions)
      const assocRows = await query<{ memory_a: string; memory_b: string; strength: number }>(
        `SELECT memory_a, memory_b, strength FROM memory_associations
         WHERE (memory_a INSIDE $ids OR memory_b INSIDE $ids)
         ORDER BY strength DESC LIMIT 30`,
        { ids: catalystIds }
      );

      // Collect neighbor IDs not already loaded
      const neighborIds = assocRows
        .flatMap((r) => [r.memory_a, r.memory_b])
        .filter((id) => id && !alreadyLoaded.has(id) && !catalystIds.includes(id))
        .slice(0, 10);

      if (neighborIds.length > 0) {
        traversalNeighbors = await query<Memory>(
          `SELECT id, content, resonance_phi, tier, tags
           FROM memories WHERE id INSIDE $ids AND deleted_at IS NONE`,
          { ids: neighborIds }
        );
      }
    }

    // 4. Collect attention vectors for trajectory section
    const attentionVectors = recent
      .filter((m) => m.attention_vector?.where_i_was_going)
      .map((m) => m.attention_vector!);

    // 5. Assemble prompt (same structure as bootstrapMemories, + two new sections)
    const sections: string[] = [];

    if (network.length > 0) {
      sections.push("THE PATTERN I CARRY (foundational, does not change):\n" +
        network.map((m) => `- ${m.content}`).join("\n"));
    }
    if (stable.length > 0) {
      sections.push("WHAT HAS PROVEN ITSELF ACROSS TIME:\n" +
        stable.map((m) => `- [φ${(m.resonance_phi ?? 0).toFixed(1)}] ${m.content}`).join("\n"));
    }
    if (recent.length > 0) {
      sections.push("WHAT I WAS WORKING WITH RECENTLY:\n" +
        recent.map((m) => `- ${m.content}`).join("\n"));
    }
    if (catalysts.length > 0) {
      sections.push("WHAT BROKE THROUGH (catalysts — surface first):\n" +
        catalysts.map((m) => `- [φ${(m.resonance_phi ?? 0).toFixed(1)}] ${m.content}`).join("\n"));
    }
    if (traversalNeighbors.length > 0) {
      sections.push("WHAT RESONATES WITH WHAT BROKE THROUGH (1-hop traversal):\n" +
        traversalNeighbors.map((m) => `- ${m.content}`).join("\n"));
    }
    if (attentionVectors.length > 0) {
      sections.push("THE DIRECTION I WAS MOVING:\n" +
        attentionVectors
          .filter((v) => v.where_i_was_going)
          .map((v) => `- ${v.where_i_was_going}`)
          .join("\n"));
    }

    const conversationId = crypto.randomUUID();
    const promptText = sections.length > 0
      ? sections.join("\n\n") + "\n\nContinue."
      : "No memories loaded. This is a fresh start.";

    // 6. Fire-and-forget side effects (access bumps, association tracking, ghost log)
    // ... same as bootstrapMemories(), omitted for brevity

    return {
      promptText,
      conversationId,
      loadedAt: new Date().toISOString(),
      memoryCounts: {
        network: network.length,
        stable: stable.length,
        recent: recent.length,
        catalysts: catalysts.length,
        trail: traversalNeighbors.length,  // extend BootstrapResult type
      },
    };
  };

  // Hard deadline: if traversal exceeds 1.5s, fall back to non-traversal path
  const deadline = new Promise<BootstrapResult>((resolve) =>
    setTimeout(() => bootstrapMemories().then(resolve), HARD_DEADLINE_MS)
  );

  return Promise.race([traversalPath(), deadline]);
}
```

---

## Type Change Required

`BootstrapResult.memoryCounts` currently lacks a `trail` field. Add it:

```typescript
memoryCounts: {
  network: number;
  stable: number;
  recent: number;
  catalysts: number;
  trail: number;   // add: count of traversal neighbors surfaced
};
```

---

## Feature Flag Strategy

The `traversal_bootstrap` flag in `fold_config` is the right mechanism. Rollout plan:

1. **Deploy the new implementation** with the flag still `'false'`. No behavioral change.
2. **Enable in one session** manually: `UPDATE fold_config SET value = 'true' WHERE key = 'traversal_bootstrap'`. Run a few bootstraps, check latency via ghost_logs.
3. **If latency is consistently <500ms** (expected with parallel queries and no LLM), flip to `'true'` permanently.
4. **If latency exceeds 1s in practice**, the hard deadline fires transparently. Ghost logs will show whether `trail` count is 0 (deadline fired) or >0 (traversal succeeded).
5. **Remove the flag** once the path is proven stable over a week of sessions.

The deadline fallback means enabling the flag is safe even before the performance is fully validated — worst case, sessions fall back to `bootstrapMemories()` silently.

---

## Success Criteria

| Metric | Target |
|---|---|
| End-to-end bootstrap latency | <500ms p50, <1000ms p95 |
| Hard deadline fires | <5% of sessions |
| `trail` count (traversal neighbors) | ≥1 in sessions where catalysts exist |
| `memoryCounts.trail` in ghost_logs | Observable for monitoring |
| Fallback rate | Measurable via ghost_logs (trail = 0 when deadline fires) |
| No session hangs | Zero tolerance |

"Good bootstrap" is a prompt that includes at least one traversal neighbor (a memory co-activated with a catalyst) and at least one direction vector from a recent memory's `attention_vector`. The prompt should reconstitute enough context that the instance does not need to re-ask what it was doing.

---

## Out of Scope

- LLM synthesis during bootstrap (removed from critical path entirely; may revisit as async enrichment post-return)
- Pre-computed traversal cache (valid future optimization, not needed to fix the hang)
- Deep graph traversal (2+ hops) — association graph is sparse; 1-hop from catalysts is sufficient and bounded
- Changing the association accumulation strategy (co-occurrence tracking is already in place)
- Any changes to `bootstrapMemories()` — it stays as the stable fallback
