# Spec: Synthesis Worker Fixes

**Status**: Ready for delegation
**Priority**: P1 — stats reporting is broken, fold versioning snapshots are failing
**Estimated complexity**: Small (< 1h)
**Can parallelize with**: Schema sync (run after schema sync completes), expressions wiring, curiosity threads

---

## Context

Four bugs in the synthesis worker and stats reporting layer. All are mechanical fixes. The `pending:19f` watermark is handled by the schema-sync-config-driven spec — do not reset it here.

---

## Bug A — `workerListening: false` (always)

**Root cause**: `lib/memory.ts` uses `Deno.Command("launchctl", ...)` to check if `anima.synthesis` is running. The MCP server plist (`~/Library/LaunchAgents/com.jcbbge.anima-mcp.plist`) launches Deno without `--allow-run`. The command throws silently and `workerListening` stays `false`.

**Fix**: Add `--allow-run=launchctl` to the MCP server plist.

The template is at `scripts/anima-mcp.plist.template` (or similar — locate the template first). Add `--allow-run=launchctl` to the Deno arguments:

```
run
--allow-net
--allow-env
--allow-read
--allow-run=launchctl    ← ADD THIS
/Users/jcbbge/anima/mcp-server/index.ts
```

Deploy with `deploy-plist <template>`. Restart the daemon:
```bash
launchctl stop com.jcbbge.anima-mcp
launchctl start com.jcbbge.anima-mcp
```

---

## Bug B — `foldCount: 1` (should be 66+)

**Root cause**: `lib/memory.ts:883` — missing `GROUP ALL` on the fold_log count query. In SurrealDB 3.0, `SELECT count()` without `GROUP ALL` returns one row per record, each with `count: 1`. `foldCountRows[0]?.count` always returns `1`.

**Fix**: In `lib/memory.ts`, change:
```typescript
const foldCountRows = await query<{ count: number }>(
  `SELECT count() AS count FROM fold_log`,
);
```
To:
```typescript
const foldCountRows = await query<{ count: number }>(
  `SELECT count() AS count FROM fold_log GROUP ALL`,
);
```

---

## Bug C — `memory_versions.fold_id` type mismatch (non-fatal snapshot failures)

**Root cause**: The field was originally `DEFINE FIELD fold_id ON memory_versions TYPE option<string>`. It was later changed to `TYPE option<record<fold_log>>` in the schema, but with `IF NOT EXISTS` — so the live DB field was never updated. The code writes a SurrealDB record ID (`fold_log:xyz`), but the live field still expects `string | none`.

**Fix**: In `schema/anima.surql`, find the `DEFINE FIELD IF NOT EXISTS fold_id ON memory_versions` line and remove `IF NOT EXISTS`:

```sql
-- Before:
DEFINE FIELD IF NOT EXISTS fold_id ON memory_versions TYPE option<record<fold_log>>;

-- After:
DEFINE FIELD fold_id ON memory_versions TYPE option<record<fold_log>>;
```

After schema is redeployed (`deno task schema`), the live field will be updated to accept record IDs. Existing `memory_versions` rows with null `fold_id` are unaffected.

**Note**: Check if any existing `memory_versions` records have a non-null `fold_id` value before deploying:
```bash
curl -s -X POST http://127.0.0.1:8002/rpc \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' -H 'surreal-db: memory' \
  -u 'root:root' \
  -d '{"method":"query","params":["SELECT count() AS count FROM memory_versions WHERE fold_id IS NOT NONE GROUP ALL"]}'
```
If 0 — safe to update. If > 0 — the existing string values will fail coercion; clear them first with `UPDATE memory_versions SET fold_id = NONE WHERE fold_id IS NOT NONE`.

---

## Verification

```bash
# After deploying all fixes and restarting MCP server:

# 1. workerListening should be true
curl -s -X POST http://localhost:3098/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"anima_stats","arguments":{}}}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['result']['content'][0]['text'])" | python3 -c "import sys,json; d=json.load(sys.stdin); print('workerListening:', d['workerListening'], '| foldCount:', d['foldCount'])"

# Expected: workerListening: True | foldCount: 66 (or current count)

# 2. No snapshot errors in synthesis-daemon log on next fold
tail -f /tmp/synthesis-daemon.error.log
# Trigger a fold, confirm no "Couldn't coerce value for field fold_id" entries
```

---

## Files Modified

- `scripts/anima-mcp.plist.template` — add `--allow-run=launchctl`
- `lib/memory.ts:883` — add `GROUP ALL`
- `schema/anima.surql` — remove `IF NOT EXISTS` from fold_id DEFINE FIELD

---

## Dependency

Run after `schema-sync-config-driven.md` spec (which resets `pending_synthesis` to `idle` and applies schema). Bug C fix requires another `deno task schema` run after editing the schema file.
