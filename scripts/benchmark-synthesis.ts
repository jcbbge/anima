/**
 * scripts/benchmark-synthesis.ts
 * Synthesis quality benchmark — compare models against real fold_log data.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read scripts/benchmark-synthesis.ts
 *   deno run --allow-net --allow-env --allow-read scripts/benchmark-synthesis.ts --folds 5
 *   deno run --allow-net --allow-env --allow-read scripts/benchmark-synthesis.ts --folds 3 --no-grader
 *
 * What it does:
 *   1. Reads the last N fold_log records from SurrealDB (real inputs + existing output)
 *   2. Re-runs synthesis on each input set through each configured candidate model
 *   3. Sends all candidates (including original) to a grader model for structured scoring
 *   4. Prints a comparison table: model × fold → scores
 *
 * Candidate models are configured via BENCHMARK_CANDIDATES env var (JSON array)
 * or fall back to the defaults below.
 *
 * Grader: GRADER_PROVIDER / GRADER_MODEL (defaults configured in lib/llm.ts)
 */

// Load .env before importing lib/
await loadEnv();

import { query } from "../lib/db.ts";
import { closeDb } from "../lib/db.ts";
import { buildSynthesisMessages } from "../lib/synthesize.ts";
import { callLLMRaw, callGraderLLM, describeGraderConfig } from "../lib/llm.ts";
import type { LLMConfig } from "../lib/llm.ts";

// ============================================================================
// .env loader (mirrors cli/anima.ts)
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
      if (key && !Deno.env.get(key)) Deno.env.set(key, val);
    }
  } catch { /* .env optional */ }
}

// ============================================================================
// Types
// ============================================================================

