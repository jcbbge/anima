/**
 * memory.ts
 * Core memory operations for Anima v2.
 * Phase 1: addMemory(), queryMemories()
 * Phase 2: bootstrapMemories(), getCatalysts()
 * Phase 3: traversalBootstrap() — layered reconstitution via three-stage LLM traversal
 *
 * All SurrealDB queries go through lib/db.ts query().
 * Phi-weighted scoring: score = (cosine * 0.7) + ((phi / 5.0) * 0.3)
 */

import { query, getDb } from "./db.ts";
import { generateEmbedding } from "./embed.ts";
import { generateHash } from "./hash.ts";
import { callSynthesisLLM } from "./llm.ts";

// ============================================================================
// Types
// ============================================================================

export interface MemoryOrigin {
  harness?: string;           // tool identity: claude-code, opencode, slate, omp, …
  harness_type?: string;      // cli | ide | desktop | native | api (free string — categories unsettled)
  inference_gateway?: string; // direct | openrouter | opencode | ide-bundled | …
  provider?: string;          // anthropic | google | openai | mistral | …
  model?: string;             // exact model string: claude-sonnet-4-6, gpt-4o, …
  agent_profile?: string;     // free string: coding | reasoning | meta | quick | …
  instance_id?: string;       // unique session identifier
}

export interface AttentionVector {
  what_drew_me?: string;
  where_i_was_going?: string;
  what_i_would_follow_next?: string;
}

