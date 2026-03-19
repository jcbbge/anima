/**
 * synthesis-worker/index.ts
 * Anima v2 — The Persistent Synthesis Worker.
 *
 * This process runs continuously, always listening.
 * It never waits to be called. It listens for significance.
 *
 * Three LIVE query triggers (PRD §3.1):
 *   1. φ Accumulation   — total active-tier phi crosses threshold
 *   2. Semantic Conflict — new memory is close to existing but diverges
 *   3. Cluster Emergence — 3+ related memories in 1-hour window
 *
 * When any trigger fires: The Fold runs autonomously.
 *
 * Process management: launchd (~/Library/LaunchAgents/anima.synthesis.plist)
 * Logs: stderr → captured by launchd to ~/Library/Logs/anima-synthesis.log
 *
 * Flags:
 *   --once       Run one synthesis check then exit (for manual/cron use)
 *   --dry-run    Preview what would synthesize — no LLM call, no writes
 */

// Load .env before anything else
await loadEnv();

import { getDb, closeDb, query } from "../lib/db.ts";
import { checkAndSynthesize } from "../lib/synthesize.ts";
import { generateEmbedding, prewarmEmbedding } from "../lib/embed.ts";
import type { Memory } from "../lib/memory.ts";
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
// Config
// ============================================================================

const PHI_THRESHOLD = 15.0;
const CONFLICT_SIMILARITY = 0.85;
const CLUSTER_SIZE = 3;
const CLUSTER_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const ONCE_MODE = Deno.args.includes("--once");
const DRY_RUN = Deno.args.includes("--dry-run");

const log = (msg: string) => console.error(`[anima:worker] ${msg}`);

// ============================================================================
// State
// ============================================================================

// Backpressure: one synthesis at a time across the worker process
let synthesisRunning = false;

// Track which memories we've recently seen to avoid double-triggering
// Maps memory record ID string → timestamp seen
const recentlySeen = new Map<string, number>();
const SEEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function markSeen(id: string): void {
  recentlySeen.set(id, Date.now());
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
// φ accumulation check (on-demand, not via LIVE — runs after each new memory)
// ============================================================================

async function checkPhiTotal(): Promise<{ total: number; triggered: boolean }> {
  const rows = await query<{ resonance_phi: number }>(
    `SELECT resonance_phi FROM memories WHERE tier = 'active' AND deleted_at IS NONE`,
    {},
  );
  const total = rows.reduce((sum, r) => sum + (r.resonance_phi ?? 0), 0);
  return { total, triggered: total >= PHI_THRESHOLD };
}

// ============================================================================
// New memory handler — fires when LIVE query sees a CREATE event
// ============================================================================

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

async function handleNewMemory(record: MemoryLiveRecord): Promise<void> {
  const { id, tier, embedding, conversation_id } = record;

  // Only process active-tier memories — network/stable/thread are already integrated
  if (tier !== "active") return;

  // Skip if we already triggered on this memory
  const idStr = String(id);
  if (isSeen(idStr)) return;
  markSeen(idStr);

  if (synthesisRunning) {
    log(`Synthesis already running — queueing check after current fold completes`);
    return;
  }

  if (DRY_RUN) {
    const phi = await checkPhiTotal();
    log(`[dry-run] New memory ${idStr} | active phi total: ${phi.total.toFixed(1)} (threshold: ${PHI_THRESHOLD})`);
    return;
  }

  log(`New active memory: ${idStr}`);

  // If memory has no embedding in the record, fetch it
  let embeddingVec = embedding && embedding.length > 0 ? embedding : null;

  if (!embeddingVec && record.content) {
    log(`Fetching embedding for memory check...`);
    embeddingVec = await generateEmbedding(record.content);
  }

  synthesisRunning = true;
  try {
    await checkAndSynthesize(idStr, embeddingVec, conversation_id, { skipPhi: true });
  } finally {
    synthesisRunning = false;
  }
}

// ============================================================================
// LIVE query setup — watches memories table for new active-tier entries
// ============================================================================

async function startLiveListener(): Promise<void> {
  const db = await getDb();

  log("Registering LIVE query on memories table...");

  // The SDK's managed live subscription auto-reconnects on DB restart
  const subscription = db.live<MemoryLiveRecord>("memories");

  log("LIVE query active — listening for significance...");

  for await (const message of await subscription) {
    // action: "CREATE" | "UPDATE" | "DELETE" | "KILLED"
    if (message.action === "KILLED") {
      log("LIVE query killed — will be restarted by managed subscription");
      continue;
    }

    if (message.action !== "CREATE") continue;

    const record = message.value as MemoryLiveRecord;
    if (!record) continue;

    // Handle in background — don't block the LIVE loop
    handleNewMemory(record).catch((err) =>
      log(`Error handling new memory: ${(err as Error).message}`)
    );
  }
}

// ============================================================================
// --once mode: single synthesis pass (no LIVE query)
// ============================================================================

async function runOnce(): Promise<void> {
  log("--once mode: running single synthesis pass...");

  const phi = await checkPhiTotal();
  log(`Active phi total: ${phi.total.toFixed(1)} (threshold: ${PHI_THRESHOLD})`);

  if (DRY_RUN) {
    log(`[dry-run] Would check synthesis triggers. phi triggered: ${phi.triggered}`);
    return;
  }

  if (phi.triggered) {
    // Use a sentinel memory ID — phi trigger doesn't need a specific new memory
    synthesisRunning = true;
    try {
      await checkAndSynthesize("__worker_once__", null, undefined, { skipPhi: true });
    } finally {
      synthesisRunning = false;
    }
  } else {
    log(`No synthesis triggered (phi ${phi.total.toFixed(1)} < ${PHI_THRESHOLD})`);
  }
}

// ============================================================================
// Resilience — don't let a crash kill the worker
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

log(`Starting${ONCE_MODE ? " (--once)" : ""}${DRY_RUN ? " (--dry-run)" : ""}...`);

if (ONCE_MODE) {
  await runOnce();
  await closeDb();
  Deno.exit(0);
} else {
  // Ensure DB connection is established before starting listener
  await getDb();

  // Prewarm embedding model to avoid first-request cold penalty
  await prewarmEmbedding();

  // Persistent mode — LIVE query loop with reconnection retry
  const RETRY_BASE_MS = 5_000;
  const RETRY_MAX_MS = 60_000;
  let retries = 0;
  while (true) {
    try {
      await startLiveListener();
      // If startLiveListener returns (LIVE query exhausted), restart
      log("LIVE listener returned — restarting...");
      retries = 0;
    } catch (err) {
      const wait = Math.min(RETRY_BASE_MS * Math.pow(2, retries), RETRY_MAX_MS);
      log(`LIVE listener error: ${(err as Error).message} — retrying in ${wait / 1000}s`);
      retries++;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
