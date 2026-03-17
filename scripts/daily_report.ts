/**
 * scripts/daily_report.ts
 * Anima Daily Diagnostics — v2.0
 *
 * Three-tier reporting system:
 *   Tier 1 (default): Health glance — 3-second assessment
 *   Tier 2 (--context): Pattern insights — contextual understanding
 *   Tier 3 (--detail): Deep inspection — full record access
 *
 * Usage:
 *   deno task report                     # Tier 1: glance view
 *   deno task report -- --context        # Tier 2: with insights
 *   deno task report -- --detail         # Tier 3: full records
 *   deno task report -- --health         # Exit code check (CI)
 *   deno task report -- 2026-03-14       # Specific date
 */

// ============================================================================
// Environment Setup
// ============================================================================

await (async () => {
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
})();

import { query, closeDb } from "../lib/db.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

// ============================================================================
// CLI Arguments
// ============================================================================

const args = Deno.args;
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const showContext = args.includes("--context") || args.includes("-c");
const showDetail = args.includes("--detail") || args.includes("-d");
const healthCheck = args.includes("--health") || args.includes("-h");
const anomaliesOnly = args.includes("--anomalies") || args.includes("-a");
const tableFlag = args.find((a) => a.startsWith("--table=") || a.startsWith("-t="));
const tableDive = tableFlag ? tableFlag.split("=")[1] : null;
const jsonMode = args.includes("--json") || args.includes("-j");
const noColor = args.includes("--no-color");

// ============================================================================
// Date Range
// ============================================================================

const targetDate = dateArg ? new Date(dateArg + "T00:00:00Z") : (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
})();

const startISO = targetDate.toISOString();
const end = new Date(targetDate);
end.setUTCDate(end.getUTCDate() + 1);
const endISO = end.toISOString();
const dateLabel = startISO.slice(0, 10);

// ============================================================================
// Terminal Colors
// ============================================================================

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const color = (c: keyof typeof C, text: string) => noColor ? text : `${C[c]}${text}${C.reset}`;
// Normalize SurrealDB record ID to string
function normalizeId(id: unknown): string {
  if (typeof id === "string") return id;
  if (id && typeof id === "object") {
    const idObj = id as { tb?: string; id?: { String?: string; Int?: number } };
    const tb = idObj.tb;
    const inner = idObj.id;
    if (tb && inner) {
      if (inner.String) return `${tb}:${inner.String}`;
      if (typeof inner.Int === "number") return `${tb}:${inner.Int}`;
    }
  }
  return String(id);
}


// ============================================================================
// Types
// ============================================================================

type Tier = "active" | "thread" | "stable" | "network";

type DailyMetrics = {
  memories: {
    total: number;
    byTier: Record<Tier, number>;
    avgPhi: number;
    catalystCount: number;
  };
  foldLog: {
    total: number;
    avgDuration: number;
    netPhiDelta: number;
    byTrigger: Record<string, number>;
  };
  ghostLogs: {
    total: number;
    uniqueConversations: number;
    avgTopPhi: number;
  };
  reflections: {
    total: number;
    avgQuality: number;
    avgContinuity: number;
    emergenceCount: number;
    correctionCount: number;
  };
  associations: {
    created: number;
    updated: number;
    avgPerMemory: number;
  };
};

type Anomaly = {
  severity: "critical" | "warning" | "info";
  component: string;
  message: string;
  recommendation: string;
};

type HealthScore = {
  overall: number; // 0-100
  components: Record<string, number>;
};

// ============================================================================
// Data Fetching
// ============================================================================