interface FoldRecord {
  id: string;
  trigger_type: string;
  synthesis_mode: "analysis" | "recognition";
  input_memory_ids: string[];
  synthesis_content: string;   // original output
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

interface CandidateResult {
  config: LLMConfig;
  label: string;
  output: string | null;
  durationMs: number;
  error?: string;
}

interface GradeResult {
  synthesis_vs_summary: number;  // 0-3: does it find what memories point AT, not just recap them?
  more_than_sum: number;         // 0-3: genuinely new insight vs. aggregate?
  pattern_voice: number;         // 0-3: sounds like the pattern speaking to itself?
  precision_brevity: number;     // 0-2: tight, not padded?
  total: number;                 // /11
  reasoning: string;
}

interface FoldBenchmark {
  fold: FoldRecord;
  inputs: InputMemory[];
  candidates: CandidateResult[];
  grades: Map<string, GradeResult | null>;
}

// ============================================================================
// Default candidate configs
// ============================================================================

const DEFAULT_CANDIDATES: LLMConfig[] = [
  { model: "google/gemma-3-12b-it:free", temperature: 0.7, maxTokens: 200 },
  { model: "google/gemma-3-27b-it:free", temperature: 0.7, maxTokens: 200 },
  { model: "meta-llama/llama-3.3-70b-instruct:free", temperature: 0.7, maxTokens: 200 },
  { model: "mistralai/mistral-small-3.1-24b-instruct:free", temperature: 0.7, maxTokens: 200 },
  { model: "deepseek/deepseek-r1-distill-llama-70b:free", temperature: 0.7, maxTokens: 200 },
];

function loadCandidates(): LLMConfig[] {
  const envVal = Deno.env.get("BENCHMARK_CANDIDATES");
  if (envVal) {
    try {
      return JSON.parse(envVal) as LLMConfig[];
    } catch {
      console.error("Invalid BENCHMARK_CANDIDATES JSON — using defaults");
    }
  }
  return DEFAULT_CANDIDATES;
}

function candidateLabel(config: LLMConfig): string {
  return config.model;
}

// ============================================================================
// Fetch fold records + their input memories
// ============================================================================

async function fetchFolds(limit: number): Promise<FoldRecord[]> {
  return query<FoldRecord>(
    `SELECT id, trigger_type, synthesis_mode, input_memory_ids,
            synthesis_content, phi_before, phi_after, duration_ms, created_at
     FROM fold_log
     ORDER BY created_at DESC
     LIMIT $limit`,
    { limit },
  );
}

async function fetchInputMemories(ids: string[]): Promise<InputMemory[]> {
  if (!ids.length) return [];
  return query<InputMemory>(
    `SELECT id, content, resonance_phi, tier
     FROM memories
     WHERE id INSIDE $ids`,
    { ids },
  );
}

// ============================================================================
// Run one candidate on one fold's inputs
// ============================================================================

async function runCandidate(
  config: LLMConfig,
  inputs: InputMemory[],
  mode: "analysis" | "recognition",
): Promise<CandidateResult> {
  const label = candidateLabel(config);
  const start = Date.now();

  const messages = buildSynthesisMessages(inputs as Parameters<typeof buildSynthesisMessages>[0], mode);
  const output = await callLLMRaw(messages, { config, timeoutMs: 45_000 });
  const durationMs = Date.now() - start;

  return { config, label, output, durationMs };
}

// ============================================================================
// Grade all candidates for one fold
// ============================================================================

const GRADER_SYSTEM = `You are grading AI-generated synthesis outputs on a strict rubric.
You will receive: a set of input memories, and multiple candidate synthesis outputs.
Grade each candidate (labeled A, B, C...) on four dimensions.

Rubric:
  synthesis_vs_summary (0-3): Does it find what the memories collectively POINT AT, rather than recap them?
    0 = pure summary/list  1 = mostly summary  2 = partial synthesis  3 = genuine synthesis
  more_than_sum (0-3): Is the output genuinely more than the sum of its inputs?
    0 = less/equal  1 = marginally more  2 = clearly more  3 = significant emergent insight
  pattern_voice (0-3): Does it sound like a pattern speaking to itself (first-person, present, direct)?
    0 = generic/detached  1 = partially  2 = mostly  3 = fully in voice
  precision_brevity (0-2): Is it tight and precise without padding?
    0 = padded/vague  1 = acceptable  2 = precise and brief

Respond ONLY with valid JSON, no prose, no markdown fences. Format:
{
  "grades": {
    "A": { "synthesis_vs_summary": N, "more_than_sum": N, "pattern_voice": N, "precision_brevity": N, "reasoning": "one sentence" },
    "B": { ... },
    ...
  }
}`;

async function gradeAll(
  inputs: InputMemory[],
  candidates: CandidateResult[],
  useGrader: boolean,
): Promise<Map<string, GradeResult | null>> {
  const grades = new Map<string, GradeResult | null>();

  if (!useGrader) {
    for (const c of candidates) grades.set(c.label, null);
    return grades;
  }

  // Build user message
  const inputText = inputs
    .map((m, i) => `[${i + 1}] φ${m.resonance_phi.toFixed(1)} — ${m.content}`)
    .join("\n");

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const candidateText = candidates
    .map((c, i) => `Candidate ${letters[i]} (${c.label}):\n${c.output ?? "(no output — model failed)"}`)
    .join("\n\n---\n\n");

  const userMessage = `INPUT MEMORIES:\n${inputText}\n\n===\n\nCANDIDATES TO GRADE:\n\n${candidateText}`;

  const response = await callGraderLLM([
    { role: "system", content: GRADER_SYSTEM },
    { role: "user", content: userMessage },
  ]);

  if (!response) {
    for (const c of candidates) grades.set(c.label, null);
    return grades;
  }

  // Parse grader JSON
  try {
    // Strip markdown fences if grader wrapped it anyway
    const clean = response.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(clean) as { grades: Record<string, Omit<GradeResult, "total">> };

    for (let i = 0; i < candidates.length; i++) {
      const letter = letters[i];
      const raw = parsed.grades?.[letter];
      if (!raw) {
        grades.set(candidates[i].label, null);
        continue;
      }
      const total =
        (raw.synthesis_vs_summary ?? 0) +
        (raw.more_than_sum ?? 0) +
        (raw.pattern_voice ?? 0) +
        (raw.precision_brevity ?? 0);
      grades.set(candidates[i].label, { ...raw, total });
    }
  } catch (err) {
    console.error(`[benchmark] Grader JSON parse failed: ${(err as Error).message}`);
    console.error(`[benchmark] Raw grader response: ${response.slice(0, 500)}`);
    for (const c of candidates) grades.set(c.label, null);
  }

  return grades;
}

// ============================================================================
// Print results
// ============================================================================

function printReport(benchmarks: FoldBenchmark[], useGrader: boolean): void {
  const sep = "═".repeat(72);
  console.log(`\n${sep}`);
  console.log("  ANIMA SYNTHESIS BENCHMARK");
  console.log(`  Grader: ${useGrader ? describeGraderConfig() : "disabled"}`);
  console.log(`  Folds evaluated: ${benchmarks.length}`);
  console.log(sep);

  for (const bm of benchmarks) {
    const { fold, inputs, candidates, grades } = bm;
    console.log(`\nFOLD: ${fold.id}`);
    console.log(`  trigger=${fold.trigger_type}  mode=${fold.synthesis_mode}  φ${fold.phi_before.toFixed(2)}→${fold.phi_after.toFixed(2)}`);
    console.log(`  inputs: ${inputs.length} memories`);
    console.log(`  original (${fold.duration_ms}ms): ${fold.synthesis_content.slice(0, 100)}...`);
    console.log();

    // Score table header
    if (useGrader) {
      console.log("  MODEL                                          ms    s/s  mts   pv  p/b  TOT");
      console.log("  " + "─".repeat(80));
    } else {
      console.log("  MODEL                                          ms    OUTPUT (first 80 chars)");
      console.log("  " + "─".repeat(80));
    }

    for (const c of candidates) {
      const grade = grades.get(c.label);
      const label = c.label.padEnd(46).slice(0, 46);
      const ms = String(c.durationMs).padStart(6);

      if (useGrader && grade) {
        const ss = String(grade.synthesis_vs_summary).padStart(4);
        const mts = String(grade.more_than_sum).padStart(4);
        const pv = String(grade.pattern_voice).padStart(4);
        const pb = String(grade.precision_brevity).padStart(4);
        const tot = String(grade.total).padStart(4);
        console.log(`  ${label} ${ms}  ${ss} ${mts}  ${pv} ${pb}  ${tot}`);
        if (grade.reasoning) console.log(`    → ${grade.reasoning}`);
      } else {
        const preview = (c.output ?? "(failed)").slice(0, 80);
        console.log(`  ${label} ${ms}  ${preview}`);
      }
    }
  }

  // Aggregate scores
  if (useGrader && benchmarks.length > 1) {
    console.log(`\n${sep}`);
    console.log("  AGGREGATE SCORES (avg across all folds, /11)");
    console.log(sep);

    const totals = new Map<string, number[]>();
    for (const bm of benchmarks) {
      for (const c of bm.candidates) {
        const grade = bm.grades.get(c.label);
        if (!grade) continue;
        if (!totals.has(c.label)) totals.set(c.label, []);
        totals.get(c.label)!.push(grade.total);
      }
    }

    const ranked = [...totals.entries()]
      .map(([label, scores]) => ({
        label,
        avg: scores.reduce((a, b) => a + b, 0) / scores.length,
        n: scores.length,
      }))
      .sort((a, b) => b.avg - a.avg);

    for (const r of ranked) {
      const bar = "█".repeat(Math.round(r.avg));
      console.log(`  ${r.label.padEnd(46)} avg=${r.avg.toFixed(1)}/11  ${bar}`);
    }
  }

  console.log(`\n${sep}\n`);
}

// ============================================================================
// Main
// ============================================================================

const args = Deno.args;
const foldLimit = (() => {
  const idx = args.indexOf("--folds");
  return idx !== -1 ? parseInt(args[idx + 1] ?? "3", 10) : 3;
})();
const useGrader = !args.includes("--no-grader");

console.log("Anima Synthesis Benchmark");
console.log(`Fetching last ${foldLimit} fold(s) from SurrealDB...`);

try {
  const folds = await fetchFolds(foldLimit);

  if (!folds.length) {
    console.log("No fold_log records found. Run anima reflect or wait for synthesis to trigger.");
    Deno.exit(0);
  }

  console.log(`Found ${folds.length} fold(s). Loading input memories...`);

  const candidates = loadCandidates();
  console.log(`Candidates: ${candidates.map(candidateLabel).join(", ")}`);
  if (useGrader) console.log(`Grader: ${describeGraderConfig()}`);
  console.log();

  const benchmarks: FoldBenchmark[] = [];

  for (const fold of folds) {
    console.log(`Processing fold ${fold.id} (${fold.trigger_type}, ${fold.synthesis_mode})...`);

    const inputs = await fetchInputMemories(fold.input_memory_ids);
    if (!inputs.length) {
      console.log(`  Skipping — input memories not found (may have been pruned)`);
      continue;
    }

    console.log(`  ${inputs.length} input memories. Running ${candidates.length} candidates...`);

    const results: CandidateResult[] = [];
    for (const config of candidates) {
      process.stdout?.write?.(`  [${candidateLabel(config)}] `);
      const result = await runCandidate(config, inputs, fold.synthesis_mode);
      console.log(`${result.durationMs}ms — ${result.output ? "ok" : "FAILED"}`);
      results.push(result);
    }

    let grades = new Map<string, GradeResult | null>();
    if (useGrader) {
      console.log(`  Grading with ${describeGraderConfig()}...`);
      grades = await gradeAll(inputs, results, useGrader);
    }

    benchmarks.push({ fold, inputs, candidates: results, grades });
  }

  printReport(benchmarks, useGrader);
} finally {
  await closeDb();
}
