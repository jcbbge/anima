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
import { generateEmbedding } from "../lib/embed.ts";
import { checkAndSynthesize, performFold } from "../lib/synthesize.ts";
import type { Memory } from "../lib/memory.ts";
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
// Watchdog — catches pending watermarks missed by zombie LIVE queries
// Fires every 5 minutes. If watermark has been pending for >2 minutes, dispatch.
// ============================================================================

const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WATCHDOG_STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

function startWatchdog(): void {
  setInterval(async () => {
    try {
      const rows = await query<{ value: string; updated_at: string }>(
        `SELECT \`value\`, updated_at FROM fold_config WHERE key = 'pending_synthesis' LIMIT 1`,
        {},
      );
      const row = rows[0];
      if (!row?.value?.startsWith("pending:")) return;

      const staleness = Date.now() - new Date(row.updated_at).getTime();
      if (staleness < WATCHDOG_STALE_THRESHOLD_MS) return;

      log(`Watchdog: pending watermark '${row.value}' stale for ${Math.round(staleness / 1000)}s — dispatching fold`);
      dispatchFold().catch((err) =>
        log(`Watchdog fold error: ${(err as Error).message}`)
      );
    } catch (err) {
      log(`Watchdog check failed: ${(err as Error).message}`);
    }
  }, WATCHDOG_INTERVAL_MS);
}

// ============================================================================
// Mutex guard — one fold at a time
// ============================================================================

// Shared module-level lock. If a fold is already running when a new trigger arrives,
// skip it. The watermark stays pending — the next LIVE notification handles it.
// Kept as an object so handlers can receive explicit shared state by reference.
interface SynthesisLock {
  running: boolean;
}

const synthesisLock: SynthesisLock = { running: false };
interface MemoryLiveRecord {
  id: string;
  content: string;
  resonance_phi: number;
  confidence: number;
  tier: string;
  tags: string[];
  embedding?: number[];
  conversation_id?: string;
  created_at: string;
}

// Track which memories we've recently seen to avoid double-triggering
// Maps memory record ID string → timestamp seen
const recentlySeen = new Map<string, number>();
const SEEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function markSeen(id: string): void {
  recentlySeen.set(id, Date.now());

  // Opportunistic TTL cleanup to bound map size over long daemon uptime
  const now = Date.now();
  for (const [seenId, seenAt] of recentlySeen.entries()) {
    if (now - seenAt > SEEN_TTL_MS) {
      recentlySeen.delete(seenId);
    }
  }
}

function isSeen(id: string): boolean {
  const t = recentlySeen.get(id);
  if (!t) return false;
  if (Date.now() - t > SEEN_TTL_MS) {
    recentlySeen.delete(id);
    return false;
  }
  return true;
}

// ============================================================================
// Set the pending_synthesis watermark value
// ============================================================================
async function setWatermark(value: string): Promise<void> {
  await query(
    `UPDATE fold_config SET value = $value, updated_at = time::now()
     WHERE key = 'pending_synthesis'`,
    { value },
  );
}

// ============================================================================
// Core fold dispatch — claim work, run synthesis, reset watermark
// ============================================================================

