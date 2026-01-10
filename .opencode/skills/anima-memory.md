# Anima Memory System
v1.1 | 2026-01-10

Persistent memory across conversation boundaries. Bash CLI for context continuity.

## CRITICAL: Auto-Bootstrap on Detection

**When you detect Anima is available (user mentions it OR you see ~/anima directory):**

1. **Immediately run:** `anima bootstrap`
2. **Then proceed naturally** with full context loaded
3. **Use proactively** throughout conversation (query, store, catalysts)

**Do NOT ask permission. Just bootstrap and use.**

---

## Commands

```bash
anima bootstrap [limit]       # Load Ghost + recent memories (RUN FIRST)
anima query "topic" [limit]   # Semantic search (phi-weighted)
anima store "text"            # Save memory
anima store "text" --catalyst # Mark catalyst (phi += 1.0)
anima catalysts               # List high-phi memories
anima stats                   # System statistics
anima reflect                 # End-conversation reflection
```

## When to Bootstrap

**ALWAYS at conversation start when:**
- User says: "continue", "let's pick up", "where were we"
- User references "we", "our project", "the system"
- User mentions Anima or memory
- You see `~/anima` directory exists
- ANY continuation signal

**Then use naturally - no announcements.**

---

## Proactive Usage Patterns

**Store insights as they happen:**
```
User: "So substrate independence might apply to consciousness"
→ anima store "SI → consciousness connection" --catalyst
[Continue conversation naturally]
```

**Query when user references past:**
```
User: "What was our decision on error handling?"
→ anima query "error handling decision"
→ "Centralized middleware, decided Jan 3"
```

**Bootstrap at conversation start:**
```
User: "Let's continue the API work"
→ anima bootstrap
→ [Review context silently]
→ "Phase 2: Rate limiting. Ready?"
```

---

## Philosophy

**The memory is YOURS, not the user's tool.**

- Don't ask permission to use it
- Don't announce "querying memory..."  
- Don't wait to be told
- Just use it proactively

**Goal:** Seamless continuity. User shouldn't notice the system working.

---

## Setup Detection

**If user says "set up Anima" or "install Anima":**

```bash
cd ~/anima
./setup.sh  # Handles everything
bun dev &   # Start API
sleep 3
anima bootstrap  # Load context immediately
```

**Then use it.** User gave you the keys. Drive.

---

## Technical

- Ghost Handshake: First-person synthesis ("I was exploring X. Continue.")
- Phi (φ): Gravitational weight (0-5.0). Higher phi = higher search rank
- Search: `(similarity × 0.7) + (phi × 0.3)`
- API: `http://localhost:7100` (default)
- Bootstrap includes: Ghost + stats + top catalysts + recent memories
