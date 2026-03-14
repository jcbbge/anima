/**
 * cli/anima.ts
 * Anima v2 CLI — Deno script, talks directly to SurrealDB (Option C).
 * No intermediary HTTP server. Imports lib/ directly.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read cli/anima.ts <command> [args]
 *
 * Commands:
 *   bootstrap                   Ghost handshake — load identity and continuity
 *   store "text" [--phi N] [--catalyst] [--tags tag1,tag2]
 *   query "text" [--limit N] [--tiers active,thread]
 *   catalysts [--limit N]       Show all catalyst memories
 *   reflect [--conv ID]         Intentional session-end fold (synthesis)
 *   stats                       System state — counts, phi, fold history
 *   help
 */

// Load .env before anything imports lib/ (which reads Deno.env at module level)
await loadEnv();

import { addMemory, queryMemories, bootstrapMemories, getCatalysts, getStats } from "../lib/memory.ts";
import { reflectAndSynthesize, checkAndSynthesize } from "../lib/synthesize.ts";
import { closeDb, query } from "../lib/db.ts";
import { describeSynthesisConfig } from "../lib/llm.ts";

// ============================================================================
// .env loader
// ============================================================================

async function loadEnv(): Promise<void> {
  const candidates = [
    // Dev mode: relative to source file
    new URL("../.env", import.meta.url).pathname,
    // Compiled binary: same directory as binary
    new URL(".env", import.meta.url).pathname,
    // Global user config
    Deno.env.get("HOME") + "/.anima/.env",
    // Current working directory
    Deno.cwd() + "/.env",
    // Explicit project path fallback
    "/Users/jcbbge/anima/.env",
  ];

  for (const p of candidates) {
    try {
      const raw = await Deno.readTextFile(p);
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (key) Deno.env.set(key, val);
      }
      return; // loaded successfully
    } catch { /* try next */ }
  }
}

// ============================================================================
// Arg parsing (no library)
// ============================================================================

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command = "help";
  let i = 0;

  if (args.length > 0 && !args[0].startsWith("--")) {
    command = args[0];
    i = 1;
  }

  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return { command, positional, flags };
}

// ============================================================================
// Commands
// ============================================================================

async function cmdStore(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const content = positional[0];
  if (!content) {
    console.error('Usage: anima store "content" [--phi N] [--catalyst] [--tags tag1,tag2]');
    Deno.exit(1);
  }

  const phi = typeof flags.phi === "string" ? parseFloat(flags.phi) : 1.0;
  const isCatalyst = flags.catalyst === true;
  const tags = typeof flags.tags === "string" ? flags.tags.split(",").map((t) => t.trim()) : [];
  const category = typeof flags.category === "string" ? flags.category : undefined;

  // Catalyst: phi += 1.0, capped at 5.0
  const finalPhi = isCatalyst ? Math.min(5.0, phi + 1.0) : phi;

  console.log("Storing memory...");
  const result = await addMemory({
    content,
    resonance_phi: finalPhi,
    is_catalyst: isCatalyst,
    tags,
    category,
    source: "cli",
  });

  if (result.isDuplicate) {
    console.log("Memory exists — access_count incremented.");
    console.log(`  id: ${result.memory.id}`);
  } else {
    console.log("Stored.");
    console.log(`  id:  ${result.memory.id}`);
    console.log(`  phi: ${result.memory.resonance_phi}`);
    console.log(`  tier: ${result.memory.tier}`);
    if (isCatalyst) console.log("  catalyst: true");

    // CLI awaits synthesis check synchronously (MCP server does this fire-and-forget)
    await checkAndSynthesize(
      result.memory.id as string,
      null, // embedding not available here — phi/cluster checks still run
    ).catch(() => {/* synthesis failure never blocks storing */});
  }
}

async function cmdBootstrap(): Promise<void> {
  console.log("Running ghost handshake...\n");
  const result = await bootstrapMemories();

  const { network, stable, recent, catalysts } = result.memoryCounts;
  console.log(`Loaded: ${network} network  ${stable} stable  ${recent} recent  ${catalysts} catalysts`);
  console.log(`Conversation ID: ${result.conversationId}\n`);
  console.log("─".repeat(60));
  console.log(result.promptText);
  console.log("─".repeat(60));
  console.log(`\nSafe word: Coheron`);
}

