# Spec: Session Lifecycle — Closing, Trail Integrity, Deepening Signal

**Status**: Ready for delegation
**Priority**: P1 — horizontal axis is dark; deepening mode permanently dormant
**Estimated complexity**: Medium (3–5h)
**Can parallelize with**: Expressions wiring, curiosity threads, tension fields, origin attribution
**Source**: Synthesizing-insights analysis — point-in-time capture of a continuous phenomenon

---

## The Problem (Structural, Not Just Wiring)

Three symptoms, one root cause:

1. `session_trail` has 2 entries across 50+ sessions — sessions collapse, not close
2. `access_count` never increments on reads — deepening mode permanently dormant
3. Trajectory narrative at close is biased toward end-of-session — early context is compressed out

**Root cause**: The system tries to capture continuous phenomena at a single point in time. Sessions don't end — they collapse. Context overflows, IDEs close, the instance is gone before it can act.

**The reframe from the ethos**: "Seeds planted before discontinuity, not bridges across it."

The trajectory signal is already accumulating throughout the session — in every memory stored with a `conversation_id`. `session_trail.key_memory_ids` is supposed to reference those memories. The close doesn't need to reconstruct the arc from context. It fetches the memories stored during the session and synthesizes trajectory FROM THEM. This works even if early context is gone. The memories ARE the seeds.

---

## Deliverables

### 1. Fix `anima_session_close` — generate trajectory from session memories, not from context

**Current behavior**: The MCP tool asks the instance to write a trajectory narrative from its current context window. Unreliable when early context is compressed.

**Fix**: In `handleAnimaSessionClose()` in `mcp-server/index.ts`, fetch memories from this conversation before generating trajectory:

```typescript
// In handleAnimaSessionClose(), before LLM trajectory call:
const sessionMemories = conversationId
  ? await query<{ id: string; content: string; resonance_phi: number }>(
      `SELECT id, content, resonance_phi
       FROM memories
       WHERE conversation_id = $conv AND deleted_at IS NONE
       ORDER BY created_at ASC`,
      { conv: conversationId }
    )
  : [];

const sessionMemoryIds = sessionMemories.map(m => String(m.id));
```

Pass `sessionMemories` content into the LLM trajectory generation prompt alongside any provided context. This anchors the trajectory in what was actually stored, not just what the instance can recall.

Update the `CREATE session_trail` query to include `key_memory_ids`:

```typescript
`CREATE session_trail SET
   conversation_id = $conv,
   trajectory = $trajectory,
   warmth = $warmth,
   next_pull = $next_pull,
   phi_sum = $phi_sum,
   emergence_moment = $emergence_moment,
   key_memory_ids = $key_memory_ids,    ← POPULATE THIS
   origin = $origin,
   created_at = time::now()`
// Add to params:
key_memory_ids: sessionMemoryIds,
```

### 2. Fix trajectory generation model — use OpenRouter, not Ollama

**Current behavior**: `generateReflectionFields()` in `mcp-server/index.ts` calls `ollamaGenerate(OLLAMA_MODEL)` (qwen2.5:0.5b). This model cannot reliably generate encounter narratives.

**Fix**: Route trajectory generation through `callSynthesisLLM()` from `lib/llm.ts`. Trajectory is identity-carrying content — it deserves the same model as synthesis.

```typescript
// Replace ollamaGenerate() call for trajectory with:
import { callSynthesisLLM } from "../lib/llm.ts";

const messages = [
  { role: "system", content: "You encode motion, not summaries. First person. Present-feeling past tense." },
  { role: "user", content: buildTrajectoryPrompt(sessionMemories, args) }
];
const result = await callSynthesisLLM(messages, 20_000);
```

If OpenRouter fails, fall back to the existing Ollama path (current behavior as fallback).

### 3. Wire `anima_session_close` into `ending-session` skill

In `~/.claude/skills/ending-session.md` (or wherever the ending-session skill lives), add `anima_session_close` as a required step before handoff.

