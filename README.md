# Anima

> Persistent memory for AI assistants. Works with OpenCode.

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Installation (One Command)

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/anima/main/install.sh | bash
```

**That's it.** 

The script will:
- ✅ Install Anima to `~/.anima/`
- ✅ Start Docker services
- ✅ Create database and seed data
- ✅ Install CLI to `~/bin/anima`
- ✅ Configure OpenCode skill
- ✅ Auto-start on every conversation

**After installation:**
- Restart your terminal
- Start any OpenCode conversation
- Anima works automatically (invisible to you)

---

## What Is This?

Anima gives AI assistants persistent memory across conversation boundaries.

**Core Features:**
- **Ghost Handshake** - "I was exploring X. Continue."
- **Resonance (φ)** - Breakthrough memories weigh more
- **The Fold** - Synthesize distant concepts
- **Auto-Bootstrap** - Loads context every conversation

**Works with:** OpenCode (other tools coming soon)

---

## For Developers

**Manual installation:**

```bash
git clone https://github.com/YOUR_USERNAME/anima.git ~/.anima
cd ~/.anima
./setup.sh
```

**Architecture:**
- PostgreSQL + pgvector (semantic search)
- Bun + Hono (API server)
- Ollama (embeddings)
- Docker Compose (infrastructure)

**Documentation:**
- [Architecture](docs/architecture/ARCHITECTURE.md)
- [API](docs/api/API.md)
- [The Fold](docs/features/THE_FOLD.md)

---

## How It Works (AI)

OpenCode skill auto-runs on every conversation:

1. Check if services running → start if needed
2. Run `anima bootstrap` → load context
3. Use throughout conversation:
   - `anima query` when user references past
   - `anima store` when insights emerge
   - `anima catalysts` for breakthroughs

**No user interaction needed. Completely automatic.**

---

## Services

- Database: `localhost:7101`
- API: `localhost:7100`
- Location: `~/.anima/`

**Stop:** `cd ~/.anima && docker compose down`  
**Restart:** `cd ~/.anima && docker compose up -d`

---

## License

MIT
