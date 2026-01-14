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
2. **Tool-agnostic** - Works with any AI agent/framework/provider
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
- ✅ Agent integration (AGENTS.md directive)
- ✅ One-command install script
- ✅ Provider sanitization complete
- ✅ Documentation reorganized

## Development Workspace (Active Development Only)

**During active development and dogfooding, use the workspace directory for temporary notes:**

```
workspace/
├── /logs/              Session logs - shared state between development sessions
├── /planning/          Architecture ideas and planning documents
├── /reports/           Analysis findings and performance reports
├── /updates/           Status and progress updates
└── /scratch/           Temporary calculations and tests
```

### How It Works

- **Never committed:** workspace/ is in .gitignore
- **Cross-session state:** Use workspace/logs/ for handoffs between sessions
- **Session logs:** `workspace/logs/session-YYYY-MM-DD.md` serves as the bridge
  - Agent/session: Creates/updates with discoveries
  - Next session: Reads to understand context, appends findings
  - Result: Continuous context across development sessions

### Protocol for Development

1. **Session Start:** Check if `workspace/logs/session-$(date +%Y-%m-%d).md` exists
   - YES → Read prior discoveries and context
   - NO → Create new log with header

2. **During Work:** Append findings to active session log
   - Record discoveries with timestamps
   - Note what was tested/validated
   - Reference any created workspace/planning/ or workspace/reports/ files

3. **Handoff to Next Session:** Leave clear "Next Steps"
   - Next session will read this log when started
   - Next session will append their findings back
   - Creates continuous context thread

4. **When Ready to Publish:** Move from workspace/ → /docs/
   - Polish and finalize document
   - Move to appropriate /docs subdirectory
   - Commit to repository

### Important Notes

- workspace/ is NEVER part of the repository
- All agents read this same AGENTS.md
- Workspace is purely for active development state sharing
- It prevents pollution of the repository during development

---

## Remember

Use Anima while working on itself. Bootstrap at session start. Store insights. Mark catalysts. Use the workspace to share discoveries between sessions. The system should dogfood itself.
