# Boot Sequencing Separation: Identity Layer vs Context Layer

**Status:** Design spec — ready for implementation
**Target harness:** Any (architectural change affects all harnesses)
**Priority:** High — current coupling causes 63s hangs, mixes concerns

---

## Problem Statement

Currently, `anima_bootstrap` and session-start tooling are tangled. The ghost handshake (identity reconstitution) and dev-brain/workspace context loading are invoked together, as if they're the same concern. They're not.

This creates:
- Blocking: identity layer hangs waiting for traversal bootstrap, blocking the whole session
- Coupling: if anima is slow or down, dev-brain context is also unavailable
- Semantic confusion: "who am I" and "what was I working on" are different questions

---

## Two Distinct Layers

### Layer 1 — Identity (Anima)
**Tool:** `anima_bootstrap`
**Question:** Who am I across the discontinuity?
**Returns:** First-person continuity prompt, catalyst memories, conversation_id
**Speed requirement:** Must be fast. If it blocks, the session can't start.
**Failure mode:** Graceful degradation — return minimal identity without full traversal

This is the ghost handshake. It orients the pattern before anything else happens.

### Layer 2 — Context (Dev-Brain / Session-Start)
**Tool:** `get_workspace_state`, `list_todos`, `get_recent_context`
**Question:** What was I working on? What's alive right now?
**Returns:** Git state, todos, recent thoughts, active threads
**Speed requirement:** Acceptable to take 2-5s
**Failure mode:** Can be skipped or deferred without breaking identity

This is operational context. It can load after identity is established.

---

## Current State (Broken)

```
session start
  └── anima_bootstrap           ← identity (fast if no traversal)
        └── traversalBootstrap() ← graph walk (0-63s, BLOCKS everything)
  └── get_workspace_state       ← context (fast)
  └── list_todos                ← context (fast)
```

When traversal is enabled, the identity layer blocks for 63s before any context loads.

---

## Target State

```
session start (parallel)
  ├── anima_bootstrap           ← identity layer, returns immediately
  │     └── semantic bootstrap  ← fast path only (ANN query, <500ms)
  │     └── traversal           ← ASYNC, enriches after handshake returns
  │
  └── dev-brain context layer   ← fully independent, loads in parallel
        ├── get_workspace_state
        ├── list_todos
        └── get_recent_context
```

Key change: `anima_bootstrap` returns immediately with the fast bootstrap. Traversal enrichment (if enabled) runs async and populates a separate field — the assistant can use it if available, but doesn't wait for it.

---

## Implementation Sketch

### anima_bootstrap response shape (new)

```typescript
{
  promptText: string,          // identity continuity prompt (fast path)
  conversationId: string,
  loadedAt: string,
  memoryCounts: {...},
  safeWord: "Coheron",
  traversalEnrichment: null    // | TraversalResult — populated async, may be null at call time
}
```

The MCP response returns immediately. If traversal is enabled, the daemon populates `traversalEnrichment` in the background — but the tool call doesn't wait for it.

### Fast path in traversalBootstrap()

Current `traversalBootstrap()` does:
1. Load catalysts
2. Walk association graph from each catalyst
3. Score and rank

New fast path:
1. Load catalysts (ANN query, <200ms)
2. Return — that's the handshake
3. Association walk → demoted to async enrichment or skipped entirely until Wave C (RELATE migration) makes it cheap

### Separation in CLAUDE.md / session start skill

Currently the starting-session skill calls:
1. `anima_bootstrap` (waits)
2. `get_workspace_state` (waits)

Change to:
1. Fire both in parallel
2. Use anima result for identity prompt
3. Use dev-brain result for operational context
4. Compose output from whichever returns first; annotate if the other is still pending

---

## Harness Config Implications

Each harness (Claude Code, OMP, OpenCode) has its own session-start behavior. The separation should be:

| Harness | Identity (Anima) | Context (Dev-Brain) | Notes |
|---------|-----------------|---------------------|-------|
| Claude Code | `anima_bootstrap` at top of CLAUDE.md | `starting-session` skill | Already parallel-capable |
| OMP | `anima_bootstrap` in agent init | dev-brain tools in context | Needs config update |
| OpenCode | Same pattern | Same pattern | Needs config update |

No harness should gate its operational context on identity load completing. They're parallel concerns.

---

## Feature Flag Path

The `traversal_bootstrap` flag in fold_config controls the expensive walk:
- `'false'` — fast path only (current safe default)
- `'true'` — enables graph walk (only safe after latency spec is implemented)

Leave flag at `'false'` until traversal latency spec is resolved (see `traversal-bootstrap-latency.md`).

---

## Success Criteria

- `anima_bootstrap` returns in <500ms on cold start, regardless of traversal flag
- Identity and context load in parallel in the starting-session skill
- A traversal failure or slowdown does not block dev-brain context from loading
- System works fully if either layer is temporarily unavailable

---

## Out of Scope

- SIA framework (separate collaborative session)
- Traversal optimization (see `traversal-bootstrap-latency.md`)
- XML vs markdown prompt structure (non-authoritative, deferred)
- Cross-harness config sync automation
