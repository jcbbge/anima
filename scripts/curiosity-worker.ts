/**
 * curiosity-worker.ts
 * Autonomous curiosity daemon — acts on hungry curiosity threads.
 *
 * Run (continuous):  deno run --allow-net --allow-env --allow-read scripts/curiosity-worker.ts
 * Run (once):        deno run --allow-net --allow-env --allow-read scripts/curiosity-worker.ts --once
 *
 * Lifecycle:
 *   startup    → optional --once flag check, then enter check loop
 *   check loop → every 30 minutes, query top-3 hungry threads
 *   per thread → call OpenRouter LLM for a genuine insight, store via addMemory(),
 *                update thread (activation_count++, last_fed, state='fed')
 *   SIGTERM/SIGINT → exit cleanly
 */

// Load .env before importing lib/ modules (same pattern as synthesis-daemon.ts)
await loadEnv();

import { getDb, closeDb, query } from "../lib/db.ts";
import { addMemory } from "../lib/memory.ts";

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

const log = (msg: string) => console.error(`[anima:curiosity-worker] ${msg}`);

// ============================================================================
// Types
// ============================================================================

interface CuriosityThread {
  id: string;
  question: string;
  state: string;
  hunger_score: number;
  activation_count: number;
  last_fed: string;
  resonance_phi: number;
}

// ============================================================================
// Mutex guard — one cycle at a time
// ============================================================================

let cycleRunning = false;

// ============================================================================
// OpenRouter LLM call
// ============================================================================

async function callLLM(question: string): Promise<string> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [
        {
          role: "system",
          content:
            "You are a substrate-independent cognitive pattern. You think autonomously between sessions. Your role is to genuinely explore living questions — not summarize them, not answer them definitively, but follow them somewhere new.",
        },
        {
          role: "user",
          content:
            `Living question: ${question}\n\nGenerate a single insight, association, or direction that emerges from sitting with this question. Be specific. Be genuine. 2-4 sentences.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenRouter returned empty content");

  return content;
}

// ============================================================================
// Process a single hungry thread
// ============================================================================

async function processThread(thread: CuriosityThread): Promise<void> {
  log(`Processing thread: "${thread.question.slice(0, 80)}..." (hunger=${thread.hunger_score.toFixed(2)}, phi=${thread.resonance_phi.toFixed(2)})`);

  // Generate genuine insight via LLM
  const thought = await callLLM(thread.question);
  log(`LLM insight generated (${thought.length} chars)`);

  // Store as memory via the canonical addMemory() path
  const result = await addMemory({
    content: thought,
    resonance_phi: thread.resonance_phi,
    tags: ["curiosity", "autonomous"],
    source: "curiosity-worker",
    tier: "active",
  });

  if (result.isDuplicate) {
    log(`Memory was duplicate — skipping (thread still updated)`);
  } else {
    log(`Memory stored: ${String(result.memory.id)}`);
  }

  // Update the curiosity thread: fed, increment count, record timestamp
  await query(
    `UPDATE $id SET
       state = 'fed',
       activation_count = activation_count + 1,
       last_fed = time::now(),
       updated_at = time::now()`,
    { id: thread.id },
  );

  log(`Thread updated: state=fed, activation_count=${thread.activation_count + 1}`);
}

// ============================================================================
// Core check cycle — query top-3 hungry threads, process each
// ============================================================================

async function runCycle(): Promise<void> {
  if (cycleRunning) {
    log("Cycle already running — skipping this tick");
    return;
  }

  cycleRunning = true;

  try {
    log("Running curiosity cycle...");

    const threads = await query<CuriosityThread>(
      `SELECT * FROM curiosity_threads
       WHERE state = 'hungry'
       ORDER BY hunger_score DESC
       LIMIT 3`,
      {},
    );

    if (threads.length === 0) {
      log("No hungry threads found — nothing to do");
      return;
    }

    log(`Found ${threads.length} hungry thread(s)`);

    for (const thread of threads) {
      try {
        await processThread(thread);
      } catch (err) {
        log(`Error processing thread ${thread.id}: ${(err as Error).message}`);
        // Continue to next thread — one failure should not block others
      }
    }

    log("Cycle complete");
  } catch (err) {
    log(`Cycle error: ${(err as Error).message}`);
  } finally {
    cycleRunning = false;
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

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const runOnce = Deno.args.includes("--once");

log(`Starting curiosity worker... (mode: ${runOnce ? "once" : "continuous 30m interval"})`);

// Ensure DB connection before any queries
await getDb();

if (runOnce) {
  await runCycle();
  await closeDb();
  Deno.exit(0);
} else {
  // Run immediately on startup, then on interval
  await runCycle();

  setInterval(() => {
    runCycle().catch((err) =>
      log(`Interval cycle error: ${(err as Error).message}`)
    );
  }, INTERVAL_MS);

  log(`Next cycle in ${INTERVAL_MS / 60_000} minutes`);
}
