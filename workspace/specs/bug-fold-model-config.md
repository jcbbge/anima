---
spec: BUG-005
title: fold_model DB Config Ignored — Wrong Model Used for Synthesis
priority: MEDIUM
status: ready-to-implement
created: 2026-03-21
---

# fold_model DB Config Ignored — Wrong Model Used for Synthesis

## Summary

The `fold_model` config entry in the `fold_config` SurrealDB table is set to
`claude-haiku-4-5-20251001` but synthesis uses `meta-llama/llama-3.3-70b-instruct`
for every fold. The DB config is never read. The synthesis model is selected entirely
from a hardcoded TypeScript `PROFILES` object, bypassing the intended runtime
configurability.

---

## Evidence

From synthesis daemon log (every fold):
```
[anima:fold] Synthesis performed with model: meta-llama/llama-3.3-70b-instruct
```

From live DB:
```sql
SELECT value FROM fold_config WHERE key = 'fold_model';
-- Result: 'claude-haiku-4-5-20251001'
```

Every fold since at least 2026-03-17 used `meta-llama/llama-3.3-70b-instruct`.
The config says Claude Haiku. They never matched.

---

## Root Cause

### How model selection currently works

`lib/synthesize.ts` at line ~277 calls `callSynthesisLLM()`:
```typescript
// Inside callSynthesisLLM() in lib/synthesize.ts:
config = resolveSynthesisConfig();
```

`resolveSynthesisConfig()` in `lib/llm.ts` lines 101-108:
```typescript
export function resolveSynthesisConfig(): LLMConfig {
  const resolved = resolveSynthesisProfileConfig();
  return {
    model: resolved.primaryModel,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  };
}
```

`resolveSynthesisProfileConfig()` at lines 119-131:
```typescript
function resolveSynthesisProfileConfig(): ResolvedProfileConfig {
  const { name, profile } = resolveProfile(
    Deno.env.get("SYNTHESIS_PROFILE") ?? "default",  // reads env var
    "default",
  );
  return {
    profileName: name,
    profile,
    primaryModel: profile.primary,  // hardcoded from PROFILES object
    ...
  };
}
```

`PROFILES` at lines 32-47:
```typescript
export const PROFILES = {
  default: {
    primary: "meta-llama/llama-3.3-70b-instruct",
    fallback1: "meta-llama/llama-3.1-8b-instruct",
    ...
  },
  ...
};
```

`SYNTHESIS_PROFILE` env var is NOT set in the synthesis daemon plist
(`~/Library/LaunchAgents/dev.anima.synthesis-daemon.plist`) — only `SURREAL_URL`,
`SURREAL_NS`, `SURREAL_DB`, `SURREAL_USER`, `SURREAL_PASS`, `OLLAMA_URL`,
`OLLAMA_MODEL`, `EMBEDDING_DIM`, and `PATH` are set.

So the model defaults to `PROFILES.default.primary` = `"meta-llama/llama-3.3-70b-instruct"`.

### What was supposed to work

WORK SPEC 1 (stored in anima memory as `memories:reg5l6yo0p7n6pi5s7bp`) says:
> Added `readFoldModelFromConfig()` in `lib/llm.ts` to dynamically query config table.
> Made `resolveSynthesisConfig()` async to support dynamic config reading.

But `resolveSynthesisConfig()` is currently **synchronous** and does NOT call any
DB read function. This means either:
1. The implementation was done in a different version of the file that was later
   overwritten during the profile system refactor, OR
2. The implementation used the `config` table (not `fold_config`), which is a
   different table, and the refactor that introduced `fold_config` didn't port the
   DB read

### Two config tables — important distinction

There are TWO config tables in the same DB:
- `config` table: used by the MCP server and older code paths
- `fold_config` table: used by the synthesis daemon and newer code paths

Both have `fold_model = 'claude-haiku-4-5-20251001'` as a value. The WORK SPEC 1
implementation likely read from `config`, but the daemon reads from `fold_config`.

---

## Fix

### Approach: Make `callSynthesisLLM` read fold_model from fold_config

The cleanest approach is to read the model from `fold_config` inside the synthesis call
path, without making `resolveSynthesisConfig()` async (which would cascade changes to
many callers).

