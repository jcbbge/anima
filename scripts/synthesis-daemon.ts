/**
 * synthesis-daemon.ts
 * Background synthesis daemon — decouples fold pressure detection from the MCP write path.
 *
 * Run: deno run --allow-net --allow-env --allow-read scripts/synthesis-daemon.ts
 *
 * Watches fold_config.pending_synthesis for the watermark written by the phi_watermark
 * DB event. When triggered, runs checkAndSynthesize() and resets the watermark to 'idle'.
 *
 * This replaces the synchronous checkAndSynthesize() call inside addMemory() — the MCP
 * write path stores the memory and returns immediately; this daemon handles the fold.
 *
 * Lifecycle:
 *   startup    → check for pre-existing pending watermark (daemon may have been restarted mid-pending)
 *   LIVE loop  → watch fold_config for pending_synthesis CREATE or UPDATE
 *   on trigger → claim work ('running'), fetch embedding, call checkAndSynthesize, reset to 'idle'
 *   on error   → set 'error:message', reset to 'idle' after 30s
 *   SIGTERM/SIGINT → close LIVE subscription and DB connection, exit cleanly
 */

// Load .env before importing lib/ modules (same pattern as synthesis-worker and benchmark scripts)
await loadEnv();

import { getDb, closeDb, query } from "../lib/db.ts";
import { checkAndSynthesize } from "../lib/synthesize.ts";
import { Table } from "surrealdb";

// ============================================================================
// .env loader
// ============================================================================

async function loadEnv(): Promise<void> {
  try {
    const raw = await Deno.readTextFile(new URL("../.env", import.meta.url));
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !Deno.env.get(key)) Deno.env.set(key, val);
    }
  } catch { /* .env optional */ }
}

// ============================================================================
// Logging
// ============================================================================

const log = (msg: string) => console.error(`[anima:synthesis-daemon] ${msg}`);

// ============================================================================
// Mutex guard — one fold at a time
// ============================================================================

// Module-level flag. If a fold is already running when a new trigger arrives,
// skip it. The watermark stays pending — the next LIVE notification handles it.
let synthesisRunning = false;

// ============================================================================
// Fetch trigger embedding — most recent active-tier memory embedding
// ============================================================================

async function fetchTriggerEmbedding(): Promise<number[] | null> {
  try {
    const rows = await query<{ embedding: number[] }>(
      `SELECT embedding, created_at FROM memories
       WHERE tier = 'active' AND deleted_at IS NONE AND embedding IS NOT NONE
       ORDER BY created_at DESC
       LIMIT 1`,
      {},
    );
    return rows[0]?.embedding ?? null;
  } catch (err) {
    log(`Failed to fetch trigger embedding: ${(err as Error).message}`);
    return null;
  }
}

// ============================================================================
// Set the pending_synthesis watermark value
// ============================================================================

async function setWatermark(value: string): Promise<void> {
  try {
    await query(
      `UPDATE fold_config SET value = $value, updated_at = time::now()
       WHERE key = 'pending_synthesis'`,
      { value },
    );
  } catch (err) {
    log(`Failed to set watermark to '${value}': ${(err as Error).message}`);
  }
}

// ============================================================================
// Core fold dispatch — claim work, run synthesis, reset watermark
// ============================================================================

async function dispatchFold(): Promise<void> {
  if (synthesisRunning) {
    log("Synthesis already running — skipping trigger (watermark remains pending)");
    return;
  }

  synthesisRunning = true;
  log("Claiming work — setting watermark to 'running'");

  await setWatermark("running");

  try {
    const embedding = await fetchTriggerEmbedding();

    // checkAndSynthesize expects (newMemoryId, newEmbedding, conversationId)
    // We use a sentinel ID — the daemon trigger is not tied to a specific memory.
    // conversationId is omitted: phi watermark is a cross-conversation pressure event.
    await checkAndSynthesize("__synthesis-daemon__", embedding, undefined);

    log("Fold complete — resetting watermark to 'idle'");
    await setWatermark("idle");
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    log(`Fold error: ${msg} — setting watermark to 'error:...' then 'idle' in 30s`);
    await setWatermark(`error:${msg.slice(0, 200)}`);

    // Reset to idle after 30s so the next trigger is not blocked indefinitely
    setTimeout(async () => {
      await setWatermark("idle");
      log("Watermark reset to 'idle' after error backoff");
    }, 30_000);
  } finally {
    synthesisRunning = false;
  }
}

