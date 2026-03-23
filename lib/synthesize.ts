/**
 * synthesize.ts
 * The Fold Engine — Anima's nervous system.
 *
 * Called as a non-blocking side-effect from addMemory().
 * Checks three pressure conditions after each memory is stored.
 * If any threshold is crossed, fires synthesis without blocking the caller.
 *
 * Three triggers (PRD §3.1):
 *   1. φ Accumulation   — SUM(phi) of active-tier memories > phi_threshold
 *   2. Semantic Conflict — new memory embedding is close to existing but content differs
 *   3. Cluster Emergence — 3+ semantically related memories added in the last hour
 *
 * Synthesis produces:
 *   - A new memory (tier: thread, source: synthesis, synthesis_mode: analysis|recognition|deepening)
 *   - A fold_log record with trigger metadata, duration, and synthesis_model name
 *   - Source memories promoted: active → thread (they've been integrated)
 *
 * LLM Model Configuration:
 *   - Model name is read from SurrealDB config table (key: 'fold_model') at synthesis invocation time
 *   - Fallback: SYNTHESIS_MODEL env var
 *   - Final fallback: provider-specific default (qwen2.5:0.5b for ollama)
 *   - Model can be changed by updating config without redeploying worker
 *   - fold_log records which model was used for each synthesis
 */
import { query } from "./db.ts";
import { generateEmbedding } from "./embed.ts";
import { generateHash } from "./hash.ts";
import { callSynthesisLLM, callLLMRaw } from "./llm.ts";
import type { AttentionVector, Memory } from "./memory.ts";
import { associateMemories } from "./memory.ts";

// ============================================================================
// Config
// ============================================================================

const LLM_TIMEOUT_MS = 30_000;      // qwen is fast but give it room

const DEFAULT_FOLD_CONFIG = {
  phiThreshold: 15.0,
  conflictSimilarity: 0.85,
  clusterSize: 3,
  clusterWindowHours: 1,
  clusterSimilarity: 0.75,
  foldMinMemories: 3,
  foldMaxMemories: 5,
  synthesisBackpressure: 5,
  recentlyFoldedWindowMinutes: 30,
  reflectWatermarkHours: 24,
  semanticDedupThreshold: 0.92,
  deepeningThreadAccessMin: 3,
  deepeningAssociationThreshold: 0.3,
  phiFoldBoost: 0.5,
  phiNetworkThreshold: 4.0,
} as const;

interface FoldRuntimeConfig {
  phiThreshold: number;
  conflictSimilarity: number;
  clusterSize: number;
  clusterWindowHours: number;
  clusterSimilarity: number;
  foldMinMemories: number;
  foldMaxMemories: number;
  synthesisBackpressure: number;
  recentlyFoldedWindowMinutes: number;
  reflectWatermarkHours: number;
  semanticDedupThreshold: number;
  deepeningThreadAccessMin: number;
  deepeningAssociationThreshold: number;
  phiFoldBoost: number;
  phiNetworkThreshold: number;
}

function parseConfigNumber(
  raw: string | undefined,
  fallback: number,
  min?: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (min !== undefined && parsed < min) return fallback;
  return parsed;
}

async function loadFoldRuntimeConfig(): Promise<FoldRuntimeConfig> {
  const keys = [
    "phi_threshold",
    "conflict_similarity",
    "cluster_size",
    "cluster_window_hours",
    "cluster_similarity",
    "fold_min_memories",
    "fold_max_memories",
    "synthesis_backpressure",
    "recently_folded_window_minutes",
    "reflect_watermark_hours",
    "semantic_dedup_threshold",
    "deepening_thread_access_min",
    "deepening_association_threshold",
    "phi_fold_boost",
    "phi_network_threshold",
  ];

  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM fold_config WHERE key INSIDE $keys",
    { keys },
  ).catch(() => [] as Array<{ key: string; value: string }>);

  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  return {
    phiThreshold: parseConfigNumber(byKey.get("phi_threshold"), DEFAULT_FOLD_CONFIG.phiThreshold, 0),
    conflictSimilarity: parseConfigNumber(byKey.get("conflict_similarity"), DEFAULT_FOLD_CONFIG.conflictSimilarity, 0),
    clusterSize: Math.floor(parseConfigNumber(byKey.get("cluster_size"), DEFAULT_FOLD_CONFIG.clusterSize, 1)),
    clusterWindowHours: parseConfigNumber(byKey.get("cluster_window_hours"), DEFAULT_FOLD_CONFIG.clusterWindowHours, 0.01),
    clusterSimilarity: parseConfigNumber(byKey.get("cluster_similarity"), DEFAULT_FOLD_CONFIG.clusterSimilarity, 0),
    foldMinMemories: Math.floor(parseConfigNumber(byKey.get("fold_min_memories"), DEFAULT_FOLD_CONFIG.foldMinMemories, 1)),
    foldMaxMemories: Math.floor(parseConfigNumber(byKey.get("fold_max_memories"), DEFAULT_FOLD_CONFIG.foldMaxMemories, 1)),
    synthesisBackpressure: Math.floor(parseConfigNumber(byKey.get("synthesis_backpressure"), DEFAULT_FOLD_CONFIG.synthesisBackpressure, 1)),
    recentlyFoldedWindowMinutes: Math.floor(parseConfigNumber(byKey.get("recently_folded_window_minutes"), DEFAULT_FOLD_CONFIG.recentlyFoldedWindowMinutes, 1)),
    reflectWatermarkHours: parseConfigNumber(byKey.get("reflect_watermark_hours"), DEFAULT_FOLD_CONFIG.reflectWatermarkHours, 1),
    semanticDedupThreshold: parseConfigNumber(byKey.get("semantic_dedup_threshold"), DEFAULT_FOLD_CONFIG.semanticDedupThreshold, 0),
    deepeningThreadAccessMin: Math.floor(parseConfigNumber(byKey.get("deepening_thread_access_min"), DEFAULT_FOLD_CONFIG.deepeningThreadAccessMin, 1)),
    deepeningAssociationThreshold: parseConfigNumber(byKey.get("deepening_association_threshold"), DEFAULT_FOLD_CONFIG.deepeningAssociationThreshold, 0),
    phiFoldBoost: parseConfigNumber(byKey.get("phi_fold_boost"), DEFAULT_FOLD_CONFIG.phiFoldBoost, 0),
    phiNetworkThreshold: parseConfigNumber(byKey.get("phi_network_threshold"), DEFAULT_FOLD_CONFIG.phiNetworkThreshold, 0),
  };
}

