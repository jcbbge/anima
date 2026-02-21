/**
 * cli/anima.ts
 * Anima v2 CLI — Deno script, talks directly to SurrealDB (Option C).
 * No intermediary HTTP server. Imports lib/ directly.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read cli/anima.ts <command> [args]
 *
 * Commands (Phase 1):
 *   store "text" [--phi N] [--catalyst] [--tags tag1,tag2]
 *   query "text" [--limit N] [--tiers active,thread]
 *   help
 */

// Load .env before anything imports lib/ (which reads Deno.env at module level)
await loadEnv();

import { addMemory, queryMemories } from "../lib/memory.ts";
import { closeDb } from "../lib/db.ts";

// ============================================================================
// .env loader
// ============================================================================

async function loadEnv(): Promise<void> {
  try {
    const envPath = new URL("../.env", import.meta.url);
    const raw = await Deno.readTextFile(envPath);
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !Deno.env.get(key)) {
        Deno.env.set(key, val);
      }
    }
  } catch {
    // .env optional
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

function cmdHelp(): void {
  console.log("Anima — Memory that persists across conversations\n");
  console.log("Usage:");
  console.log('  anima store "text"              Save a memory (phi=1.0)');
  console.log('  anima store "text" --phi 2.5    Save with custom phi');
  console.log('  anima store "text" --catalyst   Save as catalyst (phi+=1.0, tier=stable)');
  console.log('  anima store "text" --tags a,b   Save with tags');
  console.log('  anima query "text"              Search memories (limit=10)');
  console.log('  anima query "text" --limit 20   Search with custom limit');
  console.log('  anima query "text" --tiers stable,network  Filter by tier');
  console.log("  anima help                      Show this help");
}

// ============================================================================
// Main
// ============================================================================

const { command, positional, flags } = parseArgs(Deno.args);

try {
  switch (command) {
    case "store":
      await cmdStore(positional, flags);
      break;
    case "query":
      await cmdQuery(positional, flags);
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