// ============================================================================
// Startup check — handle pre-existing pending watermark
// ============================================================================

async function checkStartupWatermark(): Promise<void> {
  try {
    const rows = await query<{ value: string }>(
      `SELECT * FROM fold_config WHERE key = 'pending_synthesis' LIMIT 1`,
      {},
    );
    const current = rows[0]?.value ?? "idle";

    if (current.startsWith("pending:")) {
      log(`Startup: found pre-existing watermark '${current}' — dispatching fold immediately`);
      // Dispatch without awaiting — let the LIVE loop start in parallel
      dispatchFold().catch((err) =>
        log(`Startup fold error: ${(err as Error).message}`)
      );
    } else if (current === "running") {
      // A previous daemon instance crashed mid-fold. Reset to idle so the next
      // trigger can proceed. The underlying phi pressure will re-trigger naturally.
      log(`Startup: watermark is 'running' (stale from crashed instance) — resetting to 'idle'`);
      await setWatermark("idle");
    } else {
      log(`Startup: watermark is '${current}' — no immediate action`);
    }
  } catch (err) {
    log(`Startup watermark check failed: ${(err as Error).message}`);
  }
}

// ============================================================================
// fold_config LIVE watcher
// ============================================================================

interface FoldConfigRecord {
  id: string;
  key: string;
  value: string;
}

async function startLiveListener(): Promise<void> {
  const db = await getDb();

  log("Registering LIVE query on fold_config table...");

  // SDK 2.x: db.live(table) returns a Promise<AsyncIterable>
  const subscription = db.live<FoldConfigRecord>(new Table("fold_config"));

  log("LIVE query active — watching for pending_synthesis watermark...");

  for await (const message of await subscription) {
    if (message.action === "KILLED") {
      // The SDK kills the live query on connection disruption.
      // The outer retry loop in the entry point will restart startLiveListener.
      log("LIVE query killed — outer retry loop will reconnect");
      return;
    }

    // Only care about CREATE and UPDATE on the pending_synthesis key
    if (message.action !== "CREATE" && message.action !== "UPDATE") continue;

    const record = message.value as unknown as FoldConfigRecord;
    if (!record) continue;
    if (record.key !== "pending_synthesis") continue;
    if (!record.value?.startsWith("pending:")) continue;

    log(`Watermark triggered: '${record.value}' — dispatching fold`);

    // Dispatch in background — don't block the LIVE loop
    dispatchFold().catch((err) =>
      log(`Fold dispatch error: ${(err as Error).message}`)
    );
  }
}

// ============================================================================
// Resilience — unhandled errors must not kill the daemon
// ============================================================================

self.addEventListener("error", (e) => {
  log(`Uncaught error (survived): ${e.message}`);
  e.preventDefault();
});

self.addEventListener("unhandledrejection", (e) => {
  log(`Unhandled rejection (survived): ${e.reason}`);
  e.preventDefault();
});

// ============================================================================
// Graceful shutdown
// ============================================================================

Deno.addSignalListener("SIGTERM", async () => {
  log("SIGTERM — shutting down gracefully.");
  await closeDb();
  Deno.exit(0);
});

Deno.addSignalListener("SIGINT", async () => {
  log("SIGINT — shutting down.");
  await closeDb();
  Deno.exit(0);
});

// ============================================================================
// Entry point
// ============================================================================

log("Starting synthesis daemon...");

// Ensure connection before any queries
await getDb();

// Handle any watermark that was pending before this process started
await checkStartupWatermark();

// Persistent LIVE loop with exponential backoff on failure
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;
let retries = 0;

while (true) {
  try {
    await startLiveListener();
    // startLiveListener returns normally only if the LIVE query was KILLED
    log("LIVE listener returned — restarting...");
    retries = 0;
  } catch (err) {
    const wait = Math.min(RETRY_BASE_MS * Math.pow(2, retries), RETRY_MAX_MS);
    log(`LIVE listener error: ${(err as Error).message} — retrying in ${wait / 1000}s`);
    retries++;
    await new Promise((r) => setTimeout(r, wait));
  }
}