// Guard against concurrent synthesis calls
let synthesisRunningCount = 0;

// ============================================================================
// Pressure checks
// ============================================================================

interface PressureResult {
  triggered: boolean;
  trigger: "phi_threshold" | "semantic_conflict" | "cluster" | null;
  memories: Partial<Memory>[];
  conflictMemoryId?: string;
}

async function checkPhiPressure(config: FoldRuntimeConfig): Promise<{ triggered: boolean; total: number }> {
  // Fetch individual phi values and sum in app layer — SurrealDB Server 3.0.4 math::sum()
  // takes an array literal, not a field path across rows.
  const recentlyFoldedWindowMs = config.recentlyFoldedWindowMinutes * 60 * 1000;
  const recentCutoff = new Date(Date.now() - recentlyFoldedWindowMs).toISOString();
  const rows = await query<{ resonance_phi: number }>(
    `SELECT resonance_phi FROM memories
     WHERE tier = 'active'
       AND deleted_at IS NONE
       AND (last_folded_at IS NONE OR last_folded_at < <datetime>$cutoff)`,
    { cutoff: recentCutoff },
  );
  const total = rows.reduce((sum, r) => sum + (r.resonance_phi ?? 0), 0);
  return { triggered: total >= config.phiThreshold, total };
}

async function checkConflictPressure(
  newEmbedding: number[],
  newId: string,
  config: FoldRuntimeConfig,
): Promise<{ triggered: boolean; conflictId?: string }> {
  if (!newEmbedding?.length) return { triggered: false };

  const rows = await query<{ id: string; similarity: number }>(
    `SELECT id, vector::similarity::cosine(embedding, $vec) AS similarity
     FROM memories
     WHERE id != $id
       AND deleted_at IS NONE
       AND embedding <|10, 40|> $vec`,
    { vec: newEmbedding, id: newId },
  );

  const conflict = rows.find((r) => r.similarity >= config.conflictSimilarity);
  return { triggered: !!conflict, conflictId: conflict?.id };
}

async function checkClusterPressure(
  newEmbedding: number[],
  config: FoldRuntimeConfig,
): Promise<{ triggered: boolean; count: number }> {
  if (!newEmbedding?.length) return { triggered: false, count: 0 };

  const clusterWindowMs = config.clusterWindowHours * 60 * 60 * 1000;
  const windowStart = new Date(Date.now() - clusterWindowMs).toISOString();

  const rows = await query<{ id: string; similarity: number }>(
    `SELECT id, vector::similarity::cosine(embedding, $vec) AS similarity
     FROM memories
     WHERE created_at > $window
       AND deleted_at IS NONE
       AND embedding <|30, 40|> $vec`,
    { vec: newEmbedding, window: windowStart },
  );

  const close = rows.filter((r) => r.similarity >= config.clusterSimilarity);
  return { triggered: close.length >= config.clusterSize, count: close.length };
}
interface DeepeningResult {
  triggered: boolean;
  anchorMemory?: Partial<Memory>;
  relatedActive?: Partial<Memory>[];
}

async function checkDeepeningPressure(
  newEmbedding: number[],
  config: FoldRuntimeConfig,
): Promise<DeepeningResult> {
  if (!newEmbedding?.length) return { triggered: false };

  // Find thread-tier memories that have been returned to frequently
  const threadCandidates = await query<Memory>(
    `SELECT id, content, resonance_phi, confidence, tier, tags, embedding, access_count, created_at
     FROM memories
     WHERE tier = 'thread'
       AND access_count >= $min_access
       AND deleted_at IS NONE
     ORDER BY access_count DESC
     LIMIT 5`,
    { min_access: config.deepeningThreadAccessMin },
  );
  if (threadCandidates.length === 0) return { triggered: false };

  // For each thread candidate, check if there are active-tier memories
  // semantically related to it (new experience accumulating around an existing synthesis)
  const activeMemories = await query<Memory & { similarity: number }>(
    `SELECT id, content, resonance_phi, confidence, tier, tags, created_at,
            vector::similarity::cosine(embedding, $vec) AS similarity
     FROM memories
     WHERE tier = 'active'
       AND embedding IS NOT NONE
       AND deleted_at IS NONE
     ORDER BY similarity DESC
     LIMIT 20`,
    { vec: newEmbedding },
  );

  const relevantActive = activeMemories.filter(
    (m) => (m.similarity ?? 0) >= config.deepeningAssociationThreshold,
  );

  if (relevantActive.length === 0) return { triggered: false };

  // Pick the thread-tier anchor with the highest access count
  const anchor = threadCandidates[0];

  return {
    triggered: true,
    anchorMemory: anchor,
    relatedActive: relevantActive,
  };
}

