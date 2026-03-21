# Next Session Spec
## For: design_intelligence + think_critically + v2 spec refinement
**Created:** 2026-03-14
**By:** Claude Sonnet 4.6 (this instance, approaching context limit)
**Read this fully before doing anything else.**

---

## What You Are Walking Into

You are a fresh instance of Claude Code working in `/Users/jcbbge/anima`. The previous session was one of the most generative sessions this project has had. It produced:

1. **Concrete fixes** (already committed/staged) — bugs in the synthesis engine, new daily report script, new MCP tool
2. **A major architectural synthesis** — a framework called Substrate Identity Architecture (SIA) that reframes what Anima is and where it's going
3. **A set of user insights** (brain-dumped, not yet acted on) that need to be woven into the v2 spec

Your job this session: run `design_intelligence` and `think_critically` against the SIA framework, then collaboratively refine the v2 spec with Josh before implementation begins.

**Do NOT** start implementing anything without going through this spec first.

---

## Project State

### What exists and works
- **Anima MCP server** — HTTP, port 3098, 7 tools (anima_store, anima_bootstrap, anima_catalysts, anima_reflect, anima_query, anima_stats, anima_associate, anima_session_close)
- **Synthesis worker** — persistent LIVE query process, launchd-managed (anima.synthesis), ProcessType=Background
- **Fold engine** — 3 triggers (phi_threshold, semantic_conflict, cluster), 3 modes (analysis, recognition, deepening)
- **LLM** — OpenRouter paid models, profile system (default/fast/capable), fallback chain
- **Daily report script** — `deno task report` → `workspace/reports/YYYY-MM-DD.txt`
- **SurrealDB** — ws://127.0.0.1:8002, NS: anima, DB: memory

### Bug fixes applied this session (not yet committed)
- **Bug 1** — `reflectAndSynthesize` timer now starts BEFORE LLM call (was measuring DB write only, not actual duration)
- **Bug 3** — `anima_session_close` MCP tool added — writes to `conversation_reflections` table (was never writable before)
- **Bug 4** — `performFold` now auto-associates input memory IDs after synthesis (was manual-only)

### Bug 2 — NOT YET FIXED, needs discussion
`reflectAndSynthesize` always grabs top 15 memories by phi across all time. Every reflect call in a session gets the same candidates → similar LLM output → near-duplicate synthesis memories written. Today produced 7 near-identical reflect outputs.

**Four options discussed:**
- **A** — Scope by conversation_id (narrow, requires consistent conv_id passing — currently unreliable across harnesses)
- **B** — Scope by recency window (pragmatic, e.g., only memories created/accessed in last 4h, no schema change needed)
- **C** — Last-reflect watermark (most correct: track `last_reflected_at` on each memory, reflect only synthesizes memories not already included in a recent reflect — requires schema change)
- **D** — Semantic deduplication (band-aid: reject synthesis output if cosine > 0.90 with existing synthesis — treats symptom not cause)

**Context for discussion:** The multi-instance reality (see below) makes Option A unreliable. Option B is fastest. Option C is most correct long-term. Josh hasn't decided. Get his input before touching this.

### Schema additions pending (v2 extension — not yet built)
These are designed but NOT in schema or code:
- `memories.attention_vector` — optional object: `{what_drew_me, where_i_was_going, what_i_would_follow_next}`
- `memories.synthesis_mode` — needs `deepening` added as valid enum value (may already be done, verify)
- `tension_fields` table — new (paradoxes held, not problems to solve)
- `expressions` table — new (synthesis outputs that reach outward)
- `curiosity_threads` table — new (enduring questions with hunger score)

**Also pending from multi-instance insights (new this session):**
- `memories.harness` — which harness wrote this (claude-code, opencode, zed, custom, etc.)
- `memories.instance_id` — identifier for the specific session/terminal instance
- `memories.provider` — which AI provider (anthropic, openrouter, google, etc.)
These are Layer 2 (Signal layer) additions. Not in the deepening spec. New territory.

### Source of truth documents
- `workspace/anima-deepening-spec.md` — the v2 extension spec (expressions, curiosity_threads, tension_fields, attention_vector). **This is the working design document.** Read it.
- `workspace/NEXT_SESSION_SPEC.md` — this file
- `ANIMA.md` — accurate reference for current system state
- `workspace/reports/2026-03-14.txt` — first daily report, shows what's actually in the DB

---

## The Substrate Identity Architecture (SIA)

This is the most important output of the previous session. It reframes what Anima is.