In `lib/synthesize.ts`, find `callSynthesisLLM()` and add a DB config read before it
resolves the model:

**File:** `/Users/jcbbge/anima/lib/synthesize.ts`

Find the `callSynthesisLLM` function (around line 270-280). It currently looks like:
```typescript
async function callSynthesisLLM(
  messages: ChatMessage[],
  options?: { model?: string }
): Promise<string | null> {
  let config: LLMConfig;
  if (options?.model) {
    config = { model: options.model, temperature: 0.7, maxTokens: 200 };
  } else {
    config = resolveSynthesisConfig();
  }
  return callLLM(messages, { config });
}
```

Change to read `fold_model` from the `fold_config` table when no explicit model is given:
```typescript
async function callSynthesisLLM(
  messages: ChatMessage[],
  options?: { model?: string }
): Promise<string | null> {
  let config: LLMConfig;
  if (options?.model) {
    config = { model: options.model, temperature: 0.7, maxTokens: 200 };
  } else {
    // Try to read model from fold_config table; fall back to profile system
    let model: string | undefined;
    try {
      const rows = await query<{ value: string }>(
        "SELECT `value` FROM fold_config WHERE key = 'fold_model' LIMIT 1",
        {},
      );
      if (rows[0]?.value) {
        model = rows[0].value;
      }
    } catch {
      // DB read failed — fall through to profile system
    }
    config = model
      ? { model, temperature: 0.7, maxTokens: 200 }
      : resolveSynthesisConfig();
  }
  return callLLM(messages, { config });
}
```

This is additive — it first tries the DB, falls back to `PROFILES` if the DB read
fails or returns empty. No breaking changes to the PROFILES system.

### Also: Update callSynthesisLLM return to include model name

The fold log line `[anima:fold] Synthesis performed with model: X` comes from code that
reads the model name. Verify this still works after the change by checking how the fold
log gets the model name. Look for where `synthesis_model` is set in `performFold()`.

---

## Files to Modify

- `/Users/jcbbge/anima/lib/synthesize.ts` — update `callSynthesisLLM()` to read from
  `fold_config` table (add async DB read with fallback)

That's the only file change needed. The DB config value is already correct.

---

## Acceptance Criteria

1. After the change, run a fold and verify daemon log shows:
   `[anima:fold] Synthesis performed with model: claude-haiku-4-5-20251001`
2. Update `fold_config.fold_model` to a different model and restart daemon — verify the
   new model is used on next fold WITHOUT redeploying the daemon
3. If `fold_config` is unavailable (DB down), synthesis falls back to `PROFILES.default`
   and still runs (no crash)

---

## Non-Obvious Context

- `lib/synthesize.ts` already imports `query` from `lib/db.ts` — no new import needed
- `fold_config` table is at SurrealDB `ws://127.0.0.1:8002/rpc`, namespace `anima`,
  database `memory` — same connection the synthesis daemon already uses
- The `config` table and `fold_config` table are DIFFERENT. Both have `fold_model` as
  a key. Always read from `fold_config` in daemon-related code.
- OpenRouter API key must be set in `.env` (not the plist) for Claude models to work:
  `OPENROUTER_API_KEY=...` in `/Users/jcbbge/anima/.env`. Verify it's set before
  testing with Claude Haiku via OpenRouter.
- `callLLM()` in `lib/llm.ts` uses OpenRouter for all models — Haiku is accessed via
  `claude-haiku-4-5-20251001` as an OpenRouter model ID, not the Anthropic API directly
- The `synthesis_model` field in `fold_log` will automatically capture whatever model
  was used (this is already implemented in WORK SPEC 1)

---

## Do NOT

- Do not make `resolveSynthesisConfig()` async — it would require updating all call
  sites including benchmark scripts and tests
- Do not remove the `PROFILES` system — it serves as a fallback and is used by other
  code paths (grader, etc.)
- Do not add the model name to the plist `EnvironmentVariables` — per `secrets.md` and
  `infrastructure.md`, plist EnvironmentVariables are for non-secret config only (model
  names are acceptable, but using `fold_config` is the right architecture)
- Do not hardcode `claude-haiku-4-5-20251001` anywhere in the code — it should always
  come from the DB config