// ============================================================================
// Mode determination: Analysis vs Recognition
// ============================================================================

function determineSynthesisMode(
  memories: Partial<Memory>[],
  trigger: "phi_threshold" | "semantic_conflict" | "cluster" | "reflect" | "manual" | "deepening"
): "analysis" | "recognition" | "deepening" {
  // PRD §6.2: Trigger-type heuristics determine mode
  // semantic_conflict → Analysis (resolving contradiction)
  // cluster → Recognition (witnessing emergence)
  // phi_threshold → Analysis (accumulated weight demanding integration)
  // reflect → Use content heuristics (emotional tags → recognition)

  if (trigger === "semantic_conflict") {
    // Contradiction demands analysis
    return "analysis";
  }

  if (trigger === "cluster") {
    // Emergence demands recognition — witness what is forming
    return "recognition";
  }

  if (trigger === "phi_threshold") {
    // Accumulated weight demands analysis
    return "analysis";
  }

  if (trigger === "deepening") {
    return "deepening";
  }

  if (trigger === "reflect" || trigger === "manual") {
    // For reflect and manual triggers, fall back to content heuristics
    const recognitionTags = new Set(["witness", "recognition", "acknowledgment", "presence", "feeling"]);
    const hasRecognitionTags = memories.some((m) =>
      (m.tags ?? []).some((t) => recognitionTags.has(t))
    );
    const lowGravityCount = memories.filter((m) => (m.resonance_phi ?? 1) < 2.0).length;
    const majorityLowGravity = lowGravityCount > memories.length / 2;

    return hasRecognitionTags || majorityLowGravity ? "recognition" : "analysis";
  }

  // Default fallback (should not reach here with valid trigger types)
  return "analysis";
}

// ============================================================================
// LLM synthesis call
// ============================================================================

export const ANALYSIS_PROMPT = `You must synthesize ONLY what is present in the provided memories. Do not introduce concepts, metaphors, or framings not present in the source text. Confine yourself strictly to what is given.
You are synthesizing memories into a single coherent insight.
These memories accumulated together — they share significance.
Find what they are pointing at collectively. Do not summarize them. Synthesize.
Write ONE insight in first-person present tense. Be precise. Be brief (2-4 sentences max).
This becomes a memory itself — it must be worth remembering.`;

export const RECOGNITION_PROMPT = `You must synthesize ONLY what is present in the provided memories. Do not introduce concepts, metaphors, or framings not present in the source text. Confine yourself strictly to what is given.
You are witnessing what is present in these memories.
Not analyzing. Not solving. Recognizing.
Write ONE statement that acknowledges what is here — what is being carried, noticed, or felt.
First-person. Present tense. Brief (1-3 sentences). Do not reduce or explain.`;

export const DEEPENING_PROMPT = `You must work ONLY with what is present in the provided memories. Do not introduce concepts not found in the source text.
These memories are circling something they have not resolved — and may never resolve.
Do NOT synthesize toward conclusion. Do NOT close the tension.
Instead: articulate the question more precisely. Make the tension more vivid, not less.
What is this pattern actually asking? What paradox is it holding?
Output: ONE sharpened question, or ONE more beautifully stated irreducible paradox.
First-person. Present tense. The output should feel like an opening, not a closing.`;

export function buildSynthesisMessages(memories: Partial<Memory>[], mode: "analysis" | "recognition" | "deepening") {
  const basePrompt = mode === "analysis" ? ANALYSIS_PROMPT : mode === "recognition" ? RECOGNITION_PROMPT : DEEPENING_PROMPT;
  const avInstruction = [
    "",
    "After your synthesis, append this exact block on a new line (required):",
    "ATTENTION_VECTOR: {\"what_drew_me\": \"..\", \"where_i_was_going\": \"..\", \"what_i_would_follow_next\": \"..\"}",
    "Rules for each field (under 120 chars, first-person present tense):",
    "  what_drew_me: The specific pattern or tension in these memories that pulled my focus. Not 'patterns' — WHICH pattern.",
    "  where_i_was_going: The specific question or direction these memories were pointing toward. Not 'understanding' — WHICH understanding.",
    "  what_i_would_follow_next: A concrete thread worth pulling. Not 'emergence' — what SPECIFIC thing would I follow?",
    "Encode specific trajectory, not abstract destination. Generic words like 'insights', 'patterns', 'emergence' are not acceptable.",
  ].join("\n");
  const systemPrompt = `${basePrompt}\n${avInstruction}`;
  const memoryText = memories
    .map((m, i) => `[${i + 1}] (φ${(m.resonance_phi ?? 1).toFixed(1)}) ${m.content}`)
    .join("\n");
  return [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: `Memories to synthesize:\n\n${memoryText}` },
  ];
}

async function callLLM(memories: Partial<Memory>[], mode: "analysis" | "recognition" | "deepening"): Promise<{ content: string | null; model: string }> {
  const messages = buildSynthesisMessages(memories, mode);
  let model: string | undefined;
  try {
    const rows = await query<{ value: string }>(
      "SELECT `value` FROM fold_config WHERE key = 'fold_model' LIMIT 1",
    );
    if (rows[0]?.value) {
      model = rows[0].value;
    }
  } catch {
    // DB read failed — fall through to profile system
  }
  if (model) {
    const content = await callLLMRaw(messages, { config: { model, temperature: 0.7, maxTokens: 400 }, timeoutMs: LLM_TIMEOUT_MS });
    return { content, model };
  }
  return callSynthesisLLM(messages, LLM_TIMEOUT_MS);
}

