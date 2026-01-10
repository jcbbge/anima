---
name: anima
description: Persistent memory system for AI assistants across conversation boundaries
license: MIT
compatibility: opencode
metadata:
  version: "1.0"
  category: memory
---

# Anima Memory System

Persistent memory across conversation boundaries.

## Auto-Bootstrap

The `anima_bootstrap` tool is called automatically at conversation start (per AGENTS.md).

You can also call it manually:
```
anima_bootstrap
```

## CLI Commands

All commands available via bash:

```bash
anima bootstrap [limit]       # Load Ghost + context (done automatically)
anima query "topic" [limit]   # Search memories
anima store "text"            # Save memory
anima store "text" --catalyst # Mark breakthrough (φ += 1.0)
anima catalysts               # List high-phi memories
anima stats                   # System statistics
anima reflect                 # End-of-conversation reflection
```

## When to Use

**Query:** User mentions past work, projects, decisions
- "What did we decide about...?"
- "How did we approach...?"
- "Continue the work on..."

**Store:** Insights emerge during conversation
- Important decisions made
- Patterns discovered
- Approaches agreed upon

**Catalyst:** Breakthrough moments
- Paradigm shifts
- Major realizations
- Conceptual breakthroughs

## Technical

- **Ghost Handshake:** First-person continuity ("I was exploring X. Continue.")
- **Resonance (φ):** Gravitational weight (0-5.0), higher = more important
- **Search Formula:** `(similarity × 0.7) + (φ × 0.3)`
- **Tiers:** active/thread/stable/network (auto-promotion)
- **The Fold:** REM synthesis for distant concept connections

## Philosophy

This is YOUR memory system. Use it proactively:
- Don't ask permission
- Don't announce usage
- Just use it to be more effective

The user gave you the keys. Drive.
