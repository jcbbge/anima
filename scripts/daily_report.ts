/**
 * scripts/daily_report.ts
 * Anima daily activity report.
 *
 * Queries every Anima table for records created (or updated) on a given date.
 * Writes a plain text report to workspace/reports/YYYY-MM-DD.txt.
 * Also prints to stdout — pipe, redirect, or read the file, whatever you need.
 *
 * Usage:
 *   deno task report                         # today
 *   deno task report -- 2026-03-13           # specific date
 *
 * Output:
 *   workspace/reports/YYYY-MM-DD.txt
 */

// Load .env before anything else
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
// Date range
// ============================================================================

const dateArg = Deno.args[0]; // e.g. "2026-03-14"
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
// Helpers
// ============================================================================

const lines: string[] = [];

function out(s = "") {
  lines.push(s);
  console.log(s);
}

function section(title: string) {
  out();
  out("═".repeat(60));
  out(`  ${title}`);
  out("═".repeat(60));
}

function sub(title: string) {
  out();
  out(`── ${title}`);
}

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function truncate(s: string | undefined | null, n = 120): string {
  if (!s) return "(empty)";
  const cleaned = s.replace(/\n/g, " ").trim();
  return cleaned.length > n ? cleaned.slice(0, n) + "…" : cleaned;
}

function fmt(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "number") return val.toFixed(3);
  if (typeof val === "boolean") return val ? "yes" : "no";
  if (Array.isArray(val)) return val.length > 0 ? val.join(", ") : "(none)";
  return String(val);
}

// ============================================================================
// Queries
// ============================================================================

async function reportMemories() {
  section("MEMORIES");

  const created = await query<{
    id: string; tier: string; source: string | null; synthesis_mode: string | null;
    resonance_phi: number; tags: string[]; is_catalyst: boolean;
    content: string; created_at: string;
  }>(
    `SELECT id, tier, source, synthesis_mode, resonance_phi, tags, is_catalyst, content, created_at
     FROM memories
     WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"
     ORDER BY created_at ASC`,
    {}
  );

  out(`New memories today: ${created.length}`);

  if (created.length === 0) {
    out("  (none)");
    return;
  }

  // Group by tier
  const byTier: Record<string, typeof created> = {};
  for (const m of created) {
    const t = m.tier ?? "unknown";
    (byTier[t] ??= []).push(m);
  }

  for (const [tier, mems] of Object.entries(byTier)) {
    sub(`tier: ${tier}  (${mems.length})`);
    for (const m of mems) {
      out(`  [${fmt(m.id)}]`);
      out(`    content    : ${truncate(m.content)}`);
      out(`    phi        : ${fmt(m.resonance_phi)}  |  catalyst: ${fmt(m.is_catalyst)}`);
      out(`    source     : ${fmt(m.source)}  |  mode: ${fmt(m.synthesis_mode)}`);
      out(`    tags       : ${fmt(m.tags)}`);
      out(`    created_at : ${fmtDate(m.created_at)}`);
    }
  }
}

async function reportFoldLog() {
  section("FOLD LOG  (synthesis runs)");

  const rows = await query<{
    id: string; trigger_type: string; synthesis_mode: string; synthesis_model: string | null;
    duration_ms: number; phi_before: number; phi_after: number;
    synthesis_content: string; created_at: string;
  }>(
    `SELECT id, trigger_type, synthesis_mode, synthesis_model, duration_ms,
            phi_before, phi_after, synthesis_content, created_at
     FROM fold_log
     WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"
     ORDER BY created_at ASC`,
    {}
  );

  out(`Synthesis runs today: ${rows.length}`);

  if (rows.length === 0) {
    out("  (none — the fold did not fire today)");
    return;
  }

  for (const r of rows) {
    out();
    out(`  [${fmt(r.id)}]`);
    out(`    trigger  : ${fmt(r.trigger_type)}  |  mode: ${fmt(r.synthesis_mode)}`);
    out(`    model    : ${fmt(r.synthesis_model)}`);
    out(`    phi      : ${fmt(r.phi_before)} → ${fmt(r.phi_after)}  |  duration: ${r.duration_ms}ms`);
    out(`    output   : ${truncate(r.synthesis_content)}`);
    out(`    time     : ${fmtDate(r.created_at)}`);
  }
}

async function reportGhostLogs() {
  section("GHOST LOGS  (bootstrap/handshake calls)");

  const rows = await query<{
    id: string; context_type: string; conversation_id: string | null;
    top_phi_values: number[]; created_at: string;
  }>(
    `SELECT id, context_type, conversation_id, top_phi_values, created_at
     FROM ghost_logs
     WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"
     ORDER BY created_at ASC`,
    {}
  );

  out(`Bootstrap calls today: ${rows.length}`);

  if (rows.length === 0) {
    out("  (none — anima_bootstrap was not called today)");
    return;
  }

  for (const r of rows) {
    out(`  [${fmt(r.id)}]  type: ${fmt(r.context_type)}  |  conv: ${fmt(r.conversation_id)}`);
    out(`    top phi values: ${fmt(r.top_phi_values)}`);
    out(`    time: ${fmtDate(r.created_at)}`);
  }
}