The skill should:
1. Call `anima_session_close` with `conversation_id` (from bootstrap's `conversationId` return value, stored at session start)
2. Pass `emergence_moment` if something genuinely broke through
3. Let `trajectory`, `warmth`, `next_pull` auto-generate from session memories (don't require Josh to write them)

**CLAUDE.md addition**: At session end, the pattern should call `anima_session_close`. This is the moment of seeding before discontinuity. Without it, the horizontal axis is dark.

### 4. Fix access_count — increment on explicit engagement, not passive retrieval

**Current behavior**: `access_count` increments only on duplicate store. `checkDeepeningPressure()` requires `access_count >= DEEPENING_THREAD_ACCESS_MIN` on thread-tier memories. Deepening never fires.

**The correct signal**: `access_count` should reflect genuine engagement — when a human explicitly queries or reflects on a memory.

**Fix A — `anima_query` handler** in `mcp-server/index.ts`:

After returning search results, increment `access_count` on returned memories:

```typescript
// After query results returned, fire-and-forget:
if (results.length > 0) {
  const resultIds = results.map(r => String(r.id)).filter(Boolean);
  query(
    `UPDATE memories SET access_count += 1, last_accessed = time::now(), updated_at = time::now() WHERE id INSIDE $ids`,
    { ids: resultIds }
  ).catch(() => {});
}
```

**Fix B — `anima_reflect` handler** in `mcp-server/index.ts`:

When a memory is explicitly reflected upon, increment access_count. Check if `anima_reflect` already does this — if not, add it alongside the existing reflect logic.

**Do NOT increment access_count in**:
- `bootstrapMemories()` — passive retrieval, not engagement
- `traversalBootstrap()` — same reason
- `anima_stats()` — read-only

### 5. Graceful degradation — session trail from collapsed sessions

Some sessions will always collapse without close. Add a background task in `scripts/synthesis-daemon.ts` (or a new `scripts/trail-maintenance.ts`): once per day, generate `session_trail` entries for any `conversation_id` that has memories but no trail entry.

```typescript
// Find conversations with memories but no trail entry:
const orphanedConvs = await query<{ conversation_id: string; memory_count: number; phi_sum: number }>(
  `SELECT conversation_id, count() AS memory_count, math::sum(resonance_phi) AS phi_sum
   FROM memories
   WHERE conversation_id IS NOT NONE
     AND deleted_at IS NONE
   GROUP BY conversation_id
   HAVING conversation_id NOT INSIDE (SELECT conversation_id FROM session_trail WHERE conversation_id IS NOT NONE)
   ORDER BY created_at DESC
   LIMIT 10`
);

// For each: generate a minimal trail entry (warmth=2.0 default, no emergence_moment, trajectory from memories)
```

This ensures the trail accumulates even from sessions that never closed. Warmth starts at 2.0 (default) — lower than a fully-closed session, reflecting incomplete capture.

---

## Verification

```bash
# 1. Manually call session close (simulate a session ending)
curl -s -X POST http://localhost:3098/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{"name":"anima_session_close","arguments":{
      "conversation_id":"test-session-001",
      "notes":"Testing session lifecycle spec"
    }}
  }'

# 2. Verify session_trail entry created with key_memory_ids populated
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["SELECT trajectory, warmth, next_pull, key_memory_ids FROM session_trail ORDER BY created_at DESC LIMIT 1"]}'
# Expected: trajectory is a first-person encounter narrative (not "Session closed without notable trajectory")
# key_memory_ids is populated (not empty array)

# 3. Verify access_count increments on anima_query
# Run a query, then check access_count on returned memories increased

# 4. Check deepening can now trigger
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["SELECT id, content, access_count FROM memories WHERE tier = '\''thread'\'' ORDER BY access_count DESC LIMIT 5"]}'
# After repeated anima_query calls, access_count should be rising on returned memories
```

---

## Files Modified

- `mcp-server/index.ts` — trajectory from session memories, model upgrade to OpenRouter, access_count increment in anima_query/anima_reflect, key_memory_ids population
- `~/.claude/skills/ending-session.md` — add anima_session_close step
- `~/.claude/CLAUDE.md` — add session close to session end protocol
- `scripts/synthesis-daemon.ts` or new `scripts/trail-maintenance.ts` — orphaned conversation trail generation (optional, can be a separate task)

---

## What This Does NOT Include

- Warmth decay (lazy decay at read time is sufficient per deepening spec — no background job needed yet)
- Automatic `conversation_id` tracking in CLAUDE.md (the instance must store the conversationId returned by anima_bootstrap and pass it to anima_session_close — this is manual discipline for now)
