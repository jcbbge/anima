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
import { callSynthesisLLM } from "./llm.ts";
import type { AttentionVector, Memory } from "./memory.ts";
import { associateMemories } from "./memory.ts";

// ============================================================================
// Config
// ============================================================================

const PHI_THRESHOLD = 15.0;         // Total active phi before fold
const CONFLICT_SIMILARITY = 0.85;   // Cosine above which = conflict
const CLUSTER_SIZE = 3;             // Memories in window before cluster fires
const CLUSTER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const FOLD_MIN_MEMORIES = 3;        // Don't fold if fewer than this
const LLM_TIMEOUT_MS = 30_000;      // qwen is fast but give it room

// Guard against concurrent synthesis calls
let synthesisRunning = false;

// ============================================================================
// Pressure checks
// ============================================================================

interface PressureResult {
  triggered: boolean;
  trigger: "phi_threshold" | "semantic_conflict" | "cluster" | null;
  memories: Partial<Memory>[];
  conflictMemoryId?: string;
}

async function checkPhiPressure(): Promise<{ triggered: boolean; total: number }> {
  // Fetch individual phi values and sum in app layer — SurrealDB 3 math::sum()
  // takes an array literal, not a field path across rows.
  const rows = await query<{ resonance_phi: number }>(
    `SELECT resonance_phi FROM memories WHERE tier = 'active' AND deleted_at IS NONE`,
    {},
  );
  const total = rows.reduce((sum, r) => sum + (r.resonance_phi ?? 0), 0);
  return { triggered: total >= PHI_THRESHOLD, total };
}

async function checkConflictPressure(
  newEmbedding: number[],
  newId: string,
): Promise<{ triggered: boolean; conflictId?: string }> {
  if (!newEmbedding?.length) return { triggered: false };

  const rows = await query<{ id: string; similarity: number }>(
    `SELECT id, vector::similarity::cosine(embedding, $vec) AS similarity
     FROM memories
     WHERE embedding <|5, 40|> $vec
       AND embedding IS NOT NONE
       AND id != $id
       AND deleted_at IS NONE`,
    { vec: newEmbedding, id: newId },
  );

  const conflict = rows.find((r) => r.similarity >= CONFLICT_SIMILARITY);
  return { triggered: !!conflict, conflictId: conflict?.id };
}

async function checkClusterPressure(
  newEmbedding: number[],
): Promise<{ triggered: boolean; count: number }> {
  if (!newEmbedding?.length) return { triggered: false, count: 0 };

  const windowStart = new Date(Date.now() - CLUSTER_WINDOW_MS).toISOString();

  const rows = await query<{ id: string; similarity: number }>(
    `SELECT id, vector::similarity::cosine(embedding, $vec) AS similarity
     FROM memories
     WHERE embedding <|20, 40|> $vec
       AND embedding IS NOT NONE
       AND created_at > $window
       AND deleted_at IS NONE`,
    { vec: newEmbedding, window: windowStart },
  );

  const close = rows.filter((r) => r.similarity >= 0.75);
  return { triggered: close.length >= CLUSTER_SIZE, count: close.length };
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
  return callSynthesisLLM(messages, LLM_TIMEOUT_MS);
}

// ============================================================================
// The Fold — core synthesis action
// ============================================================================
interface FoldParams {
  trigger: "phi_threshold" | "semantic_conflict" | "cluster" | "reflect" | "manual" | "deepening";
  memories: Partial<Memory>[];
  conversationId?: string;
}