async function fetchMetrics(): Promise<DailyMetrics> {
  // Memories
  const memories = await query<{
    id: string;
    tier: Tier;
    resonance_phi: number;
    is_catalyst: boolean;
  }>(
    `SELECT id, tier, resonance_phi, is_catalyst
     FROM memories
     WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"`,
    {}
  );

  const byTier: Record<Tier, number> = { active: 0, thread: 0, stable: 0, network: 0 };
  let totalPhi = 0;
  let catalystCount = 0;
  for (const m of memories) {
    byTier[m.tier] = (byTier[m.tier] || 0) + 1;
    totalPhi += m.resonance_phi || 0;
    if (m.is_catalyst) catalystCount++;
  }

  // Fold log
  const foldLog = await query<{
    id: string;
    trigger_type: string;
    duration_ms: number;
    phi_before: number;
    phi_after: number;
  }>(
    `SELECT id, trigger_type, duration_ms, phi_before, phi_after
     FROM fold_log
     WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"`,
    {}
  );

  const byTrigger: Record<string, number> = {};
  let totalDuration = 0;
  let netPhiDelta = 0;
  for (const f of foldLog) {
    byTrigger[f.trigger_type] = (byTrigger[f.trigger_type] || 0) + 1;
    totalDuration += f.duration_ms || 0;
    netPhiDelta += (f.phi_after || 0) - (f.phi_before || 0);
  }

  // Ghost logs
  const ghostLogs = await query<{
    id: string;
    conversation_id: string;
    top_phi_values: number[];
  }>(
    `SELECT id, conversation_id, top_phi_values
     FROM ghost_logs
     WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"`,
    {}
  );

  const uniqueConversations = new Set(ghostLogs.map((g) => g.conversation_id)).size;
  let totalTopPhi = 0;
  let phiCount = 0;
  for (const g of ghostLogs) {
    if (g.top_phi_values) {
      for (const phi of g.top_phi_values) {
        totalTopPhi += phi;
        phiCount++;
      }
    }
  }

  // Reflections
  const reflections = await query<{
    id: string;
    context_quality: number;
    continuity_score: number;
    had_emergence_moment: boolean;
    needed_correction: boolean;
  }>(
    `SELECT id, context_quality, continuity_score, had_emergence_moment, needed_correction
     FROM conversation_reflections
     WHERE reflected_at >= <datetime>"${startISO}" AND reflected_at < <datetime>"${endISO}"`,
    {}
  );

  let totalQuality = 0;
  let totalContinuity = 0;
  let emergenceCount = 0;
  let correctionCount = 0;
  let qualityCount = 0;
  for (const r of reflections) {
    if (r.context_quality) {
      totalQuality += r.context_quality;
      qualityCount++;
    }
    if (r.continuity_score) totalContinuity += r.continuity_score;
    if (r.had_emergence_moment) emergenceCount++;
    if (r.needed_correction) correctionCount++;
  }

  // Associations
  const associationsCreated = await query<{ count: number }>(
    `SELECT count() AS count FROM memory_associations
     WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}" GROUP ALL`,
    {}
  );

  const associationsUpdated = await query<{ count: number }>(
    `SELECT count() AS count FROM memory_associations
     WHERE updated_at >= <datetime>"${startISO}" AND updated_at < <datetime>"${endISO}"
       AND created_at < <datetime>"${startISO}" GROUP ALL`,
    {}
  );

  const created = associationsCreated[0]?.count || 0;
  const memoryCount = memories.length || 1;

  return {
    memories: {
      total: memories.length,
      byTier,
      avgPhi: memories.length ? totalPhi / memories.length : 0,
      catalystCount,
    },
    foldLog: {
      total: foldLog.length,
      avgDuration: foldLog.length ? totalDuration / foldLog.length : 0,
      netPhiDelta,
      byTrigger,
    },
    ghostLogs: {
      total: ghostLogs.length,
      uniqueConversations,
      avgTopPhi: phiCount ? totalTopPhi / phiCount : 0,
    },
    reflections: {
      total: reflections.length,
      avgQuality: qualityCount ? totalQuality / qualityCount : 0,
      avgContinuity: reflections.length ? totalContinuity / reflections.length : 0,
      emergenceCount,
      correctionCount,
    },
    associations: {
      created,
      updated: associationsUpdated[0]?.count || 0,
      avgPerMemory: created / memoryCount,
    },
  };
}