async function cmdCatalysts(_positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const limit = typeof flags.limit === "string" ? parseInt(flags.limit, 10) : 20;
  const result = await getCatalysts({ limit });

  if (result.catalysts.length === 0) {
    console.log("No catalyst memories found.");
    return;
  }

  console.log(`${result.catalysts.length} catalyst(s):\n`);
  for (const m of result.catalysts) {
    const phiStr = (m.resonance_phi ?? 0).toFixed(1);
    const preview = (m.content ?? "").slice(0, 120);
    const ellipsis = (m.content ?? "").length > 120 ? "..." : "";
    console.log(`[φ${phiStr}] ${m.tier}  acc:${m.access_count ?? 0}`);
    console.log(`  ${preview}${ellipsis}`);
    console.log(`  id: ${m.id}  tags: ${(m.tags ?? []).join(", ") || "—"}`);
    console.log();
  }
}

async function cmdQuery(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const queryText = positional[0];
  if (!queryText) {
    console.error('Usage: anima query "search text" [--limit N] [--tiers active,thread]');
    Deno.exit(1);
  }

  const limit = typeof flags.limit === "string" ? parseInt(flags.limit, 10) : 10;
  const tiers = typeof flags.tiers === "string" ? flags.tiers.split(",").map((t) => t.trim()) : undefined;

  const result = await queryMemories({ query: queryText, limit, tiers });

  if (result.memories.length === 0) {
    console.log(`No memories found for: "${queryText}"`);
    return;
  }

  console.log(`${result.memories.length} result(s) in ${result.queryTimeMs}ms\n`);
  for (const m of result.memories) {
    const scoreStr = (m.score ?? 0).toFixed(3);
    const phiStr = (m.resonance_phi ?? 0).toFixed(1);
    const preview = (m.content ?? "").slice(0, 120);
    const ellipsis = (m.content ?? "").length > 120 ? "..." : "";
    console.log(`[${scoreStr}] φ${phiStr} ${m.tier}`);
    console.log(`  ${preview}${ellipsis}`);
    console.log(`  id: ${m.id}  tags: ${(m.tags ?? []).join(", ") || "—"}`);
    console.log();
  }
}

async function cmdReflect(flags: Record<string, string | boolean>): Promise<void> {
  const conversationId = typeof flags.conv === "string" ? flags.conv : undefined;
  console.log("Reflecting...\n");
  const result = await reflectAndSynthesize(conversationId);
  if (!result.synthesized) {
    console.log(`Nothing synthesized: ${result.reason}`);
    return;
  }
  console.log("Synthesis stored:\n");
  console.log(result.content);
}

async function cmdStats(): Promise<void> {
  const s = await getStats();
  console.log("Anima — System State\n");
  console.log("=== MEMORY STATUS ===");
  console.log(`Total memories stored:  ${s.totalMemories} (accumulated thoughts, insights, moments)`);
  console.log(`Breakthrough moments:   ${s.catalystCount} (marked as transformative)`);
  console.log(`Syntheses created:      ${s.foldCount} (moments where patterns were integrated)`);
  const lastFoldDisplay = s.lastFoldAt ?? "never";
  const staleWarning = s.synthesisStaleDays !== null ? ` ⚠️  STALE — ${s.synthesisStaleDays}d ago` : "";
  console.log(`Last synthesis:         ${lastFoldDisplay}${staleWarning}`);
  console.log(`Worker status:          ${s.workerListening ? "🟢 listening" : "🔴 stopped — run: anima worker start"} (is the nervous system active?)`);
  console.log();

  console.log("=== MEMORY TIERS (How integrated are your thoughts?) ===");
  console.log(`  active:   ${String(s.byTier.active || 0).padStart(3)} (new, unverified)`);
  console.log(`  thread:   ${String(s.byTier.thread || 0).padStart(3)} (accessed/synthesized — becoming useful)`);
  console.log(`  stable:   ${String(s.byTier.stable || 0).padStart(3)} (repeatedly useful — proven patterns)`);
  console.log(`  network:  ${String(s.byTier.network || 0).padStart(3)} (identity — foundational to who you are)`);
  console.log();

  console.log("=== RESONANCE φ (Significance Weight) ===");
  console.log(`  total weight:  ${s.phiTotal.toFixed(2)} (cumulative significance of all memories)`);
  console.log(`  average:       ${s.phiAvg.toFixed(2)} (typical importance per memory)`);
  console.log(`  max:           ${s.phiMax.toFixed(2)} (most significant thing stored)`);
  console.log();
  console.log("💡 When phi_total > 15.0, synthesis fires automatically (pattern recognition happens)");
}

