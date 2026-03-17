# anima

Persistent AI memory infrastructure with cross-session continuity and autonomous synthesis. Three processes: CLI (direct DB access), MCP HTTP server (agent tooling on port 3098), and synthesis worker (autonomous daemon that folds memories when significance thresholds trigger).

## Stack

Deno · TypeScript · SurrealDB (ws://127.0.0.1:8002/rpc, ns=anima db=memory) · OpenRouter (LLM synthesis) · Ollama (embeddings, nomic-embed-text)

## How to Run

```bash
deno task mcp           # start MCP server — port 3098, launchd: com.jcbbge.anima-mcp.plist
deno task worker        # start synthesis daemon — launchd: anima.synthesis.plist
deno task worker:once   # single synthesis check then exit
deno task cli           # CLI — see subcommands below
deno task schema        # apply schema to SurrealDB (run after schema changes)
deno task report        # daily health report

# CLI subcommands
anima bootstrap         # ghost handshake — load continuity context
anima store "text"      # store memory (--phi N, --catalyst, --tags a,b)
anima query "text"      # semantic search (--limit N, --tiers active,thread)
anima reflect           # fold session — synthesize active memories
anima stats             # system state
anima daily             # health diagnostics
```

## Operating Loop

**Per-conversation (via MCP or CLI):**
1. `anima_bootstrap` → loads continuity context, returns promptText + conversationId
2. Work happens — agent stores memories via `anima_store` as significant things occur
3. `anima_session_close` → writes reflection to conversation_reflections table

**Autonomous synthesis (worker daemon):**
1. Worker polls active-tier memories continuously
2. Triggers fold when: phi_total > 15.0 OR semantic conflict detected (similarity > 0.85, divergent) OR cluster emergence (3+ related in 1hr)
3. Fold: queries active memories → LLM synthesis → stores result as thread-tier memory → logs to fold_log

**Schema changes:**
1. Edit `schema/anima.surql`
2. `deno task schema` to apply
3. Update affected types in `lib/memory.ts`

## Architecture

`lib/` is the core — `memory.ts` owns all DB operations, `synthesize.ts` owns fold logic, `db.ts` owns the SurrealDB connection singleton. Both `cli/anima.ts` and `mcp-server/index.ts` import from `lib/` directly — no HTTP between them. The synthesis worker runs independently, importing only what it needs from `lib/`.

## Mutable Surface

- `lib/` — all business logic lives here; safe to extend
- `mcp-server/index.ts` — add MCP tools here (TOOLS array)
- `cli/anima.ts` — add CLI subcommands here (switch statement)
- `synthesis-worker/index.ts` — add synthesis triggers here
- `schema/anima.surql` — schema definitions; run `deno task schema` after changes

## Frozen Surface

- `deno.lock` — do not edit manually
- `.env` — never commit; load via .env.example template
- `node_modules/` — managed by Deno

## Footguns

- **SurrealDB returns structured IDs, not strings** — use `normalizeId()` helper; raw ID access will fail silently
- **option<string> fields need `undefined` not `null`** — SurrealDB rejects null for optional fields (fixed in 54db2fb, will recur if you add fields)
- **launchd kills worker without `ProcessType=Background`** — efficiency mode terminates it; plist must have this set
- **.env loads at module init** — `loadEnv()` must be called before any `lib/` imports or env vars won't be set
- **OpenRouter header is `X-Title`** not `X-OpenRouter-Title` — wrong header silently breaks model routing

## Operating Model

Autonomy: full — all operations are local, SurrealDB is the source of truth
Flag to human when: LLM synthesis fails (check OPENROUTER_API_KEY), SurrealDB unreachable, worker crashes
Done looks like: `anima stats` shows memory counts increasing, fold_log has recent entries, `anima daily` shows no critical anomalies

## Intent

> Agent: could not derive the following. Surface to human only if relevant to your task.

- Priority between Layer 2 schema additions (attention_vector, tension_fields, curiosity_threads) and bug fixes: unknown — both in flight
- Whether session_trail tier should appear in the canonical tier list alongside active/thread/stable/network: unknown

## Agent Log

<!-- Append discoveries here. Do not edit previous entries. -->
<!-- Format: [date] [harness/agent] — [what you learned that wasn't here] -->
[2026-03-16] claude-code — Generated from deno.json + executables. Navigation layer live (session_trail, attention_vector). Next work: verify attention_vector writes via anima_reflect, then seed tension_fields. Open p0 todos: Bug 2 scoping (conv_id vs recency vs watermark approach), design_intelligence + think_critically against SIA before Layer 2 schema work.
