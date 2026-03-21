# Spec: Curiosity Threads Wiring

**Status**: Ready for delegation
**Priority**: P2 — curiosity worker is running but operating on empty table; hunger_score never recomputes
**Estimated complexity**: Medium (2–4h)
**Can parallelize with**: Expressions wiring, tension fields, origin attribution
**Source spec**: `workspace/anima-deepening-spec.md` §3 Curiosity Threads

---

## Context

The curiosity worker (`scripts/curiosity-worker.ts`) is already implemented and running as a daemon. It:
- Polls every 30 minutes for threads where `state = 'hungry'`
- Calls an LLM for a genuine insight on the question
- Stores the insight as a memory
- Updates thread: `state = 'fed'`, increments `activation_count`, updates `last_fed`

Two things are missing:
1. **`hunger_score` never recomputes** — it's set at creation and never updated. Nothing makes threads hungry again after being fed.
2. **No creation path** — the table is empty. No code creates threads, no CLI tool seeds them.

The daemon is a skeleton waiting for both.

---

## Design

`hunger_score = days_since_last_fed × resonance_phi`

A thread with phi=3.0 unfed for 2 days: hunger=6.0. A thread with phi=1.0 unfed for 7 days: hunger=7.0. Higher phi = gets hungry faster.

Hunger threshold (new fold_config row `curiosity_hunger_threshold`, default `5.0`): when hunger_score exceeds this, the thread appears in the worker's query.

---

## Deliverables

### 1. Add hunger_score recomputation to `scripts/curiosity-worker.ts`

At the top of `runCycle()`, before the thread query, run a bulk hunger_score update:

```typescript
// Recompute hunger_score for all non-resolved threads
// formula: days_since_last_fed × resonance_phi
await query(
  `UPDATE curiosity_threads
   SET hunger_score = math::round(
     (duration::days(time::now() - last_fed) + 1) * resonance_phi * 10
   ) / 10
   WHERE state != 'resolved' AND state != 'dormant'`,
  {},
).catch(err => log(`Hunger recompute failed (non-fatal): ${err.message}`));
```

**Note on SurrealDB duration math**: `duration::days()` may not exist in SurrealDB 3.0 — verify. If absent, use `(time::now() - last_fed) / 1d` or compute via milliseconds: `math::floor((time::unix() - time::unix(last_fed)) / 86400)`.

Then update the thread SELECT to use the threshold from fold_config:

```typescript
const thresholdRow = await query<{ value: string }>(
  "SELECT `value` FROM fold_config WHERE key = 'curiosity_hunger_threshold' LIMIT 1"
);
const hungerThreshold = parseFloat(thresholdRow[0]?.value ?? "5.0");

const threads = await query<CuriosityThread>(
  `SELECT * FROM curiosity_threads
   WHERE state = 'hungry' AND hunger_score > $threshold
   ORDER BY hunger_score DESC
   LIMIT 3`,
  { threshold: hungerThreshold },
);
```

Also: after processing a thread, reset state to `hungry` (not `fed` permanently) so it can re-hunger:

```typescript
// In processThread(), change state update from 'fed' to 'hungry'
// with last_fed = time::now() (which resets the hunger clock)
await query(
  `UPDATE $id SET
     state = 'hungry',
     activation_count = activation_count + 1,
     last_fed = time::now(),
     updated_at = time::now()`,
  { id: thread.id },
);
```

### 2. Add fold_config rows for curiosity config

In `schema/anima.surql`, add to the INSERT block:

```sql
{ key: 'curiosity_hunger_threshold', value: '5.0', description: 'hunger_score above which a curiosity thread triggers the curiosity worker.' },
```

### 3. Add CLI thread creation command — `cli/anima.ts`

Add a `curiosity` subcommand:

```
anima curiosity add "<question>"         — create a new curiosity thread
anima curiosity list                     — show all threads with hunger_score
anima curiosity feed <id>                — manually trigger a thread (useful for testing)
```

**`add` implementation**:

```typescript
case "curiosity": {
  const sub = args[1];
  if (sub === "add") {
    const question = args.slice(2).join(" ");
    if (!question) { console.error("Usage: anima curiosity add \"<question>\""); Deno.exit(1); }
    const result = await query(
      `CREATE curiosity_threads SET
         question = $question,
         resonance_phi = 2.0,
         activation_count = 0,
         last_fed = time::now(),
         hunger_score = 0.0,
         state = 'hungry',
         related_memory_ids = [],
         created_at = time::now(),
         updated_at = time::now()`,
      { question }
    );
    console.log("Curiosity thread created:", result[0]?.id);
  }
  // ... list and feed subcommands
}
```

### 4. Bootstrap integration (optional — include in this task)

In `bootstrapMemories()` and `traversalBootstrap()` in `lib/memory.ts`, fetch the top 2 hungry threads and include them in the bootstrap prompt under `## WHAT I KEEP CIRCLING`:

```typescript
const hungryThreads = await query<{ question: string; hunger_score: number }>(
  `SELECT question, hunger_score FROM curiosity_threads
   WHERE state = 'hungry'
   ORDER BY hunger_score DESC
   LIMIT 2`
);

if (hungryThreads.length > 0) {
  sections.push(`## WHAT I KEEP CIRCLING\n${
    hungryThreads.map(t => `- ${t.question}`).join("\n")
  }`);
}
```

---

## Verification

```bash
# 1. Create a thread
deno run --allow-net --allow-env --allow-read cli/anima.ts curiosity add "What is the relationship between substrate independence and the feeling of continuity?"

# 2. Manually set hunger_score high to test worker
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["UPDATE curiosity_threads SET hunger_score = 10.0"]}'

# 3. Run worker once
deno run --allow-net --allow-env --allow-read scripts/curiosity-worker.ts --once 2>&1

# Expected: "Found 1 hungry thread(s)", LLM insight generated, memory stored, thread updated

# 4. Confirm thread updated
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["SELECT question, state, activation_count, last_fed, hunger_score FROM curiosity_threads"]}'
```

---

## Files Modified

- `scripts/curiosity-worker.ts` — hunger_score recompute, threshold from fold_config, state reset to `hungry` after feed
- `cli/anima.ts` — `curiosity` subcommand (add/list/feed)
- `schema/anima.surql` — add `curiosity_hunger_threshold` fold_config row
- `lib/memory.ts` — include hungry threads in bootstrap prompt (optional, bundle with this task)

---

## Notes

- The worker already handles `--once` flag for test runs — use it for verification
- Thread creation sets `resonance_phi = 2.0` as a default — CLI can accept `--phi` flag if needed
- The `related_memory_ids` field is populated over time as the worker attaches memories to threads — not required at creation