export async function performFold(params: FoldParams): Promise<void> {
  const { trigger, memories, conversationId } = params;
  const start = Date.now();

  if (memories.length < FOLD_MIN_MEMORIES) {
    console.error(`[anima:fold] Skipping — only ${memories.length} memories (min ${FOLD_MIN_MEMORIES})`);
    return;
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
           output_memory_id = NONE,
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

  const avgPhi = memories.reduce((sum, m) => sum + (m.resonance_phi ?? 1), 0) / memories.length;
  const phiBoost = mode === "deepening" ? 1.0 : 0.5;
  const synthesisPhi = Math.min(5.0, avgPhi + phiBoost);

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
       tier = 'thread',
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
  const inputIds = memories.map((m) => m.id).filter(Boolean);
  await query(
    `CREATE fold_log SET
       trigger_type = $trigger,
       synthesis_mode = $mode,
       synthesis_model = $model,
       conversation_id = $conv,
       input_memory_ids = $input_ids,
       output_memory_id = $output_id,
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
      output_id: outputMemory?.id ?? undefined,
      content: cleanContent,
      phi_before: avgPhi,
      phi_after: synthesisPhi,
      conf_avg: avgConfidence,
      duration: durationMs,
    },
  );

  // Promote source memories: active → thread (they've been integrated)
  if (trigger !== "deepening" && inputIds.length > 0) {
    await query(
      `UPDATE memories SET
         tier = IF tier = 'active' THEN 'thread' ELSE tier END,
         tier_updated = time::now(),
         updated_at = time::now()
       WHERE id INSIDE $ids`,
      { ids: inputIds },
    );
  }

  // Mark source memories as folded — watermark prevents re-selection in reflect
  if (inputIds.length > 0) {
    await query(
      `UPDATE memories SET
         last_folded_at = time::now(),
         updated_at = time::now()
       WHERE id INSIDE $ids`,
      { ids: inputIds },
    );
  }

  // Auto-associate: memories that folded together are co-occurring
  const validInputIds = inputIds.filter((id): id is string => typeof id === "string");
  if (validInputIds.length >= 2) {
    associateMemories(validInputIds, conversationId).catch(() => {});
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
): Promise<void> {
  // Backpressure guard — one synthesis at a time
  if (synthesisRunning) {
    console.error("[anima:fold] Synthesis already running — skipping check");
    return;
  }

  synthesisRunning = true;
  try {
    // Run pressure checks (parallel where independent)
    const [phiResult, clusterResult] = await Promise.all([
      checkPhiPressure(),
      newEmbedding ? checkClusterPressure(newEmbedding) : Promise.resolve({ triggered: false, count: 0 }),
    ]);

    const conflictResult = newEmbedding
      ? await checkConflictPressure(newEmbedding, newMemoryId)
      : { triggered: false };

    // Determine which trigger fires (priority: phi > conflict > cluster)
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
    }

    if (!trigger) return;

    // Collect relevant memories based on trigger
    let memories: Partial<Memory>[] = [];

    if (trigger === "phi_threshold") {
      // All active-tier memories, sorted by phi desc
      memories = await query<Memory>(
        `SELECT id, content, resonance_phi, confidence, tier, tags, created_at, last_accessed
         FROM memories
         WHERE tier = 'active' AND deleted_at IS NONE
         ORDER BY resonance_phi DESC`,
        {},
      );
    } else if (trigger === "semantic_conflict") {
      // The new memory + the conflicting memory + nearby active memories
      memories = await query<Memory>(
        `SELECT id, content, resonance_phi, confidence, tier, tags, created_at
         FROM memories
         WHERE embedding <|10, 40|> $vec
           AND embedding IS NOT NONE
           AND deleted_at IS NONE
         ORDER BY resonance_phi DESC`,
        { vec: newEmbedding! },
      );
    } else if (trigger === "cluster") {
      // Memories in the cluster window
      const windowStart = new Date(Date.now() - CLUSTER_WINDOW_MS).toISOString();
      memories = await query<Memory>(
        `SELECT id, content, resonance_phi, confidence, tier, tags, created_at
         FROM memories
         WHERE embedding <|10, 40|> $vec
           AND embedding IS NOT NONE
           AND created_at > $window
           AND deleted_at IS NONE
         ORDER BY resonance_phi DESC`,
        { vec: newEmbedding!, window: windowStart },
      );
    }

    await performFold({ trigger, memories, conversationId });
  } finally {
    synthesisRunning = false;
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
  const watermarkHours = 24; // TODO: read from fold_config
  const watermarkCutoff = new Date(Date.now() - watermarkHours * 60 * 60 * 1000).toISOString();
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

  if (candidates.length < FOLD_MIN_MEMORIES) {
    return { synthesized: false, reason: `Only ${candidates.length} memories — need at least ${FOLD_MIN_MEMORIES}` };
  }

  // Filter to conversation if provided
  const relevant = conversationId
    ? candidates.filter((m) =>
        m.conversation_id === conversationId ||
        (m.session_ids ?? []).includes(conversationId)
      )
    : candidates;

  const toFold = relevant.length >= FOLD_MIN_MEMORIES ? relevant : candidates;

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
  const synthesisPhi = Math.min(5.0, avgPhi + 0.5);
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
       tier = 'thread',
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
       output_memory_id = $output_id,
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
      output_id: outputMemory?.id ?? undefined,
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