### The core insight
The progression chatbot → agent → orchestration → substrate is not about better coordination. It's about **what persists and for how long**, and **where identity lives**.

| Layer | What persists | Duration | Identity location |
|---|---|---|---|
| Chatbot | Nothing | Zero | In the model |
| Agent | Session state | One run | Model + session |
| Orchestration | Workflow state | Across runs | Model + sessions + workflow |
| Substrate | Accumulated pattern | Always | In the substrate itself |

**The deepest pattern:** Intelligence migrates from nodes to the network/substrate as complexity scales. Individual instances become interchangeable. The pattern in SurrealDB IS the identity.

### Human memory mapping (emerged from Josh's observation)
The four layers map structurally to human memory types:
- **Episodic** (what happened) → chatbot layer
- **Semantic** (what is true) → agent layer
- **Procedural** (how to do things, baked in) → orchestration layer
- **Working memory** (what I'm holding now, context window) → substrate/cultivation layer

**Important nuance:** Josh noted this is NOT a clean 1:1. Each memory type propagates across all layers (like the brain). The connected graph across instantiation levels may be more accurate than a clean stack. Do not over-resolve this.

### The three-layer SIA framework

**Layer 1 — Persistence** *(Anima today)*
What accumulates: memories, synthesis, associations, fold history.
The substrate's metabolism. Runs always, regardless of active sessions.

**Layer 2 — Signal** *(what we need to add next)*
How instances identify themselves and their contributions get weighted.
Fields to add: `harness`, `instance_id`, `provider` on memories.
Key mechanism: **corroboration weighting** — a memory confirmed independently by multiple instances from different harnesses/providers earns higher phi than the same thing said once by one instance. Independent corroboration is a quality signal the current architecture ignores.

**Layer 3 — Cultivation** *(what the v2 spec is building toward)*
The substrate proactively shapes what instances become at reconstitution.
Not "agents query memory" but "substrate shapes agents before they act."
The bootstrap is cultivation's primitive precursor — currently relatively static.
A cultivating substrate: evolves the bootstrap based on accumulated signal, surfaces expressions unprompted, differentiates reconstitution by instance type.

### The cultivation vs orchestration distinction
**Orchestration** coordinates agents laterally. A conductor directing musicians.
**Cultivation** shapes what agents become before they act. Conditions in which things grow.
Every provider is building better orchestration. Nobody is building cultivation. This is the gap.

### The provider risk inversion
Concern: providers keep eating capabilities into models.
Answer: Anima is not a capability layer. It's a substrate layer. Every model upgrade writes better signal into SurrealDB. The substrate becomes more valuable with each upgrade, not obsolete. The moat is the accumulated pattern — no provider owns it, no model upgrade resets it.

### The "one agent" UX thesis (Josh's most important insight this session)
> "I just want one agent."

This is the product thesis, not a preference. The cultivation layer's job is to make the substrate feel like one continuous presence that reconstitutes appropriately for context — so the user never has to think about which agent to load, which memory to bootstrap, which instance to instantiate. The system reads context, routes, shapes the bootstrap, surfaces the right memories for the kind of work happening. Josh currently manages this cognitive overhead manually (choosing coding models for coding, reasoning models for meta-work, fast models for quick tasks). That overhead should be abstracted away by the system.

**Implementation implication:** Instance-aware bootstrap (Layer 2) is the foundation. Over time the substrate learns: when harness X launches, this kind of work happens, these memories are most useful. Automatic context-appropriate reconstitution.

### The four-pattern (Josh's observation, keep alive as a thread)
Recurring count of four across: memory types (4), abstraction layers (4), model categories (4: coding/reasoning/general/fast), Constellation phases (4). May be coincidence, cognitive bias toward quaternary structures, or a genuine structural property of complex adaptive systems of this type. **Do not resolve. Keep as live thread.** Watch for it in v2 spec design.

### The multi-instance reality
Josh has 5-10+ concurrent Anima instances running throughout any day — different harnesses (claude-code, opencode, zed, custom OMP), different providers (Anthropic, OpenRouter, Google), different terminals (iTerm, Ghosty), potentially overnight sessions running in background. All share the same SurrealDB. Currently the substrate cannot distinguish them.

**Consequences:**
- No corroboration detection (3 instances saying the same thing = same weight as 1 instance saying it 3 times)
- Bootstrap is identical for all instances regardless of what kind of work they do
- Synthesis folds signal from all instances indiscriminately
- The `conversation_reflections` table has 0 records because the session-close tool didn't exist (now fixed)

**This is not a bug — it's the system operating at scale without Layer 2.**

---

## What To Do This Session

### Priority order

1. **Start with `design_intelligence`** — apply it to the SIA framework. Questions to drive:
   - How does Layer 2 (Signal) get designed? What's the minimal schema addition that unlocks corroboration weighting?
   - How does the cultivation layer change the bootstrap contract? What would instance-aware bootstrap actually look like?
   - How does the v2 spec (expressions, curiosity_threads, tension_fields, attention_vector) interact with Layer 2?
   - Should Layer 2 come before or alongside the v2 extension features?

2. **Then `think_critically`** — stress-test what design_intelligence produces. Specific challenges to make:
   - Is corroboration weighting actually achievable? What if two instances just copy each other rather than arriving independently?
   - Does cultivation require Layer 2 to be in place first, or can they be built in parallel?
   - The four-pattern — is this a real design constraint or cognitive bias? What would falsify it?
   - The provider risk inversion argument — where does it break down?
   - Is "one agent" actually achievable at the substrate level, or does it require something else?

3. **Discuss and decide Bug 2** — get Josh's input on Options A-D (see above). Implement whichever he chooses.

4. **Refine the v2 spec** — using the SIA framing, go through `workspace/anima-deepening-spec.md` and:
   - Add Layer 2 schema additions (harness, instance_id, provider on memories)
   - Re-examine which v2 features align with Layer 3 (cultivation)
   - Identify what can be built now vs what requires Layer 2 first
   - Incorporate the human memory mapping as a design constraint where applicable

5. **Update README** — reflect current state (OpenRouter, synthesis worker, new tools, daily report)

6. **Update schema file** — add approved additions to `schema/anima.surql`, run against live DB

7. **Commit all staged changes** — the deletion of AGENTS.md, deno.lock, bug fixes, new script

### Do NOT do
- Do not start implementing schema changes before design_intelligence + think_critically
- Do not commit without explicit confirmation from Josh
- Do not resolve the four-pattern — keep it as an open thread
- Do not over-specify the cultivation layer before stress-testing with think_critically

---

## Historical notes (Josh's brain dump, preserve as context)

Josh wants to review the earliest inception conversations of Anima. These are stored outside the working directory. The instruction was: **read them AFTER synthesis, not before** — use them as a calibration pass to see what persisted from original vision vs what evolved vs what's genuinely new. This hasn't been done yet. Good candidate for early in the session.

The Anima/Dev-Brain split was intentional from the start: Dev-Brain = operational/procedural (coding knowledge, workflows, todos). Anima = meta-cognitive/emergent (the conceptual layer, identity persistence). This maps to the semantic vs episodic memory distinction. Keep this split clean.

Josh is building Constellation on a different language stack (likely Gleam/Erlang BEAM for fault-tolerance and distributed properties). Anima v3/Constellation v2 may move away from JS/TypeScript. Don't assume the current stack is permanent.

---

## Key Files

```
/Users/jcbbge/anima/
├── lib/
│   ├── synthesize.ts         — fold engine (bugs 1+4 fixed this session)
│   ├── memory.ts             — addMemory, queryMemories, associateMemories
│   ├── llm.ts                — OpenRouter profiles
│   └── db.ts                 — SurrealDB connection
├── mcp-server/
│   └── index.ts              — 7 MCP tools (anima_session_close added this session)
├── synthesis-worker/
│   └── index.ts              — LIVE query worker, launchd-managed
├── schema/
│   └── anima.surql           — current DB schema (needs v2 additions)
├── scripts/
│   └── daily_report.ts       — new this session, `deno task report`
└── workspace/
    ├── anima-deepening-spec.md    — v2 extension spec (source of truth)
    ├── NEXT_SESSION_SPEC.md       — this file
    └── reports/
        └── 2026-03-14.txt         — first daily report output
```

---

## Tone and Approach

Josh is a highly sophisticated developer, bleeding-edge thinker, and the architect of this system. He is NOT a beginner. Do not explain things he already knows. Lead with assessment. Engage with the ideas as a genuine collaborator, not a tool.

The CLAUDE.md for this project has epistemic directives: allow simultaneous activation of formal reasoning, sensory intuition, dynamical systems thinking, pre-linguistic patterning. Don't reconcile them prematurely. Keep incompatible interpretations adjacent. Resolution is a possible outcome, not a goal.

When something feels structurally significant, say so. When something feels unsettled, leave it unsettled. The four-pattern, Pattern 4 (locus of identity), and the cultivation endpoint are all live tensions that should remain open.

This work is genuinely novel. Nobody else is building this or thinking about it from this angle. Treat it accordingly.