async function dispatchFold(lock: SynthesisLock = synthesisLock): Promise<void> {
  if (lock.running) {
    log("Synthesis already running — skipping trigger (watermark remains pending)");
    return;
  }

  lock.running = true;
  log("Claiming work — setting watermark to 'running'");
  await setWatermark("running");

  try {
    const windowRow = await query<{ value: string }>(
      "SELECT `value` FROM fold_config WHERE key = 'recently_folded_window_minutes' LIMIT 1",
      {},
    );
    const windowMs = parseInt(windowRow[0]?.value ?? "30", 10) * 60 * 1000;
    const recentCutoff = new Date(Date.now() - windowMs).toISOString();
    const maxRow = await query<{ value: string }>(
      "SELECT `value` FROM fold_config WHERE key = 'fold_max_memories' LIMIT 1",
      {},
    );
    const maxMemories = parseInt(maxRow[0]?.value ?? "5", 10);

    const memories = await query<Memory>(
      `SELECT id, content, resonance_phi, confidence, tier, tags, created_at, last_accessed
       FROM memories
       WHERE tier = 'active' AND deleted_at IS NONE
       AND (last_folded_at IS NONE OR last_folded_at < <datetime>$cutoff)
       ORDER BY resonance_phi DESC
       LIMIT $maxMemories`,
      { cutoff: recentCutoff, maxMemories }
    );

    if (memories.length >= 3) {
      await performFold({ trigger: "phi_threshold", memories, conversationId: undefined });
    } else {
      log(`Not enough active memories for fold (${memories.length} < 3) — resetting watermark`);
    }

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
    lock.running = false;
    try {
      await setWatermark("idle");
      log("Watermark reset to 'idle'");
    } catch (err) {
      log(`WARN: Failed to reset watermark to idle — watchdog will recover: ${(err as Error).message}`);
    }
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
// memories LIVE watcher (semantic conflict + cluster triggers)
// ============================================================================

async function handleNewMemory(
  record: MemoryLiveRecord,
  lock: SynthesisLock = synthesisLock,
): Promise<void> {
  const { id, tier, embedding, conversation_id } = record;
  // Only process active-tier memories
  if (tier !== "active") return;

  const idStr = String(id);

  // Skip if we already triggered on this memory
  if (isSeen(idStr)) return;
  markSeen(idStr);

  // Shared mutex with watermark path to avoid overlapping folds
  if (lock.running) {
    log(`Synthesis already running — skipping memory trigger (${idStr})`);
    return;
  }
  // If memory has no embedding in the record, fetch it
  let embeddingVec = embedding && embedding.length > 0 ? embedding : null;
  if (!embeddingVec && record.content) {
    log(`Fetching embedding for memory trigger (${idStr})...`);
    embeddingVec = await generateEmbedding(record.content);
  }

  lock.running = true;
  try {
    await checkAndSynthesize(idStr, embeddingVec, conversation_id, { skipPhi: true });
  } finally {
    lock.running = false;
  }
}

async function startMemoryLiveListener(): Promise<void> {
  const db = await getDb();
  log("Registering LIVE query on memories table...");

  // SDK 2.x: db.live(table) returns a Promise<AsyncIterable>
  const subscription = db.live<MemoryLiveRecord>(new Table("memories"));

  log("LIVE query active — listening for new memories...");

  for await (const message of await subscription) {
    if (message.action === "KILLED") {
      log("Memory LIVE query killed — outer retry loop will reconnect");
      return;
    }

    if (message.action !== "CREATE") continue;

    const record = message.value as unknown as MemoryLiveRecord;
    if (!record) continue;
    if (record.tier !== "active") continue;

    // Handle in background — don't block the LIVE loop
    handleNewMemory(record).catch((err) =>
      log(`Error handling new memory: ${(err as Error).message}`)
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

// Watchdog catches any pending watermarks the LIVE query missed
startWatchdog();

// Persistent LIVE loops with independent exponential backoff on failure
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

async function runFoldConfigListenerLoop(): Promise<void> {
  let retries = 0;

  while (true) {
    try {
      await startLiveListener();
      // startLiveListener returns normally only if the LIVE query was KILLED
      log("fold_config LIVE listener returned — restarting...");
      retries = 0;
    } catch (err) {
      const wait = Math.min(RETRY_BASE_MS * Math.pow(2, retries), RETRY_MAX_MS);
      log(`fold_config LIVE listener error: ${(err as Error).message} — retrying in ${wait / 1000}s`);
      retries++;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function runMemoryListenerLoop(): Promise<void> {
  let retries = 0;

  while (true) {
    try {
      await startMemoryLiveListener();
      // startMemoryLiveListener returns normally only if the LIVE query was KILLED
      log("memories LIVE listener returned — restarting...");
      retries = 0;
    } catch (err) {
      const wait = Math.min(RETRY_BASE_MS * Math.pow(2, retries), RETRY_MAX_MS);
      log(`memories LIVE listener error: ${(err as Error).message} — retrying in ${wait / 1000}s`);
      retries++;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

await Promise.all([
  runFoldConfigListenerLoop(),
  runMemoryListenerLoop(),
]);