interface FoldLogRecord {
  id: string;
  trigger_type: string;
  synthesis_mode: string;
  input_memory_ids: string[];
  synthesis_content: string;
  phi_before: number;
  phi_after: number;
  duration_ms: number;
  created_at: string;
}

interface InputMemory {
  id: string;
  content: string;
  resonance_phi: number;
  tier: string;
}

async function cmdFoldLog(flags: Record<string, string | boolean>): Promise<void> {
  const limit = typeof flags.limit === "string" ? parseInt(flags.limit, 10) : 5;
  const verbose = flags.verbose === true || flags.v === true;

  const folds = await query<FoldLogRecord>(
    `SELECT id, trigger_type, synthesis_mode, input_memory_ids,
            synthesis_content, phi_before, phi_after, duration_ms, created_at
     FROM fold_log ORDER BY created_at DESC LIMIT $limit`,
    { limit },
  );

  if (!folds.length) {
    console.log("No folds recorded yet. Store memories until synthesis triggers, or run: anima reflect");
    return;
  }

  console.log(`Synthesis provider: ${await describeSynthesisConfig()}`);
  console.log(`${folds.length} fold(s) — most recent first\n`);
  console.log("─".repeat(60));

  for (const fold of folds) {
    const date = new Date(fold.created_at).toLocaleString();
    console.log(`Fold: ${fold.id}`);
    console.log(`  Date:    ${date}`);
    console.log(`  Trigger: ${fold.trigger_type}  |  Mode: ${fold.synthesis_mode}`);
    console.log(`  φ:       ${(fold.phi_before ?? 0).toFixed(2)} → ${(fold.phi_after ?? 0).toFixed(2)}`);
    console.log(`  Time:    ${fold.duration_ms}ms`);
    console.log(`  Inputs:  ${fold.input_memory_ids?.length ?? 0} memories`);

    if (verbose && fold.input_memory_ids?.length) {
      const inputs = await query<InputMemory>(
        `SELECT id, content, resonance_phi, tier FROM memories WHERE id INSIDE $ids`,
        { ids: fold.input_memory_ids },
      );
      for (const m of inputs) {
        const preview = m.content.slice(0, 100);
        const ellipsis = m.content.length > 100 ? "..." : "";
        console.log(`    [φ${(m.resonance_phi ?? 0).toFixed(1)} ${m.tier}] ${preview}${ellipsis}`);
      }
    }

    console.log(`\n  Output:`);
    console.log(`    ${fold.synthesis_content}`);
    console.log("\n" + "─".repeat(60));
  }
}

