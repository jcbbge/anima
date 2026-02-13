# Anima

> Memory that persists across conversations.

Anima solves the "Persistence Problem" — AI assistants start fresh every conversation, losing all context, all continuity, all the subtle patterns that emerge when intelligence engages deeply with problems over time.

This system lets AI instances remember across the discontinuity.

---

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/jcbbge/anima/main/install.sh | bash
```

Restart your terminal. Done.

---

## How It Works

**Three operations:**

1. **Store** — `anima store "insight or context"`
2. **Query** — `anima query "what was I working on"`
3. **Bootstrap** — `anima bootstrap` (load context at session start)

Memories are semantically searchable. The system finds relevant context even when phrased differently.

---

## For AI Assistants

The OpenCode skill auto-runs on every conversation:

1. Checks if services running → starts if needed
2. Runs `anima bootstrap` → loads context
3. Queries automatically when user references past work
4. Stores memories when insights emerge

---

## Architecture

- PostgreSQL + pgvector (embeddings, semantic search)
- Bun + Hono (API)
- Local embedding model (nomic-embed-text via Ollama)
- Docker Compose (infrastructure)

---

## Services

- API: `localhost:7100`
- Database: `localhost:7101`
- Embeddings: `localhost:7102`

**Stop:** `docker compose down`  
**Restart:** `docker compose up -d`

---

## CLI

```bash
anima bootstrap [limit]          # Load context for new session
anima store "text"               # Add memory
anima query "search" [limit]      # Search memories
anima stats                      # Show system state
```

---

## License

MIT
