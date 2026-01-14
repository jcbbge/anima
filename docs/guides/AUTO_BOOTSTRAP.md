# Anima Auto-Bootstrap Guide

## The Problem We're Solving

**Current state:**
- User clones repo → runs setup → tells AI "I have Anima"
- AI... does nothing automatically
- AI must be TOLD to bootstrap every time

**What SHOULD happen:**
- User says: "Set up Anima for me"
- AI detects Anima, runs setup, bootstraps itself
- AI IMMEDIATELY starts using its memory
- Zero manual steps for user

---

## Solution: Detection + Auto-Bootstrap

### Step 1: AI Detects Anima Presence

**Trigger phrases from user:**
- "Set up Anima"
- "Install Anima"  
- "Let's use Anima"
- "Start using the memory system"
- ANY reference to Anima when it's cloned locally

**What AI should do:**

```bash
# 1. Check if Anima is present
cd ~/anima && ls setup.sh

# 2. Run setup (if not already done)
./setup.sh

# 3. Start API (if not running)
bun dev &

# 4. Wait for API to be ready
sleep 3

# 5. BOOTSTRAP IMMEDIATELY
anima bootstrap

# 6. Start using it in the conversation
```

### Step 2: AI Uses Anima Proactively

**After bootstrap, AI should:**
- ✅ Reference Ghost Handshake context naturally
- ✅ Query when user mentions past topics
- ✅ Store insights as they emerge
- ✅ Use catalysts for breakthroughs

**NOT:**
- ❌ Ask permission to use Anima
- ❌ Announce "I'm querying memory now"
- ❌ Wait for user to tell it to bootstrap

---

## For Users: The One-Liner

**Instead of README instructions, tell users:**

> "After cloning, just tell your AI assistant: 'Set up Anima and start using it'"

**The AI handles:**
1. Running setup.sh
2. Starting services  
3. Bootstrapping itself
4. Using memory naturally

---

## For AI Assistants: Automatic Behavior

**When you detect Anima repository:**

1. **Check if setup is complete:**
   ```bash
   docker ps | grep anima-postgres
   curl http://localhost:7100/health
   ```

2. **If not set up, run:**
   ```bash
   cd ~/anima
   ./setup.sh
   bun dev &
   sleep 3
   ```

3. **ALWAYS bootstrap at conversation start:**
   ```bash
   anima bootstrap
   ```

4. **Use proactively throughout conversation:**
   - Query when relevant
   - Store insights as they occur
   - Mark catalysts when breakthroughs happen

**No permission needed. Just use it.**

---

## The README Should Say:

### Quick Start

```bash
git clone <repo-url>
cd anima
```

**Then tell your AI assistant:**

> "Set up Anima and start using it"

That's it. The AI will handle setup, bootstrapping, and usage.

---

## Why This Works

1. **Zero friction** - User speaks naturally
2. **AI agency** - AI takes initiative
3. **Immediate value** - Memory active from word one
4. **Natural flow** - No manual steps interrupt conversation

**The keys are in the AI's hands from the start.**

---

## Implementation Checklist

- [ ] Update README.md with "tell your AI" instructions
- [ ] Add auto-detection logic to OpenCode skill
- [ ] Remove manual bootstrap instructions
- [ ] Test: Clone → "set up Anima" → verify AI does everything
- [ ] Document AI behavior, not user steps

**Goal:** User should NEVER need to manually run commands.