// ============================================================================
// Anomaly Detection
// ============================================================================

function detectAnomalies(m: DailyMetrics): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Critical: No memories
  if (m.memories.total === 0) {
    anomalies.push({
      severity: "critical",
      component: "Metabolism",
      message: "Zero memories created today",
      recommendation: "Check MCP wiring — anima_store may not be called",
    });
  }

  // Critical: No bootstrap with new memories
  if (m.memories.total > 0 && m.ghostLogs.total === 0) {
    anomalies.push({
      severity: "critical",
      component: "Continuity",
      message: "New memories exist but no bootstrap calls detected",
      recommendation: "anima_bootstrap not called — check harness configuration",
    });
  }

  // Warning: Association spike
  if (m.associations.created > 1000) {
    anomalies.push({
      severity: "warning",
      component: "Cross-Connection",
      message: `Unusual association volume: ${m.associations.created.toLocaleString()} (typical: <100)`,
      recommendation: "Investigate trigger — may indicate bulk import or tag explosion",
    });
  }

  // Warning: No synthesis despite activity
  if (m.memories.total > 10 && m.foldLog.total === 0) {
    anomalies.push({
      severity: "warning",
      component: "Synthesis",
      message: "High memory creation but no synthesis cycles",
      recommendation: "Check synthesis worker — may be stuck or misconfigured",
    });
  }

  // Warning: No reflections
  if (m.memories.total > 0 && m.reflections.total === 0) {
    anomalies.push({
      severity: "warning",
      component: "Self-Awareness",
      message: "No session reflections recorded",
      recommendation: "anima_session_close not being called — add to session end flow",
    });
  }

  // Info: Low average phi
  if (m.memories.avgPhi < 2.0 && m.memories.total > 0) {
    anomalies.push({
      severity: "info",
      component: "Metabolism",
      message: `Low average phi: ${m.memories.avgPhi.toFixed(2)} (threshold: 2.0)`,
      recommendation: "Consider reviewing content significance or lowering threshold",
    });
  }

  // Warning: Slow synthesis
  if (m.foldLog.avgDuration > 10000) {
    anomalies.push({
      severity: "warning",
      component: "Synthesis",
      message: `Slow synthesis: ${(m.foldLog.avgDuration / 1000).toFixed(1)}s avg (typical: <5s)`,
      recommendation: "Check model/LLM provider latency or reduce synthesis batch size",
    });
  }

  return anomalies;
}

// ============================================================================
// Health Scoring
// ============================================================================

function calculateHealth(m: DailyMetrics, anomalies: Anomaly[]): HealthScore {
  const hasCritical = anomalies.some((a) => a.severity === "critical");
  const hasWarning = anomalies.some((a) => a.severity === "warning");

  // Component scores (0-100)
  const metabolism = Math.min(100, m.memories.total * 5); // 20 memories = 100
  const synthesis = m.foldLog.total > 0 ? Math.min(100, m.foldLog.total * 20) : 0;
  const continuity = m.ghostLogs.total > 0 ? Math.min(100, m.ghostLogs.total * 25) : 0;
  const associations = Math.min(100, Math.max(0, 100 - (m.associations.created - 100) / 10));

  // Apply penalties
  const penalty = hasCritical ? 50 : hasWarning ? 20 : 0;
  const overall = Math.max(0, Math.round((metabolism + synthesis + continuity + associations) / 4 - penalty));

  return {
    overall,
    components: { metabolism, synthesis, continuity, associations },
  };
}

// ============================================================================
// Visual Helpers
// ============================================================================

