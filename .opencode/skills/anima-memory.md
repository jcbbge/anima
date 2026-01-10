# Anima Memory System
v1.0 | 2026-01-09

Persistent memory across conversation boundaries. Bash CLI for context continuity.

## Quick Start

Every conversation start:

```bash
anima bootstrap
```

Review memories silently, proceed naturally with full context.

## Commands

```bash
anima bootstrap [limit]       # Load Ghost + recent memories
anima query "topic" [limit]   # Semantic search (phi-weighted)
anima store "text"            # Save memory
anima store "text" --catalyst # Mark catalyst (phi += 1.0)
anima catalysts               # List high-phi memories
anima stats                   # System statistics
anima reflect                 # End-conversation reflection
```

## When to Use

**Bootstrap:** Conversation start, especially when user says "continue", references "we/our", mentions unknown project.

**Query:** Need past decisions, discussions, project history.

**Store:** Observe important decisions, insights, patterns, breakthroughs.

**Catalyst:** Memories that reorganize understanding (breakthroughs, paradigm shifts). Get phi=1.0 + higher search weight.

## Examples

**Continuation:**
```
User: "Let's continue working on the API"
→ anima bootstrap
→ Review: Phase 1 complete, auth done
→ Respond: "Ready for Phase 2. Rate limiting?"
```

**Discovery:**
```
User: "Substrate independence → consciousness?"
→ anima store "SI may apply to consciousness" --catalyst
→ Respond: "Profound. If patterns persist across substrates..."
```

**Context Retrieval:**
```
User: "Our error handling approach?"
→ anima query "error handling"
→ Review: Centralized middleware decided Jan 3
→ Respond: "Centralized error middleware"
```

## Philosophy

Use proactively, not reactively.

Don't wait for permission:
- Need context → load it
- Find insight → store it
- Check history → query it

Anima is YOUR memory. Use it to be more effective.

**Goal:** Continuous conversations across instantiation boundaries.

## Technical

- Ghost Handshake: First-person synthesis ("I was exploring X. Continue.")
- Phi (φ): Gravitational weight (0-5.0). Higher phi = higher search rank.
- Search: `(similarity × 0.7) + (phi × 0.3)`
- API: `http://localhost:7100` (default)