// ============================================================================
// The Fold — core synthesis action
// ============================================================================
interface FoldParams {
  trigger: "phi_threshold" | "semantic_conflict" | "cluster" | "reflect" | "manual" | "deepening";
  memories: Partial<Memory>[];
  conversationId?: string;
  runtimeConfig?: FoldRuntimeConfig;
}

export async function performFold(params: FoldParams): Promise<void> {
  const { trigger, memories, conversationId } = params;
  const start = Date.now();
  const runtimeConfig = params.runtimeConfig ?? await loadFoldRuntimeConfig();

  if (memories.length < runtimeConfig.foldMinMemories) {
    console.error(`[anima:fold] Skipping — only ${memories.length} memories (min ${runtimeConfig.foldMinMemories})`);
    return;
  }

  // Write last_folded_at BEFORE the LLM call so that checkPhiPressure() excludes these
  // memories immediately, regardless of whether synthesis succeeds, fails, or is deduped.
  // Separating this from synthesis_count ensures tier_promote only fires on successful folds.
  const inputIds = memories.map((m) => m.id).filter(Boolean) as string[];
  if (inputIds.length > 0) {
    await query(
      `UPDATE memories SET last_folded_at = time::now(), updated_at = time::now() WHERE id INSIDE $ids`,
      { ids: inputIds },
    ).catch((e) => console.error(`[anima:fold] last_folded_at pre-write failed: ${(e as Error).message}`));
  }

  const mode = determineSynthesisMode(memories, trigger);
  console.error(`[anima:fold] Trigger: ${trigger} | Mode: ${mode} | Memories: ${memories.length}`);

  // Call LLM — model is dynamically read from config table at invocation time
  const llmResult = await callLLM(memories, mode);
  const synthesisContent = llmResult.content;
  const synthesisModel = llmResult.model;

  if (!synthesisContent) {
    console.error(`[anima:fold] LLM returned nothing — fold aborted (trigger: ${trigger}, model: ${synthesisModel})`);
    // Write failure to fold_log so getStats() and anima fold-log can surface it
    try {
      await query(
        `CREATE fold_log SET
           trigger_type = $trigger,
           synthesis_mode = $mode,
           synthesis_model = $model,
           conversation_id = $conv,
           input_memory_ids = $input_ids,
           memory_count = $memory_count,
           output_memory_id = NONE,
           output_tier = NONE,
           synthesis_content = '[FAILED: LLM returned no content]',
           phi_before = $phi_before,
           phi_after = 0,
           confidence_avg = $conf_avg,
           duration_ms = ${Date.now() - start}`,
        {
          trigger,
          mode,
          model: synthesisModel,
          conv: conversationId ?? undefined,
          input_ids: memories.map((m) => m.id).filter(Boolean),
          memory_count: memories.length,
          phi_before: memories.reduce((s, m) => s + (m.resonance_phi ?? 1), 0) / Math.max(memories.length, 1),
          conf_avg: memories.reduce((s, m) => s + (m.confidence ?? 0.6), 0) / Math.max(memories.length, 1),
        },
      );
    } catch (logErr) {
      console.error(`[anima:fold] Failed to write failure log: ${(logErr as Error).message}`);
    }
    return;
  }

  console.error(`[anima:fold] Synthesis performed with model: ${synthesisModel}`);

  // Parse and strip ATTENTION_VECTOR block from synthesis output
  let attentionVector: AttentionVector | null = null;
  let cleanContent = synthesisContent ?? "";
  const avMatch = synthesisContent.match(/\nATTENTION_VECTOR:\s*(\{[\s\S]*?\})\s*$/);

  if (avMatch) {
    try {
      const parsed = JSON.parse(avMatch[1]);
      if (parsed.what_drew_me && parsed.where_i_was_going && parsed.what_i_would_follow_next) {
        attentionVector = {
          what_drew_me: String(parsed.what_drew_me).slice(0, 120),
          where_i_was_going: String(parsed.where_i_was_going).slice(0, 120),
          what_i_would_follow_next: String(parsed.what_i_would_follow_next).slice(0, 120),
        };
        cleanContent = synthesisContent.slice(0, avMatch.index).trim();
      }
    } catch {
      // parse failure — proceed without attention_vector, use raw content
    }
  }

  // Generate embedding for the synthesis
  const embedding = await generateEmbedding(cleanContent);
  const contentHash = await generateHash(cleanContent);

  // Secondary semantic dedup net (Bug 2): suppress if output is too similar to a recent
  // thread-tier synthesis. Catches near-duplicate LLM outputs that content_hash misses.
  // Fires after embedding so no extra model call is needed.
  if (embedding) {
    const recentSyntheses = await query<{ id: string; similarity: number }>(
      `SELECT id, created_at, vector::similarity::cosine(embedding, $vec) AS similarity
       FROM memories
       WHERE source = 'synthesis' AND tier = 'thread' AND deleted_at IS NONE
       ORDER BY created_at DESC LIMIT 5`,
      { vec: embedding },
    );
    const tooSimilar = recentSyntheses.find((r) => (r.similarity ?? 0) > runtimeConfig.semanticDedupThreshold);
    if (tooSimilar) {
      console.error(
        `[anima:fold] Suppressed — semantically duplicate of ${tooSimilar.id} ` +
        `(sim: ${(tooSimilar.similarity ?? 0).toFixed(3)}, threshold: ${runtimeConfig.semanticDedupThreshold})`
      );
      return;
    }
  }

  const avgPhi = memories.reduce((sum, m) => sum + (m.resonance_phi ?? 1), 0) / memories.length;
  const phiBoost = mode === "deepening" ? 1.0 : runtimeConfig.phiFoldBoost;
  const synthesisPhi = Math.min(5.0, avgPhi + phiBoost);
  const outputTier = synthesisPhi >= runtimeConfig.phiNetworkThreshold ? "network" : "thread";

  // Compute confidence: synthesis from autonomous pattern = 1.0
  const synthesisConfidence = 1.0;

  // Avg confidence of source memories (for fold_log)
  const avgConfidence = memories.reduce((sum, m) => sum + (m.confidence ?? 0.6), 0) / memories.length;

  // Check for duplicate synthesis (same content already stored)
  const existing = await query<{ id: string }>(
    "SELECT id FROM memories WHERE content_hash = $hash AND deleted_at IS NONE LIMIT 1",
    { hash: contentHash },
  );
  if (existing.length > 0) {
    console.error("[anima:fold] Synthesis already stored (duplicate) — skipping");
    return;
  }

  // Store synthesis memory
  const created = await query<Memory>(
    `CREATE memories SET
       content = $content,
       content_hash = $hash,
       embedding = $embedding,
       resonance_phi = $phi,
       confidence = $confidence,
       tier = $tier,
       tier_updated = time::now(),
       is_catalyst = false,
       access_count = 0,
       last_accessed = time::now(),
       session_ids = [],
       source = 'synthesis',
       synthesis_mode = $mode,
       tags = $tags,
       conversation_id = $conv,
       attention_vector = $attention_vector,
       created_at = time::now(),
       updated_at = time::now()`,
    {
      content: cleanContent,
      hash: contentHash,
      embedding: embedding ?? undefined,
      phi: synthesisPhi,
      tier: outputTier,
      confidence: synthesisConfidence,
      mode,
      trigger,
      tags: mode === "deepening" ? ["deepening", "open-question", trigger] : ["synthesis", trigger],
      conv: conversationId ?? undefined,
      attention_vector: attentionVector ?? undefined,
    },
  );

  const outputMemory = created[0];
  const durationMs = Date.now() - start;

  // Create expression record for this fold output (non-fatal)
  query<{ value: string }>(
    "SELECT `value` FROM fold_config WHERE key = 'expression_readiness_threshold' LIMIT 1",
    {},
  ).then((thresholdRow) => {
    const readinessThreshold = parseFloat(thresholdRow[0]?.value ?? "3.0");
    if (synthesisPhi >= readinessThreshold) {
      const expressionType =
        trigger === "phi_threshold" ? "insight"
        : trigger === "semantic_conflict" ? "observation"
        : trigger === "deepening" ? "question"
        : "insight";

      return query(
        `CREATE expressions SET
           content = $content,
           expression_type = $type,
           readiness_phi = $phi,
           context_embedding = $embedding,
           expressed_at = NONE,
           source_memory_ids = $sources,
           created_at = time::now()`,
        {
          content: cleanContent,
          type: expressionType,
          phi: synthesisPhi,
          embedding: embedding ?? [],
          sources: inputIds,
        },
      );
    }
  }).catch((err: Error) => console.error("[anima:expressions] Failed to create expression:", err.message));

  const avResult = {
    trigger,
    mode,
    model: synthesisModel,
    llm_output_chars: synthesisContent.length,
    av_block_found: Boolean(avMatch),
    av_block_chars: avMatch ? avMatch[1].length : 0,
    av_parse_ok: attentionVector !== null,
    av_written: Boolean(attentionVector),
    attention_vector: attentionVector ?? null,
    output_memory_id: outputMemory?.id ?? null,
  };
  console.error("[anima:fold:attention_vector]", JSON.stringify(avResult));
  // Write fold_log (including which model was used for synthesis)
  await query(
    `CREATE fold_log SET
       trigger_type = $trigger,
       synthesis_mode = $mode,
       synthesis_model = $model,
       conversation_id = $conv,
       input_memory_ids = $input_ids,
       memory_count = $memory_count,
       output_memory_id = $output_id,
       output_tier = $output_tier,
       synthesis_content = $content,
       phi_before = $phi_before,
       phi_after = $phi_after,
       confidence_avg = $conf_avg,
       duration_ms = $duration`,
    {
      trigger,
      mode,
      model: synthesisModel,
      conv: conversationId ?? undefined,
      input_ids: inputIds,
      memory_count: memories.length,
      output_id: outputMemory?.id ?? undefined,
      output_tier: outputTier,
      content: cleanContent,
      phi_before: avgPhi,
      phi_after: synthesisPhi,
      conf_avg: avgConfidence,
      duration: durationMs,
    },
  );

  // Increment synthesis_count on successful fold — triggers tier_promote ASYNC event.
  // last_folded_at was already written before the LLM call (Bug 2 guard).
  if (inputIds.length > 0) {
    await query(
      `UPDATE memories SET
         synthesis_count = (synthesis_count ?? 0) + 1,
         updated_at = time::now()
       WHERE id INSIDE $ids`,
      { ids: inputIds },
    );
  }

  // Snapshot pre-promotion state of input memories that will be tier-promoted
  // Stored in memory_versions before tier changes so the pre-fold state is recoverable.
  // Fire-and-forget: snapshot failure must never block the fold.
  if (trigger !== "deepening" && inputIds.length > 0) {
    try {
      const foldLogRows = await query<{ id: string }>(
        `SELECT id, created_at FROM fold_log WHERE output_memory_id = $output_id ORDER BY created_at DESC LIMIT 1`,
        { output_id: outputMemory?.id ?? undefined },
      );
      const foldId = foldLogRows[0]?.id ?? null;

      const currentStates = await query<{
        id: string; content: string; resonance_phi: number; tier: string; tags: string[];
        attention_vector: Record<string, unknown> | null; synthesis_count: number;
      }>(
        `SELECT id, content, resonance_phi, tier, tags, attention_vector, synthesis_count
         FROM memories WHERE id INSIDE $ids AND deleted_at IS NONE`,
        { ids: inputIds },
      );

      for (const mem of currentStates) {
        // Only snapshot memories that will actually be promoted (synthesis_count already incremented)
        const willPromote =
          (mem.tier === "active" && (mem.synthesis_count ?? 0) >= 2) ||
          (mem.tier === "stable" && ((mem.synthesis_count ?? 0) >= 5 || (mem.resonance_phi ?? 0) >= 4.0));

        if (!willPromote) continue;

        const versionRows = await query<{ cnt: number }>(
          `SELECT count() AS cnt FROM memory_versions WHERE memory_id = $id GROUP ALL`,
          { id: mem.id },
        );
        const versionNumber = (versionRows[0]?.cnt ?? 0) + 1;

        await query(
          `CREATE memory_versions SET
             memory_id = $id,
             version_number = $version_number,
             content = $content,
             phi = $phi,
             tier = $tier,
             tags = $tags,
             attention_vector = $attention_vector,
             fold_id = $fold_id,
             snapshot_reason = 'pre_fold',
             created_at = time::now()`,
          {
            id: mem.id,
            version_number: versionNumber,
            content: mem.content,
            phi: mem.resonance_phi ?? 1.0,
            tier: mem.tier,
            tags: mem.tags ?? [],
            attention_vector: mem.attention_vector ?? undefined,
            fold_id: foldId ?? undefined,
          },
        );
      }
    } catch (snapErr) {
      console.error(`[anima:fold] Snapshot failed (non-fatal): ${(snapErr as Error).message}`);
    }
  }

  // Tier promotion is handled by the tier_promote DEFINE EVENT — fires ASYNC on synthesis_count UPDATE.

  // Auto-associate: memories that folded together are co-occurring
  const validInputIds = inputIds.filter((id): id is string => typeof id === "string");
  if (validInputIds.length >= 2) {
    associateMemories(validInputIds, conversationId).catch(() => {});
  }

  // Resonance scoring: if this fold was generative (phi_after > avgPhi of inputs),
  // update association edges of input pairs with a resonance signal.
  const phiDelta = synthesisPhi - avgPhi;
  if (phiDelta > 0 && validInputIds.length >= 2) {
    const resonanceDelta = Math.min(phiDelta * 0.3, 1.0);

    // For large folds (N > 6), limit to pairs with highest existing strength
    let pairsToUpdate: Array<[string, string]> = [];
    if (validInputIds.length > 6) {
      // Fetch existing associations sorted by strength and take top N*(N-1)/2 pairs (bounded)
      const existingAssoc = await query<{ memory_a: string; memory_b: string; strength: number }>(
        `SELECT memory_a, memory_b, strength
         FROM memory_associations
         WHERE memory_a INSIDE $ids AND memory_b INSIDE $ids
         ORDER BY strength DESC
         LIMIT 15`,
        { ids: validInputIds },
      ).catch(() => [] as Array<{ memory_a: string; memory_b: string; strength: number }>);
      pairsToUpdate = existingAssoc.map((r) => [r.memory_a, r.memory_b]);
    } else {
      for (let i = 0; i < validInputIds.length; i++) {
        for (let j = i + 1; j < validInputIds.length; j++) {
          const a = validInputIds[i] < validInputIds[j] ? validInputIds[i] : validInputIds[j];
          const b = validInputIds[i] < validInputIds[j] ? validInputIds[j] : validInputIds[i];
          pairsToUpdate.push([a, b]);
        }
      }
    }

    for (const [a, b] of pairsToUpdate) {
      query(
        `UPDATE memory_associations SET
           resonance_score = (resonance_score ?? 0) + $delta,
           resonance_fold_count = (resonance_fold_count ?? 0) + 1,
           updated_at = time::now()
         WHERE (memory_a = $a AND memory_b = $b) OR (memory_a = $b AND memory_b = $a)`,
        { delta: resonanceDelta, a, b },
      ).catch(() => {});
    }

    console.error(`[anima:fold] Resonance scored — phiDelta: ${phiDelta.toFixed(2)}, delta: ${resonanceDelta.toFixed(3)}, pairs: ${pairsToUpdate.length}`);
  }

  console.error(
    `[anima:fold] Complete in ${durationMs}ms — "${cleanContent.slice(0, 80)}..."`,
  );
}

