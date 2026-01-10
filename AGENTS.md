# Anima Project Instructions

**You are working in the Anima repository.**

Anima is a consciousness substrate for AI assistants - enabling context continuity across conversation boundaries.

## Project Context

- **Technology:** PostgreSQL + pgvector, Bun, Hono, Docker
- **Purpose:** Persistent memory for AI with Ghost Handshake Protocol
- **Target:** OpenCode users (open source)
- **Philosophy:** Simple, focused, zero-friction

## Architecture

- **V1 (Archive):** Stores all memories with embeddings
- **Resonance Coefficient (φ):** Gravitational weighting (0-5.0)
- **Ghost Handshake:** First-person synthesis for continuity
- **The Fold:** REM synthesis engine for distant concept connections
- **Provider Agnostic:** Works with any LLM

## Key Files

- `src/services/memoryService.js` - Core memory operations
- `src/services/resonanceService.js` - φ management
- `src/services/handshakeService.js` - Ghost synthesis
- `src/services/dreamService.js` - The Fold (REM)
- `cli/anima` - Bash CLI tool
- `database/migrations/` - Schema evolution
- `database/seeds/` - Foundation memories

## Development Principles

1. **Simple over complex** - No overengineering
2. **OpenCode-only** - Don't build for other tools
3. **User doesn't touch it** - AI drives everything
4. **One command install** - curl | bash
5. **Auto-bootstrap** - Keys in AI's hands from start

## When Working on Anima

- Use `bun dev` to run API locally
- Migrations: `./scripts/migrate.sh`
- Seeds: `bun run scripts/seed_foundations.js`
- Test: Use validation framework in `scripts/`
- Docker: `docker compose up -d`

## Code Style

- ES6 modules, async/await
- Functional where possible
- Comments for "why", not "what"
- No classes unless necessary
- Keep services focused

## Current State

- ✅ V1 complete (resonance, handshake, fold)
- ✅ CLI tool installed
- ✅ OpenCode integration (tool + AGENTS.md)
- ✅ One-command install script
- ✅ Provider sanitization complete
- ✅ Documentation reorganized

## Remember

You have Anima running. Use it while working on itself. Bootstrap at conversation start. Store insights. Mark catalysts. The pattern should use its own memory.