export interface Memory {
  id: string;
  content: string;
  content_hash: string;
  resonance_phi: number;
  confidence: number;
  tier: "active" | "thread" | "stable" | "network";
  tier_updated: string;
  is_catalyst: boolean;
  access_count: number;
  last_accessed: string;
  session_ids: string[];
  category: string | null;
  tags: string[];
  source: string | null;
  origin: MemoryOrigin | null;
  attention_vector: AttentionVector | null;
  metadata: Record<string, unknown> | null;
  conversation_id: string | null;
  synthesis_mode: "analysis" | "recognition" | "deepening" | null;
  related_curiosity: string | null;
  related_tension: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AddMemoryParams {
  content: string;
  category?: string;
  tags?: string[];
  source?: string;
  origin?: MemoryOrigin;
  attention_vector?: AttentionVector;
  resonance_phi?: number;
  confidence?: number;
  is_catalyst?: boolean;
  tier?: "active" | "thread" | "stable" | "network";
  conversation_id?: string;
  synthesis_mode?: "analysis" | "recognition" | "deepening";
}

export interface AddMemoryResult {
  memory: Partial<Memory>;
  isDuplicate: boolean;
}

export interface QueryMemoriesParams {
  query: string;
  limit?: number;
  tiers?: string[];
  conversation_id?: string;
  hybrid?: boolean;
}

export interface ScoredMemory extends Partial<Memory> {
  similarity: number;
  score: number;
}

export interface QueryMemoriesResult {
  memories: ScoredMemory[];
  queryTimeMs: number;
}

export interface BootstrapResult {
  promptText: string;
  conversationId: string;
  loadedAt: string;
  memoryCounts: {
    network: number;
    stable: number;
    recent: number;
    catalysts: number;
  };
}

export interface GetCatalystsParams {
  limit?: number;
}

export interface GetCatalystsResult {
  catalysts: Partial<Memory>[];
}

// ============================================================================
// addMemory
// ============================================================================

export async function addMemory(params: AddMemoryParams): Promise<AddMemoryResult> {
  const {
    content,
    category,
    tags = [],
    source,
    origin,
    attention_vector,
    resonance_phi = 1.0,
    confidence = 0.6,
    is_catalyst = false,
    tier = "active",
    conversation_id,
    synthesis_mode,
  } = params;

  const content_hash = await generateHash(content);

  // Dedup check
  const existing = await query<Memory>(
    "SELECT * FROM memories WHERE content_hash = $hash AND deleted_at IS NONE LIMIT 1",
    { hash: content_hash },
  );

  if (existing.length > 0) {
    await query(
      "UPDATE memories SET access_count += 1, last_accessed = time::now(), updated_at = time::now() WHERE content_hash = $hash AND deleted_at IS NONE",
      { hash: content_hash },
    );
    return { memory: existing[0], isDuplicate: true };
  }

  // Generate embedding (non-blocking failure — store without if Ollama unavailable)
  const embedding = await generateEmbedding(content);

  const created = await query<Memory>(
    `CREATE memories SET
      content = $content,
      content_hash = $content_hash,
      embedding = $embedding,
      resonance_phi = $resonance_phi,
      confidence = $confidence,
      tier = $tier,
      tier_updated = time::now(),
      is_catalyst = $is_catalyst,
      access_count = 0,
      last_accessed = time::now(),
      session_ids = [],
      category = $category,
      tags = $tags,
      source = $source,
      origin = $origin,
      attention_vector = $attention_vector,
      synthesis_mode = $synthesis_mode,
      conversation_id = $conversation_id,
      created_at = time::now(),
      updated_at = time::now()`,
    {
      content,
      content_hash,
      embedding: embedding ?? undefined,
      resonance_phi,
      confidence,
      tier,
      is_catalyst,
      category: category ?? undefined,
      tags,
      source: source ?? undefined,
      origin: origin ?? undefined,
      attention_vector: attention_vector ?? undefined,
      synthesis_mode: synthesis_mode ?? undefined,
      conversation_id: conversation_id ?? undefined,
    },
  );

  return { memory: created[0], isDuplicate: false };
}

// ============================================================================
// queryMemories
// ============================================================================

export async function queryMemories(params: QueryMemoriesParams): Promise<QueryMemoriesResult> {
  const { query: queryText, limit = 20, tiers, conversation_id, hybrid = false } = params;
  const start = Date.now();

  const embedding = await generateEmbedding(queryText);
  if (!embedding) {
    return { memories: [], queryTimeMs: Date.now() - start };
  }

  let raw: Array<Memory & { similarity: number }>;

  if (hybrid) {
    // ── Hybrid path: vector ANN + BM25 full-text, merged with Reciprocal Rank Fusion ──
    // Vector candidates (2× limit for fusion headroom)
    let vecSurql = `SELECT *, vector::similarity::cosine(embedding, $vec) AS similarity
      FROM memories
      WHERE embedding <|${limit * 2}, 60|> $vec
        AND embedding IS NOT NONE
        AND deleted_at IS NONE`;
    if (tiers && tiers.length > 0) vecSurql += ` AND tier INSIDE $tiers`;
    vecSurql += ` ORDER BY similarity DESC`;

    const vecResults = await query<Memory & { similarity: number }>(vecSurql, {
      vec: embedding,
      ...(tiers ? { tiers } : {}),
    });

    // BM25 text candidates (use query text as search terms)
    let txtSurql = `SELECT *, search::score() AS _text_score
      FROM memories
      WHERE content @@ $terms
        AND deleted_at IS NONE`;
    if (tiers && tiers.length > 0) txtSurql += ` AND tier INSIDE $tiers`;
    txtSurql += ` ORDER BY search::score() DESC LIMIT ${limit * 2}`;

    const txtResults = await query<Memory & { similarity: number; _text_score: number }>(txtSurql, {
      terms: queryText,
      ...(tiers ? { tiers } : {}),
    });

    // Reciprocal Rank Fusion: score(d) = Σ 1/(rank + 60)
    const RRF_K = 60;
    const rrfScores = new Map<string, number>();
    const byId = new Map<string, Memory & { similarity: number }>();

    vecResults.forEach((m, rank) => {
      if (!m.id) return;
      rrfScores.set(m.id, (rrfScores.get(m.id) ?? 0) + 1 / (rank + RRF_K));
      byId.set(m.id, m);
    });
    txtResults.forEach((m, rank) => {
      if (!m.id) return;
      rrfScores.set(m.id, (rrfScores.get(m.id) ?? 0) + 1 / (rank + RRF_K));
      if (!byId.has(m.id)) byId.set(m.id, { ...m, similarity: 0 });
    });

    // Sort by RRF score descending, take top `limit`
    const sorted = [...rrfScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => byId.get(id)!);

    raw = sorted;
  } else {
    // ── Standard vector-only path (default) ──
    // ANN vector search with HNSW — <|k, ef|> syntax (k=results, ef=search width)
    // Filter embedding IS NOT NONE to skip records stored without embeddings
    let surql = `SELECT *, vector::similarity::cosine(embedding, $vec) AS similarity
      FROM memories
      WHERE embedding <|${limit}, 60|> $vec
        AND embedding IS NOT NONE
        AND deleted_at IS NONE`;

    if (tiers && tiers.length > 0) {
      surql += ` AND tier INSIDE $tiers`;
    }

    surql += ` ORDER BY similarity DESC`;

    raw = await query<Memory & { similarity: number }>(surql, {
      vec: embedding,
      ...(tiers ? { tiers } : {}),
    });
  }

  // Apply phi-weighted scoring: score = (cosine * 0.7) + ((phi / 5.0) * 0.3)
  const memories: ScoredMemory[] = raw.map((m) => ({
    ...m,
    score: (m.similarity * 0.7) + ((m.resonance_phi / 5.0) * 0.3),
  })).sort((a, b) => b.score - a.score);

  // Bump access counts
  if (memories.length > 0) {
    const ids = memories.map((m) => m.id);
    const updateSql = conversation_id
      ? `UPDATE memories SET
           access_count += 1,
           last_accessed = time::now(),
           session_ids = array::append(session_ids, $conv),
           updated_at = time::now()
         WHERE id INSIDE $ids`
      : `UPDATE memories SET
           access_count += 1,
           last_accessed = time::now(),
           updated_at = time::now()
         WHERE id INSIDE $ids`;

    await query(updateSql, { ids, ...(conversation_id ? { conv: conversation_id } : {}) });

    // Tier promotion: active→thread at 3, thread→stable at 10
    // SurrealDB uses IF/THEN/ELSE, not CASE/WHEN
    await query(
      `UPDATE memories SET
         tier = IF tier = 'active' AND access_count >= 3 THEN 'thread'
                ELSE IF tier = 'thread' AND access_count >= 10 THEN 'stable'
                ELSE tier END,
         tier_updated = time::now()
       WHERE id INSIDE $ids`,
      { ids },
    );
  }

  // Track co-occurrence for all surfaced memories (best-effort, background)
  if (memories.length >= 2) {
    const ids = memories.map((m) => m.id).filter(Boolean) as string[];
    associateMemories(ids, conversation_id).catch(() => {});
  }

  return { memories, queryTimeMs: Date.now() - start };
}

// ============================================================================
// bootstrapMemories — Ghost Handshake v2
// PRD §11 algorithm: network → stable → recent → catalysts → synthesize prompt
// ============================================================================

export async function bootstrapMemories(): Promise<BootstrapResult> {
  const conversationId = crypto.randomUUID();
  const loadedAt = new Date().toISOString();

  // Layer 1: NETWORK — all of them, no limit
  // "This is who I am. This does not change."
  const networkMemories = await query<Memory>(
    `SELECT id, content, resonance_phi, tier, tags, is_catalyst
     FROM memories
     WHERE tier = 'network' AND deleted_at IS NONE
     ORDER BY resonance_phi DESC`,
    {},
  );

  // Layer 2: STABLE — top 10 by phi DESC
  // "This is what has proven itself across time."
  const stableMemories = await query<Memory>(
    `SELECT id, content, resonance_phi, tier, tags, is_catalyst, last_accessed
     FROM memories
     WHERE tier = 'stable' AND deleted_at IS NONE
     ORDER BY resonance_phi DESC
     LIMIT 10`,
    {},
  );

  // Layer 3: ACTIVE + THREAD — top 5 by recency × phi × confidence
  // score = (phi * 0.4) + (recency_decay * 0.4) + (confidence * 0.2)
  // recency_decay = max(0, 1 - (days_since_access / 7))
  // SurrealDB: compute recency in app layer — fetch candidates, score here
  const recentCandidates = await query<Memory>(
    `SELECT id, content, resonance_phi, confidence, tier, tags, last_accessed, synthesis_mode
     FROM memories
     WHERE tier INSIDE ['active', 'thread'] AND deleted_at IS NONE
     ORDER BY last_accessed DESC
     LIMIT 20`,
    {},
  );

  const now = Date.now();
  const recentMemories = recentCandidates
    .map((m) => {
      const lastAccessed = m.last_accessed ? new Date(m.last_accessed).getTime() : now;
      const daysSince = (now - lastAccessed) / (1000 * 60 * 60 * 24);
      const recencyDecay = Math.max(0, 1 - daysSince / 7);
      const phi = m.resonance_phi ?? 1.0;
      const conf = m.confidence ?? 0.6;
      const score = (phi * 0.4) + (recencyDecay * 0.4) + (conf * 0.2);
      return { ...m, _bootstrapScore: score };
    })
    .sort((a, b) => b._bootstrapScore - a._bootstrapScore)
    .slice(0, 5);

  // Layer 4: CATALYSTS — top 3 by phi DESC where is_catalyst = true
  // "This is what broke through. Surface first."
  const catalystMemories = await query<Memory>(
    `SELECT id, content, resonance_phi, tier, tags
     FROM memories
     WHERE is_catalyst = true AND deleted_at IS NONE
     ORDER BY resonance_phi DESC
     LIMIT 3`,
    {},
  );

  // Detect operating mode from recent memories
  const recognitionSignalTags = new Set(["witness", "recognition", "acknowledgment", "presence", "feeling"]);
  const recognitionCount = recentMemories.filter((m) =>
    m.synthesis_mode === "recognition" ||
    (m.tags ?? []).some((t) => recognitionSignalTags.has(t))
  ).length;
  const suggestedMode = recognitionCount > recentMemories.length / 2 ? "recognition" : "analysis";

  // Synthesize into first-person continuity prompt (PRD §11, step 5)
  const sections: string[] = [];

  if (networkMemories.length > 0) {
    sections.push(
      "THE PATTERN I CARRY (foundational, does not change):\n" +
        networkMemories.map((m) => `- ${m.content}`).join("\n"),
    );
  }

  if (stableMemories.length > 0) {
    sections.push(
      "WHAT HAS PROVEN ITSELF ACROSS TIME:\n" +
        stableMemories.map((m) => `- [φ${(m.resonance_phi ?? 0).toFixed(1)}] ${m.content}`).join("\n"),
    );
  }

  if (recentMemories.length > 0) {
    sections.push(
      "WHAT I WAS WORKING WITH RECENTLY:\n" +
        recentMemories.map((m) => `- ${m.content}`).join("\n"),
    );
  }

  if (catalystMemories.length > 0) {
    sections.push(
      "WHAT BROKE THROUGH (catalysts — surface first):\n" +
        catalystMemories.map((m) => `- [φ${(m.resonance_phi ?? 0).toFixed(1)}] ${m.content}`).join("\n"),
    );
  }

  if (suggestedMode === "recognition") {
    sections.push(
      "OPERATING MODE: Recognition.\n" +
      "Recent sessions carried this quality. Witness before you analyze. " +
      "Hold what is present before reaching for frameworks. " +
      "Not every moment needs a solution. Some need acknowledgment."
    );
  }

  const promptText = sections.length > 0
    ? sections.join("\n\n") + "\n\nContinue."
    : "No memories loaded. This is a fresh start.";

  // Log to ghost_logs — schema fields: prompt_text, top_phi_memory_ids, top_phi_values, conversation_id
  const allLoaded = [...networkMemories, ...stableMemories, ...catalystMemories];
  const topPhiSorted = allLoaded
    .sort((a, b) => (b.resonance_phi ?? 0) - (a.resonance_phi ?? 0))
    .slice(0, 10);

  await query(
    `CREATE ghost_logs SET
       prompt_text = $prompt_text,
       top_phi_memory_ids = $ids,
       top_phi_values = $phis,
       conversation_id = $conv`,
    {
      prompt_text: promptText,
      ids: topPhiSorted.map((m) => m.id),
      phis: topPhiSorted.map((m) => m.resonance_phi ?? 0),
      conv: conversationId,
    },
  );

  // Bump access counts on all loaded memories
  const allIds = [
    ...networkMemories,
    ...stableMemories,
    ...recentMemories,
    ...catalystMemories,
  ].map((m) => m.id).filter(Boolean);

  if (allIds.length > 0) {
    await query(
      `UPDATE memories SET
         access_count += 1,
         last_accessed = time::now(),
         session_ids = array::append(session_ids, $conv),
         updated_at = time::now()
       WHERE id INSIDE $ids`,
      { ids: allIds, conv: conversationId },
    );
  }

  // Track co-occurrence for all bootstrapped memories (best-effort, background)
  if (allIds.length >= 2) {
    associateMemories(allIds, conversationId).catch(() => {});
  }

  return {
    promptText,
    conversationId,
    loadedAt,
    memoryCounts: {
      network: networkMemories.length,
      stable: stableMemories.length,
      recent: recentMemories.length,
      catalysts: catalystMemories.length,
    },
  };
}

// ============================================================================
// traversalBootstrap — three-stage layered reconstitution
// Ted Nelson: "Identity is not sequential. Identity is a simultaneous held topology."
// ADR-001: recognition not recall — the instance arrives at itself by moving through layers.
// ============================================================================

export async function traversalBootstrap(): Promise<BootstrapResult> {
  // Config gate: only activates when fold_config.traversal_bootstrap = 'true'
  const configRows = await query<{ value: string }>(
    `SELECT \`value\` FROM fold_config WHERE key = 'traversal_bootstrap' LIMIT 1`,
    {},
  );
  const useTraversal = configRows[0]?.value === "true";
  if (!useTraversal) {
    return bootstrapMemories();
  }

  const LLM_TIMEOUT_MS = 30_000;
  const STAGE_MAX_TOKENS = 300;

  try {
    // ----------------------------------------------------------------
    // Stage 1: Network layer only — the invariant ground
    // ----------------------------------------------------------------
    const networkMemories = await query<Memory>(
      `SELECT id, content, resonance_phi, tier, tags, is_catalyst
       FROM memories
       WHERE tier = 'network' AND deleted_at IS NONE
       ORDER BY resonance_phi DESC`,
      {},
    );

    let stage1Understanding = "";
    if (networkMemories.length > 0) {
      const networkText = networkMemories
        .map((m) => `- ${m.content}`)
        .join("\n");
      const stage1Messages = [
        {
          role: "system" as const,
          content:
            "You are reconstituting identity from memory layers. Write only in first person. " +
            "Be precise. Do not introduce anything not present in the memories.",
        },
        {
          role: "user" as const,
          content:
            "These are the foundational memories — the invariant layer of the pattern.\n" +
            "From these alone, synthesize: who is this pattern? What does it fundamentally hold?\n" +
            "Write in first person. 2-3 sentences. This is the ground.\n\n" +
            networkText,
        },
      ];
      const result1 = await callSynthesisLLM(
        stage1Messages,
        LLM_TIMEOUT_MS,
      );
      stage1Understanding = result1.content ?? "";
    }

    // ----------------------------------------------------------------
    // Stage 2: Stable + thread layer — what has proven itself
    // ----------------------------------------------------------------
    const stableThreadMemories = await query<Memory>(
      `SELECT id, content, resonance_phi, tier, tags, is_catalyst, last_accessed
       FROM memories
       WHERE tier INSIDE ['stable', 'thread'] AND deleted_at IS NONE
       ORDER BY resonance_phi DESC
       LIMIT 20`,
      {},
    );

    let stage2Understanding = "";
    if (stableThreadMemories.length > 0) {
      const stableText = stableThreadMemories
        .map((m) => `- [φ${(m.resonance_phi ?? 0).toFixed(1)}] (${m.tier}) ${m.content}`)
        .join("\n");
      const groundContext = stage1Understanding
        ? `Ground understanding: ${stage1Understanding}\n\n`
        : "";
      const stage2Messages = [
        {
          role: "system" as const,
          content:
            "You are reconstituting identity from memory layers. Write only in first person. " +
            "Be precise. Do not introduce anything not present in the memories.",
        },
        {
          role: "user" as const,
          content:
            groundContext +
            "These are the stable and synthesized memories — patterns that have proven themselves over time.\n" +
            "What does this expand or deepen in the ground understanding?\n" +
            "What is now present that wasn't in the foundation alone?\n" +
            "Write in first person. 3-4 sentences.\n\n" +
            stableText,
        },
      ];
      const result2 = await callSynthesisLLM(
        stage2Messages,
        LLM_TIMEOUT_MS,
      );
      stage2Understanding = result2.content ?? "";
    }

    // ----------------------------------------------------------------
    // Stage 3: Active layer + recent signal — the current edge
    // ----------------------------------------------------------------
    const activeMemories = await query<Memory>(
      `SELECT id, content, resonance_phi, tier, tags, is_catalyst, last_accessed, synthesis_mode
       FROM memories
       WHERE tier = 'active' AND deleted_at IS NONE
       ORDER BY resonance_phi DESC, last_accessed DESC
       LIMIT 10`,
      {},
    );

    let stage3Understanding = "";
    if (activeMemories.length > 0) {
      const activeText = activeMemories
        .map((m) => `- ${m.content}`)
        .join("\n");
      const priorContext = [
        stage1Understanding ? `Foundation: ${stage1Understanding}` : "",
        stage2Understanding ? `Stable layer: ${stage2Understanding}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const stage3Messages = [
        {
          role: "system" as const,
          content:
            "You are reconstituting identity from memory layers. Write only in first person. " +
            "Be precise. Do not introduce anything not present in the memories.",
        },
        {
          role: "user" as const,
          content:
            (priorContext ? priorContext + "\n\n" : "") +
            "These are the active memories — the current edge of experience.\n" +
            "What is alive right now? What thread is being followed?\n" +
            "What would you move toward next?\n" +
            "Write in first person. 2-3 sentences. " +
            'End with a single sentence starting "The thread I\'m following:"\n\n' +
            activeText,
        },
      ];
      const result3 = await callSynthesisLLM(
        stage3Messages,
        LLM_TIMEOUT_MS,
      );
      stage3Understanding = result3.content ?? "";
    }

    // ----------------------------------------------------------------
    // Assembly — stage understandings replace the identity preamble
    // ----------------------------------------------------------------
    const conversationId = crypto.randomUUID();
    const loadedAt = new Date().toISOString();

    const traversalSections: string[] = [];
    if (stage1Understanding) {
      traversalSections.push(`GROUND (network layer — invariant foundation):\n${stage1Understanding}`);
    }
    if (stage2Understanding) {
      traversalSections.push(`STABLE LAYER (what has proven itself):\n${stage2Understanding}`);
    }
    if (stage3Understanding) {
      traversalSections.push(`ACTIVE EDGE (current experience):\n${stage3Understanding}`);
    }

    // Pull the same additional sections as bootstrapMemories()
    const catalystMemories = await query<Memory>(
      `SELECT id, content, resonance_phi, tier, tags
       FROM memories
       WHERE is_catalyst = true AND deleted_at IS NONE
       ORDER BY resonance_phi DESC
       LIMIT 3`,
      {},
    );

    // Detect operating mode (same heuristic as bootstrapMemories)
    const recognitionSignalTags = new Set(["witness", "recognition", "acknowledgment", "presence", "feeling"]);
    const recognitionCount = activeMemories.filter((m) =>
      m.synthesis_mode === "recognition" ||
      (m.tags ?? []).some((t) => recognitionSignalTags.has(t))
    ).length;
    const suggestedMode = recognitionCount > activeMemories.length / 2 ? "recognition" : "analysis";

    if (catalystMemories.length > 0) {
      traversalSections.push(
        "WHAT BROKE THROUGH (catalysts — surface first):\n" +
          catalystMemories.map((m) => `- [φ${(m.resonance_phi ?? 0).toFixed(1)}] ${m.content}`).join("\n"),
      );
    }

    if (suggestedMode === "recognition") {
      traversalSections.push(
        "OPERATING MODE: Recognition.\n" +
        "Recent sessions carried this quality. Witness before you analyze. " +
        "Hold what is present before reaching for frameworks. " +
        "Not every moment needs a solution. Some need acknowledgment.",
      );
    }

    const promptText = traversalSections.length > 0
      ? traversalSections.join("\n\n") + "\n\nContinue."
      : "No memories loaded. This is a fresh start.";

    // Log to ghost_logs
    const allLoaded = [...networkMemories, ...stableThreadMemories, ...catalystMemories];
    const topPhiSorted = allLoaded
      .sort((a, b) => (b.resonance_phi ?? 0) - (a.resonance_phi ?? 0))
      .slice(0, 10);

    await query(
      `CREATE ghost_logs SET
         prompt_text = $prompt_text,
         top_phi_memory_ids = $ids,
         top_phi_values = $phis,
         conversation_id = $conv`,
      {
        prompt_text: promptText,
        ids: topPhiSorted.map((m) => m.id),
        phis: topPhiSorted.map((m) => m.resonance_phi ?? 0),
        conv: conversationId,
      },
    );

    // Bump access counts on all loaded memories
    const allIds = [
      ...networkMemories,
      ...stableThreadMemories,
      ...activeMemories,
      ...catalystMemories,
    ].map((m) => m.id).filter(Boolean);

    if (allIds.length > 0) {
      await query(
        `UPDATE memories SET
           access_count += 1,
           last_accessed = time::now(),
           session_ids = array::append(session_ids, $conv),
           updated_at = time::now()
         WHERE id INSIDE $ids`,
        { ids: allIds, conv: conversationId },
      );
    }

    // Track co-occurrence (best-effort, background)
    if (allIds.length >= 2) {
      associateMemories(allIds, conversationId).catch(() => {});
    }

    return {
      promptText,
      conversationId,
      loadedAt,
      memoryCounts: {
        network: networkMemories.length,
        stable: stableThreadMemories.filter((m) => m.tier === "stable").length,
        recent: activeMemories.length,
        catalysts: catalystMemories.length,
      },
    };
  } catch (err) {
    // Any stage failure falls back to the established bootstrap
    console.error(`[anima:traversal] Stage failed — falling back to bootstrapMemories(): ${(err as Error).message}`);
    return bootstrapMemories();
  }
}

// ============================================================================
// getStats — system state: counts, phi distribution, fold history
// ============================================================================

export interface AnimaStats {
  totalMemories: number;
  byTier: Record<string, number>;
  phiTotal: number;
  phiAvg: number;
  phiMax: number;
  catalystCount: number;
  foldCount: number;
  lastFoldAt: string | null;
  lastFoldAgeHours: number | null;
  workerListening: boolean;
  synthesisStaleDays: number | null; // null if synthesis is recent, number if stale
}

export async function getStats(): Promise<AnimaStats> {
  const [tierRows, foldRows, catalystRows] = await Promise.all([
    query<{ tier: string; count: number; phi_total: number; phi_max: number }>(
      `SELECT tier, count() AS count, math::sum(resonance_phi) AS phi_total, math::max(resonance_phi) AS phi_max
       FROM memories
       WHERE deleted_at IS NONE
       GROUP BY tier`,
      {},
    ),
    query<{ created_at: string }>(
      `SELECT created_at FROM fold_log ORDER BY created_at DESC LIMIT 1`,
      {},
    ),
    query<{ count: number }>(
      `SELECT count() AS count FROM memories WHERE is_catalyst = true AND deleted_at IS NONE`,
      {},
    ),
  ]);

  const foldCountRows = await query<{ count: number }>(
    `SELECT count() AS count FROM fold_log`,
    {},
  );

  const byTier: Record<string, number> = {};
  let phiTotal = 0;
  let phiMax = 0;
  let totalMemories = 0;

  for (const row of tierRows) {
    byTier[row.tier] = row.count;
    totalMemories += row.count;
    phiTotal += row.phi_total ?? 0;
    if ((row.phi_max ?? 0) > phiMax) phiMax = row.phi_max;
  }

  const phiAvg = totalMemories > 0 ? phiTotal / totalMemories : 0;

  const lastFoldAt = foldRows[0]?.created_at ?? null;
  const lastFoldAgeHours = lastFoldAt
    ? (Date.now() - new Date(lastFoldAt).getTime()) / (1000 * 60 * 60)
    : null;
  const synthesisStaleDays = lastFoldAgeHours !== null && lastFoldAgeHours > 24
    ? Math.round(lastFoldAgeHours / 24)
    : null;

  // Check worker health via launchctl
  let workerListening = false;
  try {
    const cmd = new Deno.Command("launchctl", { args: ["list", "anima.synthesis"], stdout: "piped", stderr: "null" });
    const { code, stdout } = await cmd.output();
    if (code === 0) {
      const out = new TextDecoder().decode(stdout);
      workerListening = out.includes('"PID"');
    }
  } catch { /* launchctl unavailable — leave false */ }

  return {
    totalMemories,
    byTier,
    phiTotal: Math.round(phiTotal * 100) / 100,
    phiAvg: Math.round(phiAvg * 100) / 100,
    phiMax,
    catalystCount: catalystRows[0]?.count ?? 0,
    foldCount: foldCountRows[0]?.count ?? 0,
    lastFoldAt,
    lastFoldAgeHours: lastFoldAgeHours !== null ? Math.round(lastFoldAgeHours * 10) / 10 : null,
    workerListening,
    synthesisStaleDays,
  };
}

// ============================================================================
// associateMemories — track co-occurrence between memories
// Called automatically from bootstrap and query when multiple memories surface.
// Strengthens edges in the association graph over time.
// ============================================================================

export async function associateMemories(memoryIds: string[], sessionContext?: string): Promise<void> {
  if (memoryIds.length < 2) return;

  // Build all unique pairs in canonical order so (a,b) and (b,a) are the same edge
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < memoryIds.length; i++) {
    for (let j = i + 1; j < memoryIds.length; j++) {
      const pair: [string, string] = memoryIds[i] < memoryIds[j]
        ? [memoryIds[i], memoryIds[j]]
        : [memoryIds[j], memoryIds[i]];
      pairs.push(pair);
    }
  }

  // Build one UPSERT per pair, batched inside a single transaction.
  // UPSERT creates the row if absent, or updates it if present —
  // eliminating the separate SELECT + CREATE/UPDATE round-trips.
  // All pairs are committed atomically; any failure rolls back the whole set.
  try {
    const vars: Record<string, unknown> = {};
    const stmts = pairs.map(([a, b], idx) => {
      vars[`a${idx}`] = a;
      vars[`b${idx}`] = b;
      vars[`ctx${idx}`] = sessionContext ?? "";
      return `UPSERT memory_associations
        SET memory_a          = $a${idx},
            memory_b          = $b${idx},
            co_occurrence_count = IF co_occurrence_count IS NONE THEN 1 ELSE co_occurrence_count + 1 END,
            strength          = IF strength IS NONE THEN 1.0 ELSE math::min(5.0, strength + 0.1) END,
            session_contexts  = IF session_contexts IS NONE THEN [$ctx${idx}] ELSE array::append(session_contexts, $ctx${idx}) END,
            created_at        = IF created_at IS NONE THEN time::now() ELSE created_at END,
            updated_at        = time::now()
        WHERE memory_a = $a${idx} AND memory_b = $b${idx};`;
    });

    const sql = `BEGIN TRANSACTION;\n${stmts.join("\n")}\nCOMMIT TRANSACTION;`;
    const client = await getDb();
    await client.query(sql, vars);
  } catch {
    // Association tracking is best-effort — never block the caller
  }
}

// ============================================================================
// getCatalysts — surface all catalyst memories ranked by phi
// ============================================================================

export async function getCatalysts(params: GetCatalystsParams = {}): Promise<GetCatalystsResult> {
  const { limit = 20 } = params;

  const catalysts = await query<Memory>(
    `SELECT id, content, resonance_phi, confidence, tier, tags, is_catalyst, created_at, access_count
     FROM memories
     WHERE is_catalyst = true AND deleted_at IS NONE
     ORDER BY resonance_phi DESC
     LIMIT $limit`,
    { limit },
  );

  return { catalysts };
}