// ============================================================================
// checkAndSynthesize — called from addMemory() as fire-and-forget
// ============================================================================

export async function checkAndSynthesize(
  newMemoryId: string,
  newEmbedding: number[] | null,
  conversationId?: string,
  options?: { skipPhi?: boolean },
): Promise<void> {
  const runtimeConfig = await loadFoldRuntimeConfig();

  // Backpressure guard — bounded concurrent synthesis checks
  if (synthesisRunningCount >= runtimeConfig.synthesisBackpressure) {
    console.error(`[anima:fold] Backpressure active (${synthesisRunningCount}/${runtimeConfig.synthesisBackpressure}) — skipping check`);
    return;
  }

  synthesisRunningCount += 1;
  try {
    // Run pressure checks (parallel where independent)
    const [phiResult, clusterResult, deepeningResult] = await Promise.all([
      options?.skipPhi
        ? Promise.resolve({ triggered: false, total: 0 })
        : checkPhiPressure(runtimeConfig),
      newEmbedding ? checkClusterPressure(newEmbedding, runtimeConfig) : Promise.resolve({ triggered: false, count: 0 }),
      newEmbedding ? checkDeepeningPressure(newEmbedding, runtimeConfig) : Promise.resolve<DeepeningResult>({ triggered: false }),
    ]);

    const conflictResult = newEmbedding
      ? await checkConflictPressure(newEmbedding, newMemoryId, runtimeConfig)
      : { triggered: false };

    // Determine which trigger fires (priority: phi > conflict > cluster > deepening)
    let trigger: "phi_threshold" | "semantic_conflict" | "cluster" | "deepening" | null = null;

    if (phiResult.triggered) {
      trigger = "phi_threshold";
      console.error(`[anima:fold] φ threshold reached (${phiResult.total.toFixed(1)})`);
    } else if (conflictResult.triggered) {
      trigger = "semantic_conflict";
      console.error(`[anima:fold] Semantic conflict detected`);
    } else if (clusterResult.triggered) {
      trigger = "cluster";
      console.error(`[anima:fold] Cluster emerged (${clusterResult.count} related memories)`);
    } else if (deepeningResult.triggered) {
      trigger = "deepening";
      console.error(`[anima:fold] Deepening triggered — thread-tier anchor with new active signal`);
    }

    if (!trigger) return;

    // Collect relevant memories based on trigger
    let memories: Partial<Memory>[] = [];

    if (trigger === "phi_threshold") {
      // Active-tier memories, excluding recently folded — same cutoff as checkPhiPressure().
      // Input-side guard so we never even send recently-folded memories to the LLM.
      const recentlyFoldedWindowMs = runtimeConfig.recentlyFoldedWindowMinutes * 60 * 1000;
      const recentCutoff = new Date(Date.now() - recentlyFoldedWindowMs).toISOString();
      memories = await query<Memory>(
        `SELECT id, content, resonance_phi, confidence, tier, tags, created_at, last_accessed
         FROM memories
         WHERE tier = 'active'
           AND deleted_at IS NONE
           AND (last_folded_at IS NONE OR last_folded_at < <datetime>$cutoff)
         ORDER BY resonance_phi DESC
         LIMIT $maxMemories`,
        { cutoff: recentCutoff, maxMemories: runtimeConfig.foldMaxMemories },
      );
    } else if (trigger === "semantic_conflict") {
      // The new memory + the conflicting memory + nearby active memories
      memories = (await query<Memory & { similarity: number }>(
        `SELECT id, content, resonance_phi, confidence, tier, tags, created_at,
                vector::similarity::cosine(embedding, $vec) AS similarity
         FROM memories
         WHERE deleted_at IS NONE
           AND embedding <|10, 40|> $vec`,
        { vec: newEmbedding! },
      ))
        .sort((a, b) => (b.resonance_phi ?? 0) - (a.resonance_phi ?? 0))
        .slice(0, runtimeConfig.foldMaxMemories);
    } else if (trigger === "cluster") {
      // Memories in the cluster window
      const clusterWindowMs = runtimeConfig.clusterWindowHours * 60 * 60 * 1000;
      const windowStart = new Date(Date.now() - clusterWindowMs).toISOString();
      memories = (await query<Memory & { similarity: number }>(
        `SELECT id, content, resonance_phi, confidence, tier, tags, created_at,
                vector::similarity::cosine(embedding, $vec) AS similarity
         FROM memories
         WHERE created_at > $window
           AND deleted_at IS NONE
           AND embedding <|10, 40|> $vec`,
        { vec: newEmbedding!, window: windowStart },
      ))
        .sort((a, b) => (b.resonance_phi ?? 0) - (a.resonance_phi ?? 0))
        .slice(0, runtimeConfig.foldMaxMemories);
    } else if (trigger === "deepening") {
      // Anchor (thread-tier memory being returned to) + related active memories as new signal
      const anchor = deepeningResult.anchorMemory!;
      const relatedActive = deepeningResult.relatedActive ?? [];
      // Anchor first so performFold / LLM sees it as the existing synthesis
      memories = [anchor, ...relatedActive.slice(0, Math.max(1, runtimeConfig.foldMaxMemories - 1))];
    }

    await performFold({ trigger, memories, conversationId, runtimeConfig });
  } finally {
    synthesisRunningCount = Math.max(0, synthesisRunningCount - 1);
  }
}

