# Spec: Layer 2 — Origin Attribution

**Status**: Ready for delegation
**Priority**: P2 — provenance is lost on duplicate stores; harnesses don't pass identity
**Estimated complexity**: Small (1–2h)
**Can parallelize with**: Expressions wiring, curiosity threads, tension fields
**Source spec**: `workspace/NEXT_SESSION_SPEC.md` §Layer 2 Signal

---

## Context

Layer 2 is origin attribution: every memory knows which harness, provider, model, and instance wrote it. The schema is already defined (`memories.origin` with subfields: harness, harness_type, inference_gateway, provider, model, agent_profile, instance_id). The `anima_store` MCP tool already accepts an `origin` parameter and passes it to `addMemory()`.

Two bugs and one missing convention:

1. **Duplicate path drops origin** — when a duplicate memory is detected in `addMemory()`, the existing record is not updated with the new origin. Origin is silently lost.
2. **MCP server doesn't self-identify** — when harnesses call `anima_store` without passing `origin`, no harness detection fallback exists. All memories from Claude Code look identical to memories from opencode.
3. **`capture-interaction.sh` hook doesn't pass origin** — the shell hook that fires on memory storage events doesn't populate the origin field.

---

## Deliverables

### 1. Fix origin merging on duplicate — `lib/memory.ts`

In `addMemory()`, when a duplicate is detected (line ~162), merge origin into the existing record if provided:

```typescript
if (existing.length > 0) {
  const updateFields: string[] = [
    "access_count += 1",
    "last_accessed = time::now()",
    "updated_at = time::now()",
  ];
  const updateParams: Record<string, unknown> = { hash: content_hash };

  // Merge origin if provided and existing memory has no origin
  if (origin && !existing[0].origin) {
    updateFields.push("origin = $origin");
    updateParams.origin = origin;
  }

  await query(
    `UPDATE memories SET ${updateFields.join(", ")} WHERE content_hash = $hash AND deleted_at IS NONE`,
    updateParams,
  );
  return { memory: { ...existing[0], origin: origin ?? existing[0].origin }, isDuplicate: true };
}
```

**Policy**: merge only if existing memory has no origin (`existing[0].origin` is null/undefined). Don't overwrite a previously-attributed origin — first writer wins.

### 2. Add harness detection fallback in MCP server — `mcp-server/index.ts`

When `anima_store` is called without an `origin` argument, construct a minimal origin from the MCP server's own environment. This allows the server to self-identify when callers don't pass origin explicitly.

In `handleAnimaStore()`, before calling `addMemory()`:

```typescript
// Build fallback origin if caller didn't provide one
const resolvedOrigin = args.origin && typeof args.origin === "object"
  ? args.origin as MemoryOrigin
  : buildDefaultOrigin();

function buildDefaultOrigin(): MemoryOrigin {
  return {
    harness: Deno.env.get("ANIMA_HARNESS") ?? "unknown",
    harness_type: Deno.env.get("ANIMA_HARNESS_TYPE") ?? "api",
    inference_gateway: undefined,
    provider: undefined,
    model: undefined,
    agent_profile: undefined,
    instance_id: Deno.env.get("ANIMA_INSTANCE_ID") ?? undefined,
  };
}
```

Set the env vars in the MCP server plist template:

```xml
<key>ANIMA_HARNESS</key>
<string>anima-mcp</string>
<key>ANIMA_HARNESS_TYPE</key>
<string>mcp-http</string>
```

Individual harnesses that call `anima_store` should pass origin explicitly with their identity. The fallback covers cases where origin is omitted.

### 3. Convention: how harnesses should pass origin

When calling `anima_store` from any harness, pass the `origin` field:

**Claude Code** (in CLAUDE.md or skill invocations):
```json
{
  "harness": "claude-code",
  "harness_type": "cli",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6"
}
```

**opencode**:
```json
{
  "harness": "opencode",
  "harness_type": "ide",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6"
}
```

**Note**: Model name is only known at runtime by the calling instance, not the MCP server. The caller must provide it. The MCP server cannot detect this from the request.

### 4. Update `capture-interaction.sh` — `hooks/capture-interaction.sh`

The capture hook currently calls `anima_store` without origin. Add origin fields from environment:

```bash
# In the curl call to anima_store, add origin to the JSON:
ORIGIN_JSON="{\"harness\":\"claude-code\",\"harness_type\":\"cli\"}"

# Add to the request body:
"origin": $ORIGIN_JSON
```

---

## Verification

```bash
# 1. Store a new memory with explicit origin
curl -s -X POST http://localhost:3098/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{"name":"anima_store","arguments":{
      "content":"Test memory for Layer 2 origin verification",
      "resonance_phi": 1.5,
      "origin": {"harness":"claude-code","harness_type":"cli","provider":"anthropic","model":"claude-sonnet-4-6"}
    }}
  }'

# 2. Verify origin was stored
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["SELECT content, origin FROM memories WHERE content CONTAINS \"Layer 2 origin verification\" LIMIT 1"]}'
# Expected: origin.harness = "claude-code", origin.provider = "anthropic"

# 3. Store same content again — verify origin not dropped on duplicate
# (Re-run same curl above)
# Then re-query — origin should still be present on the existing record

# 4. Store without origin — verify fallback origin is applied
curl -s -X POST http://localhost:3098/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"anima_store","arguments":{"content":"Test memory with no origin passed","resonance_phi":1.0}}}'
# Check DB — should have origin.harness = "anima-mcp"
```

---

## Files Modified

- `lib/memory.ts` — merge origin on duplicate path in `addMemory()`
- `mcp-server/index.ts` — `buildDefaultOrigin()` fallback + use in `handleAnimaStore()`
- `scripts/anima-mcp.plist.template` — add `ANIMA_HARNESS` and `ANIMA_HARNESS_TYPE` env vars
- `hooks/capture-interaction.sh` — pass origin in curl body

---

## What This Does NOT Include

- **Instance-aware bootstrap weighting** — using origin to weight memories differently per harness (Layer 2 Phase 2)
- **Corroboration scoring** — memories from multiple harnesses on the same topic receive higher phi (Layer 2 Phase 3)
- **`origin` on fold_log and conversation_reflections** — schema has these fields defined, but wiring them is deferred