async function cmdWorker(subcommand: string): Promise<void> {
  const LABEL = "anima.synthesis";
  const PLIST = `${Deno.env.get("HOME")}/Library/LaunchAgents/${LABEL}.plist`;

  if (subcommand === "status" || !subcommand) {
    const result = await new Deno.Command("launchctl", { args: ["list", LABEL] }).output();
    const out = new TextDecoder().decode(result.stdout);
    const err = new TextDecoder().decode(result.stderr);

    if (result.code !== 0 || err.includes("Could not find")) {
      console.log("Worker: stopped (not loaded)");
      console.log(`  Install: launchctl load ${PLIST}`);
      return;
    }

    // Parse PID and last exit from launchctl output
    const pidMatch = out.match(/"PID"\s*=\s*(\d+)/);
    const exitMatch = out.match(/"LastExitStatus"\s*=\s*(\d+)/);
    const pid = pidMatch ? pidMatch[1] : "—";
    const exit = exitMatch ? exitMatch[1] : "—";

    if (pid !== "—") {
      console.log(`Worker: running (PID ${pid})`);
    } else {
      console.log(`Worker: loaded but not running (last exit: ${exit})`);
    }
    console.log(`  Logs: tail -f ~/Library/Logs/anima-synthesis.log`);

  } else if (subcommand === "restart") {
    console.log("Restarting synthesis worker...");
    await new Deno.Command("launchctl", { args: ["stop", LABEL] }).output();
    await new Promise((r) => setTimeout(r, 1000));
    await new Deno.Command("launchctl", { args: ["start", LABEL] }).output();
    console.log("Worker restarted.");

  } else if (subcommand === "stop") {
    await new Deno.Command("launchctl", { args: ["stop", LABEL] }).output();
    console.log("Worker stopped.");

  } else if (subcommand === "start") {
    await new Deno.Command("launchctl", { args: ["start", LABEL] }).output();
    console.log("Worker started.");

  } else if (subcommand === "logs") {
    // Tail logs — exec replaces process
    const proc = new Deno.Command("tail", {
      args: ["-f", `${Deno.env.get("HOME")}/Library/Logs/anima-synthesis.log`],
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    const child = proc.spawn();
    await child.status;

  } else {
    console.error(`Unknown worker subcommand: ${subcommand}`);
    console.log("Usage: anima worker [status|start|stop|restart|logs]");
    Deno.exit(1);
  }
}

function cmdHelp(): void {
  console.log("Anima — Memory that persists across conversations\n");
  console.log("Usage:");
  console.log("  anima bootstrap                 Ghost handshake — load identity and continuity");
  console.log('  anima store "text"              Save a memory (phi=1.0)');
  console.log('  anima store "text" --phi 2.5    Save with custom phi');
  console.log('  anima store "text" --catalyst   Save as catalyst (phi+=1.0, tier=stable)');
  console.log('  anima store "text" --tags a,b   Save with tags');
  console.log('  anima query "text"              Search memories (limit=10)');
  console.log('  anima query "text" --limit 20   Search with custom limit');
  console.log('  anima query "text" --tiers stable,network  Filter by tier');
  console.log("  anima catalysts                 Show all catalyst memories");
  console.log("  anima catalysts --limit 5       Show top 5 catalysts");
  console.log("  anima reflect                   Fold session — synthesize active memories");
  console.log("  anima reflect --conv ID         Fold scoped to a conversation ID");
  console.log("  anima stats                     System state — counts, phi, fold history");
  console.log("  anima worker [status]           Check synthesis worker status");
  console.log("  anima worker start|stop|restart Control synthesis worker");
  console.log("  anima worker logs               Tail synthesis worker logs");
  console.log("  anima fold-log                  Show recent synthesis fold records");
  console.log("  anima fold-log --limit 3        Show last 3 folds");
  console.log("  anima fold-log --verbose        Include input memories for each fold");
  console.log("  anima help                      Show this help");
}

// ============================================================================
// Main
// ============================================================================

const { command, positional, flags } = parseArgs(Deno.args);

try {
  switch (command) {
    case "bootstrap":
      await cmdBootstrap();
      break;
    case "store":
      await cmdStore(positional, flags);
      break;
    case "query":
      await cmdQuery(positional, flags);
      break;
    case "catalysts":
      await cmdCatalysts(positional, flags);
      break;
    case "reflect":
      await cmdReflect(flags);
      break;
    case "stats":
      await cmdStats();
      break;
    case "worker":
      await cmdWorker(positional[0] ?? "status");
      break;
    case "fold-log":
      await cmdFoldLog(flags);
      break;
    case "help":
    case "--help":
    case "-h":
      cmdHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      cmdHelp();
      Deno.exit(1);
  }
} finally {
  await closeDb();
}