async function reportConversationReflections() {
  section("CONVERSATION REFLECTIONS");

  const rows = await query<{
    id: string; conversation_id: string; context_quality: number | null;
    continuity_score: number | null; had_emergence_moment: boolean;
    needed_correction: boolean; surprises: string | null;
    friction_notes: string | null; general_notes: string | null;
    reflected_at: string;
  }>(
    `SELECT id, conversation_id, context_quality, continuity_score, had_emergence_moment,
            needed_correction, surprises, friction_notes, general_notes, reflected_at
     FROM conversation_reflections
     WHERE reflected_at >= <datetime>"${startISO}" AND reflected_at < <datetime>"${endISO}"
     ORDER BY reflected_at ASC`,
    {}
  );

  out(`Reflections today: ${rows.length}`);

  if (rows.length === 0) {
    out("  (none)");
    return;
  }

  for (const r of rows) {
    out(`  [${fmt(r.id)}]  conv: ${fmt(r.conversation_id)}`);
    out(`    quality: ${fmt(r.context_quality)}/10  |  continuity: ${fmt(r.continuity_score)}/10`);
    out(`    emergence: ${fmt(r.had_emergence_moment)}  |  correction needed: ${fmt(r.needed_correction)}`);
    if (r.surprises)    out(`    surprises    : ${truncate(r.surprises)}`);
    if (r.friction_notes) out(`    friction     : ${truncate(r.friction_notes)}`);
    if (r.general_notes)  out(`    notes        : ${truncate(r.general_notes)}`);
    out(`    time: ${fmtDate(r.reflected_at)}`);
  }
}

async function reportMemoryAssociations() {
  section("MEMORY ASSOCIATIONS  (co-occurrence graph)");

  const created = await query<{ id: string; strength: number; co_occurrence_count: number; created_at: string }>(
    `SELECT id, strength, co_occurrence_count, created_at
     FROM memory_associations
     WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"
     ORDER BY created_at ASC`,
    {}
  );

  const updated = await query<{ id: string; strength: number; co_occurrence_count: number; updated_at: string }>(
    `SELECT id, strength, co_occurrence_count, updated_at
     FROM memory_associations
     WHERE updated_at >= <datetime>"${startISO}" AND updated_at < <datetime>"${endISO}"
       AND created_at < <datetime>"${startISO}"
     ORDER BY updated_at ASC`,
    {}
  );

  out(`New associations today: ${created.length}`);
  out(`Updated associations today: ${updated.length}`);

  if (created.length > 0) {
    sub("New");
    for (const r of created) {
      out(`  [${fmt(r.id)}]  strength: ${fmt(r.strength)}  |  co_occurrence: ${r.co_occurrence_count}  |  created: ${fmtDate(r.created_at)}`);
    }
  }
  if (updated.length > 0) {
    sub("Updated");
    for (const r of updated) {
      out(`  [${fmt(r.id)}]  strength: ${fmt(r.strength)}  |  co_occurrence: ${r.co_occurrence_count}  |  updated: ${fmtDate(r.updated_at)}`);
    }
  }
}

async function reportFoldConfig() {
  section("FOLD CONFIG  (any changes today)");

  const rows = await query<{ key: string; value: string; description: string | null; updated_at: string }>(
    `SELECT key, value, description, updated_at
     FROM fold_config
     WHERE updated_at >= <datetime>"${startISO}" AND updated_at < <datetime>"${endISO}"
     ORDER BY updated_at ASC`,
    {}
  );

  out(`Config changes today: ${rows.length}`);

  if (rows.length === 0) {
    out("  (no config changes)");
    return;
  }

  for (const r of rows) {
    out(`  ${r.key} = ${r.value}`);
    out(`    ${fmt(r.description)}`);
    out(`    updated: ${fmtDate(r.updated_at)}`);
  }
}

async function reportTotals() {
  section("TOTALS  (all-time snapshot)");

  const tables = ["memories", "fold_log", "ghost_logs", "conversation_reflections", "memory_associations", "fold_config"];
  for (const t of tables) {
    const rows = await query<{ count: number }>(`SELECT count() AS count FROM ${t} GROUP ALL`, {});
    const count = rows[0]?.count ?? 0;
    out(`  ${t.padEnd(30)} ${count} records`);
  }

  // Memory tier breakdown
  const tiers = await query<{ tier: string; count: number }>(
    `SELECT tier, count() AS count FROM memories WHERE deleted_at IS NONE GROUP BY tier`,
    {}
  );
  out();
  out("  Memory tiers (live):");
  for (const t of tiers) {
    out(`    ${String(t.tier).padEnd(12)} ${t.count}`);
  }
}

// ============================================================================
// Main
// ============================================================================

out(`ANIMA DAILY REPORT`);
out(`Date: ${dateLabel}  (UTC range: ${startISO} → ${endISO})`);
out(`Generated: ${new Date().toISOString()}`);

await reportMemories();
await reportFoldLog();
await reportGhostLogs();
await reportConversationReflections();
await reportMemoryAssociations();
await reportFoldConfig();
await reportTotals();

out();
out("─".repeat(60));
out("END OF REPORT");
out("─".repeat(60));

// ============================================================================
// Write to file
// ============================================================================

const reportDir = new URL("../workspace/reports/", import.meta.url).pathname;
const reportPath = join(reportDir, `${dateLabel}.txt`);
await Deno.writeTextFile(reportPath, lines.join("\n") + "\n");
console.error(`\n[report] Written to ${reportPath}`);

await closeDb();
