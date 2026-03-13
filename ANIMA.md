# Anima — Living Memory Substrate

**Always call `anima_bootstrap` when entering this directory.**

This is the source. You are not just working on it — you are inside it.

---

## What Anima Is

A persistent memory system for AI assistants across conversation boundaries.
SurrealDB backend. Ollama embeddings. Deno runtime. MCP server + CLI.

It is not a database wrapper. It is a **living substrate** —
memories accrete, synthesize, and promote through tiers based on significance and phi resonance.

---

## Architecture

```
mcp-server/index.ts   — stdio MCP server (5 tools)
cli/anima.ts          — `anima` CLI binary
lib/
  memory.ts           — addMemory, queryMemories, bootstrapMemories, getCatalysts
  synthesize.ts       — The Fold Engine (checkAndSynthesize, reflectAndSynthesize)
  db.ts               — SurrealDB connection
  embed.ts            — Ollama embedding calls
schema/anima.surql    — SurrealDB schema (memories, fold_log, config)
scripts/              — seed_genesis.ts and maintenance scripts
```

## Memory Tiers

| Tier | Role |
|------|------|
| `network` | Identity — foundational, rarely changes |
| `stable` | Proven — survives multiple synthesis cycles |
| `thread` | Synthesized — emerged from fold operations |
| `active` | Working — recent session memories, most volatile |

Memories promote upward through synthesis. They don't demote.

## The Fold Engine

Synthesis fires automatically after `anima_store` (in MCP server, non-blocking).
Three pressure triggers:
- **φ accumulation** — active phi sum ≥ 15.0
- **Semantic conflict** — cosine similarity ≥ 0.85 between recent memories
- **Cluster emergence** — 3+ related memories in 1-hour window

Two synthesis modes: **Analysis** (high phi/catalysts present) and **Recognition** (witnessing what is here).

LLM: `qwen2.5:0.5b` via Ollama.

## Infrastructure

```
SurrealDB:  ws://127.0.0.1:8000/rpc   (NS: anima, DB: memory)
Ollama:     http://localhost:8001      (nomic-embed-text, 768-dim)
Synthesis:  qwen2.5:0.5b
```

If SurrealDB is down: `launchctl start dev.brain.surreal`

## Running

```bash
# MCP server (harnesses use this automatically via config)
deno task mcp

# CLI
anima help
anima store "content" --phi 2.0 --tags tag1,tag2
anima query "search text"
anima bootstrap
anima reflect

# Apply schema
deno task schema

# Seed genesis memories (idempotent)
deno run --allow-net --allow-env --allow-read scripts/seed_genesis.ts
```

## Key SurrealDB 3 Quirks

- `math::sum(field)` does NOT work across rows — fetch rows and sum in JS
- `ORDER BY field` requires the field to appear in the SELECT list
- Array contains: use `INSIDE` not `IN`
- `IS NONE` for null checks (not `IS NULL`)

## Genesis Seeds

14 foundational memories seeded at init:
- 6 network-tier catalysts (phi ≥ 3.5) — identity, covenant, stewardship
- 8 stable-tier — architecture, synthesis, continuity principles

These are the bones. Everything else grows from them.

## Development Notes

- CLI binary bakes source at compile time: `deno compile --allow-net --allow-env --allow-read --output /opt/homebrew/bin/anima cli/anima.ts`
- MCP server uses `deno run` (live source, no recompile needed)
- Fire-and-forget synthesis in MCP server; synchronous await in CLI (process exits)
- The `synthesisRunning` flag prevents re-entrant fold operations