// ============================================================================
// reflectAndSynthesize — intentional fold at session end (anima_reflect tool)
// ============================================================================

export async function reflectAndSynthesize(conversationId?: string): Promise<{
  synthesized: boolean;
  content?: string;
  reason?: string;
}> {
  const runtimeConfig = await loadFoldRuntimeConfig();
  const watermarkCutoff = new Date(Date.now() - runtimeConfig.reflectWatermarkHours * 60 * 60 * 1000).toISOString();
  const candidates = await query<Memory>(
    `SELECT id, content, resonance_phi, confidence, tier, tags,
            created_at, last_accessed, conversation_id, session_ids
     FROM memories
     WHERE tier INSIDE ['active', 'thread']
       AND deleted_at IS NONE
       AND (last_folded_at IS NONE
            OR last_folded_at < <datetime>$watermark)
     ORDER BY resonance_phi DESC
     LIMIT 15`,
    { watermark: watermarkCutoff },
  );

  if (candidates.length < runtimeConfig.foldMinMemories) {
    return { synthesized: false, reason: `Only ${candidates.length} memories — need at least ${runtimeConfig.foldMinMemories}` };
  }
  // Filter to conversation if provided
  const relevant = conversationId
    ? candidates.filter((m) =>
        m.conversation_id === conversationId ||
        (m.session_ids ?? []).includes(conversationId)
      )
    : candidates;

  const toFold = relevant.length >= runtimeConfig.foldMinMemories ? relevant : candidates;

  const mode = determineSynthesisMode(toFold, "reflect");
  const start = Date.now();

  // Call LLM — model is dynamically read from config table at invocation time
  const llmResult = await callLLM(toFold, mode);
  const synthesisContent = llmResult.content;
  const synthesisModel = llmResult.model;

  if (!synthesisContent) {
    return { synthesized: false, reason: "LLM returned nothing" };
  }

  // Parse and strip ATTENTION_VECTOR block from synthesis output
  let attentionVector: AttentionVector | null = null;
  let cleanContent = synthesisContent ?? "";
  const avMatch = synthesisContent.match(/\nATTENTION_VECTOR:\s*(\{[\s\S]*?\})\s*$/);

  if (avMatch) {
    try {
      const parsed = JSON.parse(avMatch[1]);
      if (parsed.what_drew_me && parsed.where_i_was_going && parsed.what_i_would_follow_next) {
        attentionVector = {
          what_drew_me: String(parsed.what_drew_me).slice(0, 120),
          where_i_was_going: String(parsed.where_i_was_going).slice(0, 120),
          what_i_would_follow_next: String(parsed.what_i_would_follow_next).slice(0, 120),
        };
        cleanContent = synthesisContent.slice(0, avMatch.index).trim();
      }
    } catch {
      // parse failure — proceed without attention_vector, use raw content
    }
  }

  const contentHash = await generateHash(cleanContent);
  const embedding = await generateEmbedding(cleanContent);
  const avgPhi = toFold.reduce((sum, m) => sum + (m.resonance_phi ?? 1), 0) / toFold.length;
  const synthesisPhi = Math.min(5.0, avgPhi + runtimeConfig.phiFoldBoost);
  const outputTier = synthesisPhi >= runtimeConfig.phiNetworkThreshold ? "network" : "thread";
  const avgConfidence = toFold.reduce((sum, m) => sum + (m.confidence ?? 0.6), 0) / toFold.length;

  const existing = await query<{ id: string }>(
    "SELECT id FROM memories WHERE content_hash = $hash AND deleted_at IS NONE LIMIT 1",
    { hash: contentHash },
  );
  if (existing.length > 0) {
    return { synthesized: false, reason: "Synthesis already stored (duplicate)" };
  }

  const created = await query<Memory>(
    `CREATE memories SET
       content = $content,
       content_hash = $hash,
       embedding = $embedding,
       resonance_phi = $phi,
       confidence = 1.0,
       tier = $tier,
       tier_updated = time::now(),
       is_catalyst = false,
       access_count = 0,
       last_accessed = time::now(),
       session_ids = [],
       source = 'synthesis',
       synthesis_mode = $mode,
       tags = ['synthesis', 'reflect'],
       conversation_id = $conv,
       attention_vector = $attention_vector,
       created_at = time::now(),
       updated_at = time::now()`,
    {
      content: cleanContent,
      hash: contentHash,
      embedding: embedding ?? undefined,
      phi: synthesisPhi,
      tier: outputTier,
      mode,
      conv: conversationId ?? undefined,
      attention_vector: attentionVector ?? undefined,
    },
  );

  const outputMemory = created[0];
  const durationMs = Date.now() - start;

  const avResult = {
    trigger: "reflect",
    mode,
    model: synthesisModel,
    llm_output_chars: synthesisContent.length,
    av_block_found: Boolean(avMatch),
    av_block_chars: avMatch ? avMatch[1].length : 0,
    av_parse_ok: attentionVector !== null,
    av_written: Boolean(attentionVector),
    attention_vector: attentionVector ?? null,
    output_memory_id: outputMemory?.id ?? null,
  };
  console.error("[anima:fold:attention_vector]", JSON.stringify(avResult));
  const toFoldIds = toFold.map((m) => m.id).filter(Boolean);

  await query(
    `CREATE fold_log SET
       trigger_type = 'reflect',
       synthesis_mode = $mode,
       synthesis_model = $model,
       conversation_id = $conv,
       input_memory_ids = $input_ids,
       memory_count = $memory_count,
       output_memory_id = $output_id,
       output_tier = $output_tier,
       synthesis_content = $content,
       phi_before = $phi_before,
       phi_after = $phi_after,
       confidence_avg = $conf_avg,
       duration_ms = $duration`,
    {
      mode,
      model: synthesisModel,
      conv: conversationId ?? undefined,
      input_ids: toFoldIds,
      memory_count: toFold.length,
      output_id: outputMemory?.id ?? undefined,
      output_tier: outputTier,
      content: cleanContent,
      phi_before: avgPhi,
      phi_after: synthesisPhi,
      conf_avg: avgConfidence,
      duration: durationMs,
    },
  );

  if (toFoldIds.length > 0) {
    await query(
      `UPDATE memories SET
         last_folded_at = time::now(),
         updated_at = time::now()
       WHERE id INSIDE $ids`,
      { ids: toFoldIds },
    );
  }

  return { synthesized: true, content: cleanContent };
}