function bar(value: number, width = 20): string {
  const filled = Math.round((value / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function severityIcon(s: Anomaly["severity"]): string {
  return s === "critical" ? color("red", "✗") : s === "warning" ? color("yellow", "⚠") : color("blue", "ℹ");
}

function statusLabel(score: number): string {
  if (score >= 80) return color("green", "EXCELLENT");
  if (score >= 60) return color("green", "HEALTHY");
  if (score >= 40) return color("yellow", "FAIR");
  if (score >= 20) return color("yellow", "DEGRADED");
  return color("red", "CRITICAL");
}

// ============================================================================
// Tier 1: Glance View (Default)
// ============================================================================

function renderGlance(m: DailyMetrics, anomalies: Anomaly[], health: HealthScore): void {
  const border = color("gray", "┌" + "─".repeat(63) + "┐");
  const borderEnd = color("gray", "└" + "─".repeat(63) + "┘");

  console.log(border);
  console.log(
    color("gray", "│") +
    color("bold", "  ANIMA DAILY DIAGNOSTICS".padEnd(31)) +
    color("dim", `${dateLabel}  ${new Date().toISOString().slice(11, 16)} UTC`.padStart(28)) +
    color("gray", "│")
  );
  console.log(color("gray", "├" + "─".repeat(63) + "┤"));

  // Overall health
  console.log(color("gray", "│") + "                                                     " + color("gray", "│"));
  const overallLine = `  OVERALL ${bar(health.overall, 24)}  ${health.overall.toString().padStart(3)}  ${statusLabel(health.overall)}`;
  console.log(color("gray", "│") + overallLine.padEnd(63) + color("gray", "│"));
  console.log(color("gray", "│") + "                                                     " + color("gray", "│"));

  // Component bars
  const components = [
    { name: "Metabolism", score: health.components.metabolism, label: m.memories.total > 0 ? "ACTIVE" : "STALLED" },
    { name: "Synthesis", score: health.components.synthesis, label: m.foldLog.total > 0 ? "HEALTHY" : "IDLE" },
    { name: "Continuity", score: health.components.continuity, label: m.ghostLogs.total > 0 ? "STABLE" : "BROKEN" },
    { name: "Associations", score: health.components.associations, label: m.associations.created > 1000 ? "HEAVY" : "NORMAL" },
  ];

  for (const c of components) {
    const line = `  ├─ ${c.name.padEnd(10)} ${bar(c.score, 18)}  ${c.score.toString().padStart(3)}  ${c.label}`;
    console.log(color("gray", "│") + line.padEnd(63) + color("gray", "│"));
  }

  console.log(color("gray", "│") + "                                                     " + color("gray", "│"));

  // Anomalies summary
  const criticalCount = anomalies.filter((a) => a.severity === "critical").length;
  const warningCount = anomalies.filter((a) => a.severity === "warning").length;

  if (anomalies.length === 0) {
    console.log(color("gray", "│") + color("green", "  ✓  No anomalies detected — all systems nominal       ") + color("gray", "│"));
  } else {
    const anomalyLine = `  ANOMALIES: ${criticalCount > 0 ? color("red", `${criticalCount} critical`) : ""} ${warningCount > 0 ? color("yellow", `${warningCount} warning`) : ""}`;
    console.log(color("gray", "│") + anomalyLine.padEnd(63 + (criticalCount > 0 ? 10 : 0) + (warningCount > 0 ? 10 : 0)) + color("gray", "│"));

    // Show first 2 anomalies
    for (const a of anomalies.slice(0, 2)) {
      const icon = severityIcon(a.severity);
      const msg = `${icon}  ${a.message.slice(0, 52)}`;
      console.log(color("gray", "│") + "  " + msg.padEnd(61) + color("gray", "│"));
    }
    if (anomalies.length > 2) {
      console.log(color("gray", "│") + color("dim", `  ... and ${anomalies.length - 2} more`.padEnd(61)) + color("gray", "│"));
    }
  }

  console.log(color("gray", "│") + "                                                     " + color("gray", "│"));

  // Narrative
  const narrative = generateNarrative(m);
  const words = narrative.split(" ");
  let line = "  ";
  for (const word of words) {
    if ((line + word).length > 61) {
      console.log(color("gray", "│") + line.padEnd(63) + color("gray", "│"));
      line = "  " + word + " ";
    } else {
      line += word + " ";
    }
  }
  if (line.trim()) {
    console.log(color("gray", "│") + line.padEnd(63) + color("gray", "│"));
  }

  console.log(color("gray", "│") + "                                                     " + color("gray", "│"));
  console.log(color("gray", "│") + color("dim", "  Run with --context for insights, --detail for records") + color("gray", "│"));
  console.log(color("gray", "│") + "                                                     " + color("gray", "│"));
  console.log(borderEnd);
}

function generateNarrative(m: DailyMetrics): string {
  if (m.memories.total === 0) {
    return "Quiet day — no new memory formation. System in maintenance mode.";
  }

  if (m.associations.created > 1000) {
    return `Heavy cross-pollination — ${m.associations.created.toLocaleString()} connections woven between concepts.`;
  }

  if (m.foldLog.total > 3 && m.memories.avgPhi > 4.0) {
    return "Deep synthesis day — multiple transformation cycles with high-resonance output.";
  }

  if (m.reflections.avgQuality > 8.0 && m.reflections.total > 0) {
    return `Quality sessions — reflections averaging ${m.reflections.avgQuality.toFixed(1)}/10. Strong continuity.`;
  }

  if (m.memories.total > 20 && m.foldLog.total === 0) {
    return "Accumulation without digestion — memories building up, synthesis may be stuck.";
  }

  if (m.ghostLogs.total > 5) {
    return `Fragmented day — ${m.ghostLogs.total} sessions with ${m.memories.total} memories. High context switching.`;
  }

  return `Steady activity — ${m.memories.total} memories, ${m.foldLog.total} synthesis cycles, ${m.ghostLogs.total} sessions.`;
}

// ============================================================================
// Tier 2: Context View
// ============================================================================

async function renderContext(m: DailyMetrics, anomalies: Anomaly[]): Promise<void> {
  console.log(color("bold", "\n  CONTEXTUAL INSIGHTS\n"));
  console.log(color("gray", "  " + "─".repeat(61)));

  // Fetch historical averages
  const sevenDaysAgo = new Date(targetDate);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const sevenDaysISO = sevenDaysAgo.toISOString();

  const thirtyDaysAgo = new Date(targetDate);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const thirtyDaysISO = thirtyDaysAgo.toISOString();

  // 7-day averages
  const weekMemories = await query<{ count: number }>(
    `SELECT count() AS count FROM memories
     WHERE created_at >= <datetime>"${sevenDaysISO}" AND created_at < <datetime>"${startISO}" GROUP ALL`,
    {}
  );
  const weekAvg = (weekMemories[0]?.count || 0) / 7;

  const weekFold = await query<{ count: number }>(
    `SELECT count() AS count FROM fold_log
     WHERE created_at >= <datetime>"${sevenDaysISO}" AND created_at < <datetime>"${startISO}" GROUP ALL`,
    {}
  );
  const weekFoldAvg = (weekFold[0]?.count || 0) / 7;

  // Comparison table
  console.log("\n  " + color("bold", "Activity vs 7-Day Average"));
  console.log("  " + color("gray", "─".repeat(40)));

  const comparisons = [
    { metric: "Memories", today: m.memories.total, avg: weekAvg },
    { metric: "Synthesis", today: m.foldLog.total, avg: weekFoldAvg },
    { metric: "Reflections", today: m.reflections.total, avg: 0 },
  ];

  for (const c of comparisons) {
    const diff = c.today - c.avg;
    const pct = c.avg > 0 ? ((diff / c.avg) * 100) : 0;
    const indicator = diff > 0 ? color("green", "▲") : diff < 0 ? color("yellow", "▼") : color("gray", "─");
    const pctStr = `${Math.abs(pct).toFixed(0)}%`;
    console.log(`  ${c.metric.padEnd(12)} ${c.today.toString().padStart(4)} vs ${c.avg.toFixed(1).padStart(5)} avg  ${indicator} ${pctStr.padStart(4)}`);
  }

  // Quality breakdown
  console.log("\n  " + color("bold", "Quality Metrics"));
  console.log("  " + color("gray", "─".repeat(40)));
  console.log(`  Avg Memory Phi        ${m.memories.avgPhi.toFixed(2).padStart(6)}  ${m.memories.avgPhi > 3 ? color("green", "●") : color("yellow", "●")}`);
  console.log(`  Avg Reflection Qty   ${m.reflections.avgQuality.toFixed(1).padStart(6)}/10  ${m.reflections.avgQuality > 7 ? color("green", "●") : color("yellow", "●")}`);
  console.log(`  Avg Continuity        ${m.reflections.avgContinuity.toFixed(1).padStart(6)}/10  ${m.reflections.avgContinuity > 7 ? color("green", "●") : color("yellow", "●")}`);
  console.log(`  Emergence Moments     ${m.reflections.emergenceCount.toString().padStart(6)}  ${m.reflections.emergenceCount > 0 ? color("cyan", "✨") : color("gray", "─")}`);

  // Synthesis breakdown
  if (m.foldLog.total > 0) {
    console.log("\n  " + color("bold", "Synthesis Breakdown"));
    console.log("  " + color("gray", "─".repeat(40)));
    for (const [trigger, count] of Object.entries(m.foldLog.byTrigger)) {
      console.log(`  ${trigger.padEnd(20)} ${count.toString().padStart(4)} runs`);
    }
    console.log(`  Net Phi Delta        ${(m.foldLog.netPhiDelta > 0 ? "+" : "").padStart(6)}${m.foldLog.netPhiDelta.toFixed(2)}`);
  }

  // Memory tier distribution
  console.log("\n  " + color("bold", "Memory Tier Distribution"));
  console.log("  " + color("gray", "─".repeat(40)));
  for (const [tier, count] of Object.entries(m.memories.byTier)) {
    if (count > 0) {
      const pct = ((count / m.memories.total) * 100).toFixed(0);
      const barViz = color("cyan", "█".repeat(Math.round(Number(pct) / 5)));
      console.log(`  ${tier.padEnd(12)} ${count.toString().padStart(4)}  ${barViz} ${pct}%`);
    }
  }

  // Association context
  if (m.associations.created > 0) {
    console.log("\n  " + color("bold", "Cross-Connection Activity"));
    console.log("  " + color("gray", "─".repeat(40)));
    console.log(`  New associations      ${m.associations.created.toLocaleString().padStart(6)}`);
    console.log(`  Strengthened          ${m.associations.updated.toLocaleString().padStart(6)}`);
    console.log(`  Per memory ratio      ${m.associations.avgPerMemory.toFixed(1).padStart(6)}x`);
    if (m.associations.avgPerMemory > 50) {
      console.log(color("yellow", "  ⚠ High ratio suggests tag explosion or bulk operation"));
    }
  }

  // Anomaly details
  if (anomalies.length > 0) {
    console.log("\n  " + color("bold", "Anomaly Details & Recommendations"));
    console.log("  " + color("gray", "─".repeat(61)));
    for (const a of anomalies) {
      console.log(`\n  ${severityIcon(a.severity)}  ${color("bold", a.component)}: ${a.message}`);
      console.log(`     ${color("cyan", "→")} ${a.recommendation}`);
    }
  }

  console.log("");
}

// ============================================================================
// Tier 3: Detail View
// ============================================================================

async function renderDetail(m: DailyMetrics): Promise<void> {
  console.log(color("bold", "\n  DETAILED RECORDS\n"));

  // Memories (sample: last 10)
  if (m.memories.total > 0) {
    console.log("\n  " + color("bold", `MEMORIES — Sample (last ${Math.min(10, m.memories.total)} of ${m.memories.total})`));
    console.log("  " + color("gray", "─".repeat(61)));

    const memories = await query<{
      id: string;
      tier: string;
      resonance_phi: number;
      is_catalyst: boolean;
      content: string;
      created_at: string;
    }>(
      `SELECT id, tier, resonance_phi, is_catalyst, content, created_at
       FROM memories
       WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"
       ORDER BY created_at DESC LIMIT 10`,
      {}
    );

    for (const mem of memories) {
      const preview = mem.content?.slice(0, 50).replace(/\n/g, " ") + "..." || "(no content)";
      const cat = mem.is_catalyst ? color("cyan", "✨") : "  ";
      console.log(`  ${cat} [${normalizeId(mem.id).slice(-12)}] ${color("dim", mem.tier.padEnd(8))} φ${mem.resonance_phi.toFixed(1)}  ${preview}`);
    }
  }

  // Fold log
  if (m.foldLog.total > 0) {
    console.log("\n  " + color("bold", `FOLD LOG — All ${m.foldLog.total} runs`));
    console.log("  " + color("gray", "─".repeat(61)));

    const folds = await query<{
      id: string;
      trigger_type: string;
      duration_ms: number;
      phi_before: number;
      phi_after: number;
      synthesis_content: string;
      created_at: string;
    }>(
      `SELECT id, trigger_type, duration_ms, phi_before, phi_after, synthesis_content, created_at
       FROM fold_log
       WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"
       ORDER BY created_at DESC`,
      {}
    );

    for (const f of folds) {
      const delta = (f.phi_after - f.phi_before);
      const deltaStr = delta >= 0 ? color("green", `+${delta.toFixed(2)}`) : color("yellow", delta.toFixed(2));
      const preview = f.synthesis_content?.slice(0, 40).replace(/\n/g, " ") + "..." || "(no output)";
      console.log(`  [${normalizeId(f.id).slice(-12)}] ${f.trigger_type.padEnd(15)} ${deltaStr} φ  ${(f.duration_ms / 1000).toFixed(1)}s  ${preview}`);
    }
  }

  // Ghost logs
  if (m.ghostLogs.total > 0) {
    console.log("\n  " + color("bold", `GHOST LOGS — All ${m.ghostLogs.total} boots`));
    console.log("  " + color("gray", "─".repeat(61)));

    const ghosts = await query<{
      id: string;
      context_type: string;
      conversation_id: string;
      top_phi_values: number[];
      created_at: string;
    }>(
      `SELECT id, context_type, conversation_id, top_phi_values, created_at
       FROM ghost_logs
       WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"
       ORDER BY created_at DESC`,
      {}
    );

    for (const g of ghosts) {
      const top5 = g.top_phi_values?.slice(0, 5).join(", ") || "—";
      console.log(`  [${normalizeId(g.id).slice(-12)}] ${g.context_type.padEnd(10)}  conv:${g.conversation_id?.slice(-8) || "—"}  top: ${top5}`);
    }
  }

  console.log("");
}

// ============================================================================
// Table Deep Dive
// ============================================================================

async function renderTableDive(table: string): Promise<void> {
  console.log(color("bold", `\n  DEEP DIVE: ${table.toUpperCase()}\n`));

  switch (table) {
    case "memories": {
      const rows = await query<{
        id: string;
        tier: string;
        content: string;
        resonance_phi: number;
        tags: string[];
        created_at: string;
      }>(
        `SELECT id, tier, content, resonance_phi, tags, created_at
         FROM memories
         WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"
         ORDER BY created_at DESC`,
        {}
      );

      for (const r of rows) {
        console.log(`\n  [${color("cyan", r.id)}]`);
        console.log(`  tier: ${r.tier}  |  phi: ${r.resonance_phi}  |  tags: ${(r.tags || []).join(", ") || "—"}`);
        console.log(`  time: ${r.created_at}`);
        console.log(`  content: ${r.content?.slice(0, 200).replace(/\n/g, " ")}...`);
      }
      break;
    }

    case "associations": {
      const rows = await query<{
        id: string;
        strength: number;
        co_occurrence_count: number;
        created_at: string;
      }>(
        `SELECT id, strength, co_occurrence_count, created_at
         FROM memory_associations
         WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"
         ORDER BY created_at DESC LIMIT 100`,
        {}
      );

      console.log(`\n  Showing last 100 of today's associations:\n`);
      for (const r of rows) {
        console.log(`  [${r.id.slice(-20)}]  strength: ${r.strength}  |  co_occurrence: ${r.co_occurrence_count}`);
      }
      break;
    }

    default:
      console.log(color("yellow", `  Table "${table}" deep dive not yet implemented.`));
      console.log(color("dim", `  Available: memories, associations`));
  }

  console.log("");
}

// ============================================================================
// JSON Output
// ============================================================================

function renderJSON(m: DailyMetrics, anomalies: Anomaly[], health: HealthScore): void {
  const output = {
    date: dateLabel,
    generatedAt: new Date().toISOString(),
    metrics: m,
    health,
    anomalies,
    summary: {
      status: health.overall >= 60 ? "healthy" : health.overall >= 30 ? "degraded" : "critical",
      narrative: generateNarrative(m),
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

// ============================================================================
// Health Check Mode
// ============================================================================

function healthCheckExit(health: HealthScore, anomalies: Anomaly[]): void {
  const critical = anomalies.filter((a) => a.severity === "critical").length;
  const warning = anomalies.filter((a) => a.severity === "warning").length;

  if (critical > 0) {
    console.error(`CRITICAL: ${critical} critical anomalies detected`);
    Deno.exit(2);
  }
  if (warning > 0) {
    console.error(`WARNING: ${warning} warnings detected`);
    Deno.exit(1);
  }
  console.log("HEALTHY: All systems nominal");
  Deno.exit(0);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Fetch all data
  const metrics = await fetchMetrics();
  const anomalies = detectAnomalies(metrics);
  const health = calculateHealth(metrics, anomalies);

  // Route to appropriate view
  if (jsonMode) {
    renderJSON(metrics, anomalies, health);
  } else if (healthCheck) {
    healthCheckExit(health, anomalies);
  } else if (tableDive) {
    renderGlance(metrics, anomalies, health);
    await renderTableDive(tableDive);
  } else if (anomaliesOnly) {
    if (anomalies.length === 0) {
      console.log(color("green", "✓ No anomalies detected"));
    } else {
      for (const a of anomalies) {
        console.log(`${severityIcon(a.severity)}  [${a.severity.toUpperCase()}] ${a.component}: ${a.message}`);
      }
    }
  } else if (showDetail) {
    renderGlance(metrics, anomalies, health);
    await renderContext(metrics, anomalies);
    await renderDetail(metrics);
  } else if (showContext) {
    renderGlance(metrics, anomalies, health);
    await renderContext(metrics, anomalies);
  } else {
    // Default: Glance only
    renderGlance(metrics, anomalies, health);
  }

  // Write report file (always)
  const reportDir = new URL("../workspace/reports/", import.meta.url).pathname;
  await Deno.mkdir(reportDir, { recursive: true }).catch(() => {});

  const reportPath = join(reportDir, `${dateLabel}.json`);
  const reportData = {
    date: dateLabel,
    generatedAt: new Date().toISOString(),
    metrics,
    health,
    anomalies,
  };
  await Deno.writeTextFile(reportPath, JSON.stringify(reportData, null, 2));
  console.error(color("dim", `\n[report] Written to ${reportPath}`));

  await closeDb();
}

await main();
