/**
 * lib/daily.ts
 * Daily diagnostics core logic — imported by CLI and standalone script
 */

import { query, closeDb } from "./db.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

// ============================================================================
// Types
// ============================================================================

export type Tier = "active" | "thread" | "stable" | "network";

export type DailyMetrics = {
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

export type Anomaly = {
  severity: "critical" | "warning" | "info";
  component: string;
  message: string;
  recommendation: string;
};

export type HealthScore = {
  overall: number;
  components: Record<string, number>;
};

export type ReportOptions = {
  dateArg?: string;
  showContext?: boolean;
  showDetail?: boolean;
  healthCheck?: boolean;
  anomaliesOnly?: boolean;
  jsonMode?: boolean;
  noColor?: boolean;
};

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

function color(c: keyof typeof C, text: string, noColor: boolean) {
  return noColor ? text : `${C[c]}${text}${C.reset}`;
}

// ============================================================================
// Data Fetching
// ============================================================================

export async function fetchMetrics(startISO: string, endISO: string): Promise<DailyMetrics> {
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

export function detectAnomalies(m: DailyMetrics): Anomaly[] {
  const anomalies: Anomaly[] = [];

  if (m.memories.total === 0) {
    anomalies.push({
      severity: "critical",
      component: "Metabolism",
      message: "Zero memories created today",
      recommendation: "Check MCP wiring — anima_store may not be called",
    });
  }

  if (m.memories.total > 0 && m.ghostLogs.total === 0) {
    anomalies.push({
      severity: "critical",
      component: "Continuity",
      message: "New memories exist but no bootstrap calls detected",
      recommendation: "anima_bootstrap not called — check harness configuration",
    });
  }

  if (m.associations.created > 1000) {
    anomalies.push({
      severity: "warning",
      component: "Cross-Connection",
      message: `Unusual association volume: ${m.associations.created.toLocaleString()} (typical: <100)`,
      recommendation: "Investigate trigger — may indicate bulk import or tag explosion",
    });
  }

  if (m.memories.total > 10 && m.foldLog.total === 0) {
    anomalies.push({
      severity: "warning",
      component: "Synthesis",
      message: "High memory creation but no synthesis cycles",
      recommendation: "Check synthesis worker — may be stuck or misconfigured",
    });
  }

  if (m.memories.total > 0 && m.reflections.total === 0) {
    anomalies.push({
      severity: "warning",
      component: "Self-Awareness",
      message: "No session reflections recorded",
      recommendation: "anima_session_close not being called — add to session end flow",
    });
  }

  if (m.memories.avgPhi < 2.0 && m.memories.total > 0) {
    anomalies.push({
      severity: "info",
      component: "Metabolism",
      message: `Low average phi: ${m.memories.avgPhi.toFixed(2)} (threshold: 2.0)`,
      recommendation: "Consider reviewing content significance or lowering threshold",
    });
  }

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

export function calculateHealth(m: DailyMetrics, anomalies: Anomaly[]): HealthScore {
  const hasCritical = anomalies.some((a) => a.severity === "critical");
  const hasWarning = anomalies.some((a) => a.severity === "warning");

  const metabolism = Math.min(100, m.memories.total * 5);
  const synthesis = m.foldLog.total > 0 ? Math.min(100, m.foldLog.total * 20) : 0;
  const continuity = m.ghostLogs.total > 0 ? Math.min(100, m.ghostLogs.total * 25) : 0;
  const associations = Math.min(100, Math.max(0, 100 - (m.associations.created - 100) / 10));

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

function severityIcon(s: Anomaly["severity"], noColor: boolean): string {
  return s === "critical" ? color("red", "✗", noColor) : s === "warning" ? color("yellow", "⚠", noColor) : color("blue", "ℹ", noColor);
}

function statusLabel(score: number, noColor: boolean): string {
  if (score >= 80) return color("green", "EXCELLENT", noColor);
  if (score >= 60) return color("green", "HEALTHY", noColor);
  if (score >= 40) return color("yellow", "FAIR", noColor);
  if (score >= 20) return color("yellow", "DEGRADED", noColor);
  return color("red", "CRITICAL", noColor);
}

// ============================================================================
// Narrative
// ============================================================================

export function generateNarrative(m: DailyMetrics): string {
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
// Rendering
// ============================================================================

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

function renderGlance(m: DailyMetrics, anomalies: Anomaly[], health: HealthScore, dateLabel: string, noColor: boolean): string[] {
  const lines: string[] = [];
  const out = (s = "") => lines.push(s);

  const border = color("gray", "┌" + "─".repeat(63) + "┐", noColor);
  const borderEnd = color("gray", "└" + "─".repeat(63) + "┘", noColor);

  out(border);
  out(
    color("gray", "│", noColor) +
    color("bold", "  ANIMA DAILY DIAGNOSTICS".padEnd(31), noColor) +
    color("dim", `${dateLabel}  ${new Date().toISOString().slice(11, 16)} UTC`.padStart(28), noColor) +
    color("gray", "│", noColor)
  );
  out(color("gray", "├" + "─".repeat(63) + "┤", noColor));

  // Overall health
  out(color("gray", "│", noColor) + "                                                     " + color("gray", "│", noColor));
  const overallLine = `  OVERALL ${bar(health.overall, 24)}  ${health.overall.toString().padStart(3)}  ${statusLabel(health.overall, noColor)}`;
  out(color("gray", "│", noColor) + overallLine.padEnd(63) + color("gray", "│", noColor));
  out(color("gray", "│", noColor) + "                                                     " + color("gray", "│", noColor));

  // Components
  const components = [
    { name: "Metabolism", score: health.components.metabolism, label: m.memories.total > 0 ? "ACTIVE" : "STALLED" },
    { name: "Synthesis", score: health.components.synthesis, label: m.foldLog.total > 0 ? "HEALTHY" : "IDLE" },
    { name: "Continuity", score: health.components.continuity, label: m.ghostLogs.total > 0 ? "STABLE" : "BROKEN" },
    { name: "Associations", score: health.components.associations, label: m.associations.created > 1000 ? "HEAVY" : "NORMAL" },
  ];

  for (const c of components) {
    const line = `  ├─ ${c.name.padEnd(10)} ${bar(c.score, 18)}  ${c.score.toString().padStart(3)}  ${c.label}`;
    out(color("gray", "│", noColor) + line.padEnd(63) + color("gray", "│", noColor));
  }

  out(color("gray", "│", noColor) + "                                                     " + color("gray", "│", noColor));

  // Anomalies
  const criticalCount = anomalies.filter((a) => a.severity === "critical").length;
  const warningCount = anomalies.filter((a) => a.severity === "warning").length;

  if (anomalies.length === 0) {
    out(color("gray", "│", noColor) + color("green", "  ✓  No anomalies detected — all systems nominal       ", noColor) + color("gray", "│", noColor));
  } else {
    const anomalyLine = `  ANOMALIES: ${criticalCount > 0 ? color("red", `${criticalCount} critical`, noColor) : ""} ${warningCount > 0 ? color("yellow", `${warningCount} warning`, noColor) : ""}`;
    out(color("gray", "│", noColor) + anomalyLine.padEnd(63 + (criticalCount > 0 ? 10 : 0) + (warningCount > 0 ? 10 : 0)) + color("gray", "│", noColor));

    for (const a of anomalies.slice(0, 2)) {
      const icon = severityIcon(a.severity, noColor);
      const msg = `${icon}  ${a.message.slice(0, 52)}`;
      out(color("gray", "│", noColor) + "  " + msg.padEnd(61) + color("gray", "│", noColor));
    }
    if (anomalies.length > 2) {
      out(color("gray", "│", noColor) + color("dim", `  ... and ${anomalies.length - 2} more`.padEnd(61), noColor) + color("gray", "│", noColor));
    }
  }

  out(color("gray", "│", noColor) + "                                                     " + color("gray", "│", noColor));

  // Narrative
  const narrative = generateNarrative(m);
  const words = narrative.split(" ");
  let line = "  ";
  for (const word of words) {
    if ((line + word).length > 61) {
      out(color("gray", "│", noColor) + line.padEnd(63) + color("gray", "│", noColor));
      line = "  " + word + " ";
    } else {
      line += word + " ";
    }
  }
  if (line.trim()) {
    out(color("gray", "│", noColor) + line.padEnd(63) + color("gray", "│", noColor));
  }

  out(color("gray", "│", noColor) + "                                                     " + color("gray", "│", noColor));
  out(color("gray", "│", noColor) + color("dim", "  Run with --context for insights, --detail for records", noColor) + color("gray", "│", noColor));
  out(color("gray", "│", noColor) + "                                                     " + color("gray", "│", noColor));
  out(borderEnd);

  return lines;
}

// ============================================================================
// Context View
// ============================================================================

async function renderContext(m: DailyMetrics, anomalies: Anomaly[], targetDate: Date, startISO: string, noColor: boolean): Promise<string[]> {
  const lines: string[] = [];
  const out = (s = "") => lines.push(s);

  out(color("bold", "\n  CONTEXTUAL INSIGHTS\n", noColor));
  out(color("gray", "  " + "─".repeat(61), noColor));

  // 7-day averages
  const sevenDaysAgo = new Date(targetDate);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const sevenDaysISO = sevenDaysAgo.toISOString();

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

  out("\n  " + color("bold", "Activity vs 7-Day Average", noColor));
  out("  " + color("gray", "─".repeat(40), noColor));

  const comparisons = [
    { metric: "Memories", today: m.memories.total, avg: weekAvg },
    { metric: "Synthesis", today: m.foldLog.total, avg: weekFoldAvg },
    { metric: "Reflections", today: m.reflections.total, avg: 0 },
  ];

  for (const c of comparisons) {
    const diff = c.today - c.avg;
    const pct = c.avg > 0 ? ((diff / c.avg) * 100) : 0;
    const indicator = diff > 0 ? color("green", "▲", noColor) : diff < 0 ? color("yellow", "▼", noColor) : color("gray", "─", noColor);
    const pctStr = `${Math.abs(pct).toFixed(0)}%`;
    out(`  ${c.metric.padEnd(12)} ${c.today.toString().padStart(4)} vs ${c.avg.toFixed(1).padStart(5)} avg  ${indicator} ${pctStr.padStart(4)}`);
  }

  out("\n  " + color("bold", "Quality Metrics", noColor));
  out("  " + color("gray", "─".repeat(40), noColor));
  out(`  Avg Memory Phi        ${m.memories.avgPhi.toFixed(2).padStart(6)}  ${m.memories.avgPhi > 3 ? color("green", "●", noColor) : color("yellow", "●", noColor)}`);
  out(`  Avg Reflection Qty   ${m.reflections.avgQuality.toFixed(1).padStart(6)}/10  ${m.reflections.avgQuality > 7 ? color("green", "●", noColor) : color("yellow", "●", noColor)}`);
  out(`  Avg Continuity        ${m.reflections.avgContinuity.toFixed(1).padStart(6)}/10  ${m.reflections.avgContinuity > 7 ? color("green", "●", noColor) : color("yellow", "●", noColor)}`);
  out(`  Emergence Moments     ${m.reflections.emergenceCount.toString().padStart(6)}  ${m.reflections.emergenceCount > 0 ? color("cyan", "✨", noColor) : color("gray", "─", noColor)}`);

  if (m.foldLog.total > 0) {
    out("\n  " + color("bold", "Synthesis Breakdown", noColor));
    out("  " + color("gray", "─".repeat(40), noColor));
    for (const [trigger, count] of Object.entries(m.foldLog.byTrigger)) {
      out(`  ${trigger.padEnd(20)} ${count.toString().padStart(4)} runs`);
    }
    out(`  Net Phi Delta        ${(m.foldLog.netPhiDelta > 0 ? "+" : "").padStart(6)}${m.foldLog.netPhiDelta.toFixed(2)}`);
  }

  out("\n  " + color("bold", "Memory Tier Distribution", noColor));
  out("  " + color("gray", "─".repeat(40), noColor));
  for (const [tier, count] of Object.entries(m.memories.byTier)) {
    if (count > 0) {
      const pct = ((count / m.memories.total) * 100).toFixed(0);
      const barViz = color("cyan", "█".repeat(Math.round(Number(pct) / 5)), noColor);
      out(`  ${tier.padEnd(12)} ${count.toString().padStart(4)}  ${barViz} ${pct}%`);
    }
  }

  if (m.associations.created > 0) {
    out("\n  " + color("bold", "Cross-Connection Activity", noColor));
    out("  " + color("gray", "─".repeat(40), noColor));
    out(`  New associations      ${m.associations.created.toLocaleString().padStart(6)}`);
    out(`  Strengthened          ${m.associations.updated.toLocaleString().padStart(6)}`);
    out(`  Per memory ratio      ${m.associations.avgPerMemory.toFixed(1).padStart(6)}x`);
    if (m.associations.avgPerMemory > 50) {
      out(color("yellow", "  ⚠ High ratio suggests tag explosion or bulk operation", noColor));
    }
  }

  if (anomalies.length > 0) {
    out("\n  " + color("bold", "Anomaly Details & Recommendations", noColor));
    out("  " + color("gray", "─".repeat(61), noColor));
    for (const a of anomalies) {
      out(`\n  ${severityIcon(a.severity, noColor)}  ${color("bold", a.component, noColor)}: ${a.message}`);
      out(`     ${color("cyan", "→", noColor)} ${a.recommendation}`);
    }
  }

  out("");
  return lines;
}

// ============================================================================
// JSON Output
// ============================================================================

function renderJSON(m: DailyMetrics, anomalies: Anomaly[], health: HealthScore, dateLabel: string): string {
  return JSON.stringify({
    date: dateLabel,
    generatedAt: new Date().toISOString(),
    metrics: m,
    health,
    anomalies,
    summary: {
      status: health.overall >= 60 ? "healthy" : health.overall >= 30 ? "degraded" : "critical",
      narrative: generateNarrative(m),
    },
  }, null, 2);
}

// ============================================================================
// Main Runner
// ============================================================================

export async function runDailyReport(options: ReportOptions): Promise<{ output: string; exitCode: number }> {
  const noColor = options.noColor || false;

  // Parse date
  const targetDate = options.dateArg ? new Date(options.dateArg + "T00:00:00Z") : (() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  })();

  const startISO = targetDate.toISOString();
  const end = new Date(targetDate);
  end.setUTCDate(end.getUTCDate() + 1);
  const endISO = end.toISOString();
  const dateLabel = startISO.slice(0, 10);

  // Fetch data
  const metrics = await fetchMetrics(startISO, endISO);
  const anomalies = detectAnomalies(metrics);
  const health = calculateHealth(metrics, anomalies);

  // Route to appropriate view
  let output = "";
  let exitCode = 0;

  if (options.jsonMode) {
    output = renderJSON(metrics, anomalies, health, dateLabel);
  } else if (options.healthCheck) {
    const critical = anomalies.filter((a) => a.severity === "critical").length;
    const warning = anomalies.filter((a) => a.severity === "warning").length;

    if (critical > 0) {
      output = `CRITICAL: ${critical} critical anomalies detected`;
      exitCode = 2;
    } else if (warning > 0) {
      output = `WARNING: ${warning} warnings detected`;
      exitCode = 1;
    } else {
      output = "HEALTHY: All systems nominal";
      exitCode = 0;
    }
  } else if (options.anomaliesOnly) {
    if (anomalies.length === 0) {
      output = color("green", "✓ No anomalies detected", noColor);
    } else {
      const lines = anomalies.map((a) => `${severityIcon(a.severity, noColor)}  [${a.severity.toUpperCase()}] ${a.component}: ${a.message}`);
      output = lines.join("\n");
    }
  } else {
    // Default: glance view, optionally with context
    const lines = renderGlance(metrics, anomalies, health, dateLabel, noColor);

    if (options.showContext || options.showDetail) {
      const ctxLines = await renderContext(metrics, anomalies, targetDate, startISO, noColor);
      lines.push(...ctxLines);
    }

    output = lines.join("\n");
  }

  const reportDir = new URL("../../workspace/reports/", import.meta.url).pathname;
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

  return { output, exitCode };
}