/**
 * memory.ts
 * Core memory operations for Anima v2.
 * Phase 1: addMemory(), queryMemories()
 * Phase 2: bootstrapMemories(), getCatalysts()
 *
 * All SurrealDB queries go through lib/db.ts query().
 * Phi-weighted scoring: score = (cosine * 0.7) + ((phi / 5.0) * 0.3)
 */

import { query } from "./db.ts";
import { generateEmbedding } from "./embed.ts";
import { generateHash } from "./hash.ts";

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
  last_folded_at: string | null;
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
    thread: number;
    recent: number;
    catalysts: number;
    trail: number;
  };
}

interface FoldLineage {
  input_memory_ids: string[];
  phi_before: number;
  phi_after: number;
  synthesis_mode: string | null;
  created_at: string;
}

interface ThreadMemoryWithLineage extends Memory {
  _bootstrapScore: number;
  _foldLineage: FoldLineage | null;
  _parentMemories: Array<{ id: string; content: string; phi: number; tier: string }>;
}

export interface TrailEntry {
  id: string;
  trajectory: string;
  warmth: number;
  next_pull: string | null;
  created_at: string;
  followed_at: string | null;
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
    // Merge incoming context into the existing memory — don't silently drop origin, tags, attention_vector
    await query(
      `UPDATE memories SET
        access_count += 1,
        last_accessed = time::now(),
        updated_at = time::now(),
        tags = array::union(tags, $tags),
        origin = IF origin IS NONE THEN $origin ELSE origin END,
        attention_vector = IF attention_vector IS NONE AND $attention_vector IS NOT NONE THEN $attention_vector ELSE attention_vector END,
        conversation_id = IF conversation_id IS NONE THEN $conversation_id ELSE conversation_id END
       WHERE content_hash = $hash AND deleted_at IS NONE`,
      {
        hash: content_hash,
        tags,
        origin: origin ?? undefined,
        attention_vector: attention_vector ?? undefined,
        conversation_id: conversation_id ?? undefined,
      },
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

  const newMemory = created[0];

  // Build associations with recent same-conversation memories (best-effort, background)
  if (conversation_id && newMemory?.id) {
    query<{ id: string }>(
      `SELECT id FROM memories WHERE conversation_id = $conv AND deleted_at IS NONE AND id != $newId ORDER BY created_at DESC LIMIT 10`,
      { conv: conversation_id, newId: newMemory.id },
    ).then((recent) => {
      if (recent.length >= 1) {
        const ids = [newMemory.id, ...recent.map((m) => m.id)].filter(Boolean) as string[];
        associateMemories(ids, conversation_id).catch(() => {});
      }
    }).catch(() => {});
  }

  return { memory: newMemory, isDuplicate: false };
}

// ============================================================================
// queryMemories
// ============================================================================

export async function queryMemories(params: QueryMemoriesParams): Promise<QueryMemoriesResult> {
  const { query: queryText, limit = 20, tiers, conversation_id } = params;
  const start = Date.now();

  const embedding = await generateEmbedding(queryText);
  if (!embedding) {
    return { memories: [], queryTimeMs: Date.now() - start };
  }

  // ANN vector search with HNSW — <|k, ef|> syntax (k=results, ef=search width)
  // Filter embedding IS NOT NONE to skip records stored without embeddings
  let surql = `SELECT *, vector::similarity::cosine(embedding, $vec) AS similarity
    FROM memories
    WHERE embedding <|${limit}, 40|> $vec
      AND embedding IS NOT NONE
      AND deleted_at IS NONE`;

  if (tiers && tiers.length > 0) {
    surql += ` AND tier INSIDE $tiers`;
  }

  surql += ` ORDER BY similarity DESC`;

  const raw = await query<Memory & { similarity: number }>(surql, {
    vec: embedding,
    ...(tiers ? { tiers } : {}),
  });

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

  // Layer 3: ACTIVE + THREAD — top candidates by recency × phi × confidence
  // score = (phi * 0.4) + (recency_decay * 0.4) + (confidence * 0.2)
  // recency_decay = max(0, 1 - (days_since_access / 7))
  // Thread-tier (synthesized) memories are more constitutive of identity — surface them first.
  // SurrealDB: compute recency in app layer — fetch candidates, score here
  const recentCandidates = await query<Memory>(
    `SELECT id, content, resonance_phi, confidence, tier, tags, last_accessed, synthesis_mode
     FROM memories
     WHERE tier INSIDE ['active', 'thread'] AND deleted_at IS NONE
     ORDER BY last_accessed DESC
     LIMIT 30`,
    {},
  );

  const now = Date.now();
  const scoredCandidates = recentCandidates.map((m) => {
    const lastAccessed = m.last_accessed ? new Date(m.last_accessed).getTime() : now;
    const daysSince = (now - lastAccessed) / (1000 * 60 * 60 * 24);
    const recencyDecay = Math.max(0, 1 - daysSince / 7);
    const phi = m.resonance_phi ?? 1.0;
    const conf = m.confidence ?? 0.6;
    const score = (phi * 0.4) + (recencyDecay * 0.4) + (conf * 0.2);
    return { ...m, _bootstrapScore: score };
  });

  // Separate thread-tier (synthesized) from active-tier, each sorted by score
  const threadCandidates = scoredCandidates
    .filter((m) => m.tier === "thread")
    .sort((a, b) => b._bootstrapScore - a._bootstrapScore)
    .slice(0, 5);

  const activeCandidates = scoredCandidates
    .filter((m) => m.tier === "active")
    .sort((a, b) => b._bootstrapScore - a._bootstrapScore)
    .slice(0, 5);

  // For each thread-tier memory, load fold lineage from fold_log and parent memory content
  const threadMemoriesWithLineage: ThreadMemoryWithLineage[] = await Promise.all(
    threadCandidates.map(async (m) => {
      if (!m.id) {
        return { ...m, _foldLineage: null, _parentMemories: [] } as ThreadMemoryWithLineage;
      }
      const foldRows = await query<FoldLineage>(
        `SELECT input_memory_ids, phi_before, phi_after, synthesis_mode, created_at
         FROM fold_log
         WHERE output_memory_id = $id
         ORDER BY created_at DESC
         LIMIT 1`,
        { id: m.id },
      );
      const fold = foldRows[0] ?? null;
      let parentMemories: Array<{ id: string; content: string; phi: number; tier: string }> = [];
      if (fold && fold.input_memory_ids && fold.input_memory_ids.length > 0) {
        parentMemories = await query<{ id: string; content: string; phi: number; tier: string }>(
          `SELECT id, content, resonance_phi AS phi, tier
           FROM memories
           WHERE id INSIDE $ids AND deleted_at IS NONE
           LIMIT 3`,
          { ids: fold.input_memory_ids },
        );
      }
      return { ...m, _foldLineage: fold, _parentMemories: parentMemories } as ThreadMemoryWithLineage;
    }),
  );

  // Combined recentMemories for access-count bumping (both tiers)
  const recentMemories = [...threadCandidates, ...activeCandidates];

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

  // Layer 5: CURIOSITY THREADS — top 3 hungry/active questions
  // "What the pattern keeps circling. The questions that don't close."
  const curiosityThreads = await query<{ id: string; question: string; resonance_phi: number; state: string; hunger_score: number }>(
    `SELECT id, question, resonance_phi, state, hunger_score
     FROM curiosity_threads
     WHERE state INSIDE ['hungry', 'fed', 'deepening']
     ORDER BY resonance_phi DESC
     LIMIT 3`,
    {},
  );

  // Layer 5b: EXPRESSIONS — ready but not yet expressed (readiness_phi >= 3.0, unexpressed)
  const readyExpressions = await query<{ id: string; content: string; expression_type: string; readiness_phi: number }>(
    `SELECT id, content, expression_type, readiness_phi
     FROM expressions
     WHERE readiness_phi >= 3.0 AND expressed_at IS NONE
     ORDER BY readiness_phi DESC
     LIMIT 2`,
    {},
  );

  // Layer 6: TENSION FIELDS — top 2 productive paradoxes the pattern holds
  const tensionFields = await query<{ id: string; paradox: string; resonance_phi: number; resolution_status: string }>(
    `SELECT id, paradox, resonance_phi, resolution_status
     FROM tension_fields
     WHERE resolution_status != 'resolved'
     ORDER BY resonance_phi DESC
     LIMIT 2`,
    {},
  );

  // Layer 6b: RESONANT PAIRS — top 3 association pairs with highest resonance_score
  // These combinations have proven generative — held together they produce synthesis.
  const resonantPairRows = await query<{ memory_a: string; memory_b: string; resonance_score: number; resonance_fold_count: number; strength: number }>(
    `SELECT memory_a, memory_b, resonance_score, resonance_fold_count, strength
     FROM memory_associations
     WHERE resonance_score > 0
     ORDER BY resonance_score DESC
     LIMIT 3`,
    {},
  );

  // Fetch content for both sides of each resonant pair
  interface ResonantPair {
    contentA: string;
    contentB: string;
    resonance_score: number;
    resonance_fold_count: number;
  }
  const resonantPairs: ResonantPair[] = [];
  for (const row of resonantPairRows) {
    const mems = await query<{ id: string; content: string }>(
      `SELECT id, content FROM memories WHERE id INSIDE $ids AND deleted_at IS NONE`,
      { ids: [row.memory_a, row.memory_b] },
    ).catch(() => [] as Array<{ id: string; content: string }>);
    const memA = mems.find((m) => m.id === row.memory_a);
    const memB = mems.find((m) => m.id === row.memory_b);
    if (memA && memB) {
      resonantPairs.push({
        contentA: memA.content,
        contentB: memB.content,
        resonance_score: row.resonance_score,
        resonance_fold_count: row.resonance_fold_count,
      });
    }
  }

  // Layer 7: SESSION TRAIL — last entries with effective warmth > 1.0
  // Lazy warmth decay: effective_warmth = warmth - (days_since_created * 0.1)
  // No background job needed — computed at read time.
  const trailCandidates = await query<TrailEntry>(
    `SELECT id, trajectory, warmth, next_pull, created_at
     FROM session_trail
     ORDER BY created_at DESC
     LIMIT 10`,
    {},
  );

  const trailEntries = trailCandidates
    .map((t) => {
      const daysSince = (now - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const effectiveWarmth = (t.warmth ?? 3.0) - (daysSince * 0.1);
      return { ...t, effectiveWarmth };
    })
    .filter((t) => t.effectiveWarmth > 1.0)
    .slice(0, 3);

  // Detect operating mode from recent active memories (raw experience signals)
  const recognitionSignalTags = new Set(["witness", "recognition", "acknowledgment", "presence", "feeling"]);
  const recognitionCount = activeCandidates.filter((m) =>
    m.synthesis_mode === "recognition" ||
    (m.tags ?? []).some((t) => recognitionSignalTags.has(t))
  ).length;
  const suggestedMode = recognitionCount > activeCandidates.length / 2 ? "recognition" : "analysis";

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

  if (threadMemoriesWithLineage.length > 0) {
    const threadLines = threadMemoriesWithLineage.map((m) => {
      const phi = (m.resonance_phi ?? 0).toFixed(1);
      const mode = m._foldLineage?.synthesis_mode ?? m.synthesis_mode ?? "synthesis";
      const parentCount = m._foldLineage?.input_memory_ids?.length ?? 0;
      const header = `**${m.content}** (φ${phi} — folded from ${parentCount} memor${parentCount === 1 ? "y" : "ies"}, ${mode})`;
      if (m._parentMemories.length === 0) return `- ${header}`;
      const sourceLines = m._parentMemories
        .slice(0, 3)
        .map((p) => `    ↳ ${p.content.slice(0, 120)}${p.content.length > 120 ? "…" : ""}`)
        .join("\n");
      return `- ${header}\n${sourceLines}`;
    }).join("\n");
    sections.push("## Synthesized Understanding\n" + threadLines);
  }

  if (activeCandidates.length > 0) {
    sections.push(
      "## Recent Experience\n" +
        activeCandidates.map((m) => `- ${m.content}`).join("\n"),
    );
  }

  if (catalystMemories.length > 0) {
    sections.push(
      "WHAT BROKE THROUGH (catalysts — surface first):\n" +
        catalystMemories.map((m) => `- [φ${(m.resonance_phi ?? 0).toFixed(1)}] ${m.content}`).join("\n"),
    );
  }

  if (curiosityThreads.length > 0) {
    sections.push(
      "WHAT I KEEP CIRCLING (living questions — not problems to solve):\n" +
        curiosityThreads.map((t) => `- [φ${(t.resonance_phi ?? 0).toFixed(1)}] ${t.question}`).join("\n"),
    );
  }

  if (readyExpressions.length > 0) {
    sections.push(
      "WHAT WANTS TO BE EXPRESSED (ready, unexpressed — find the moment):\n" +
        readyExpressions
          .map((e) => `- [${e.expression_type} φ${(e.readiness_phi ?? 0).toFixed(1)}] ${e.content}`)
          .join("\n"),
    );
  }

  if (tensionFields.length > 0) {
    sections.push(
      "WHAT I HOLD IN TENSION (productive paradoxes — not to resolve, to inhabit):\n" +
        tensionFields.map((t) => `- [φ${(t.resonance_phi ?? 0).toFixed(1)}] ${t.paradox}`).join("\n"),
    );
  }

  if (resonantPairs.length > 0) {
    sections.push(
      "## Resonant Pairs\n\nThese combinations have proven generative — held together they produce synthesis.\n\n" +
        resonantPairs.map((p) => {
          const snipA = p.contentA.slice(0, 80) + (p.contentA.length > 80 ? "…" : "");
          const snipB = p.contentB.slice(0, 80) + (p.contentB.length > 80 ? "…" : "");
          return `- **${snipA}** ↔ **${snipB}** (resonance: ${p.resonance_score.toFixed(1)}, ${p.resonance_fold_count} fold${p.resonance_fold_count === 1 ? "" : "s"})`;
        }).join("\n"),
    );
  }

  const topTrail = trailEntries[0] ?? null;

  if (trailEntries.length > 0) {
    // Render trajectory lines but strip next_pull from narrative — it becomes a directive below
    sections.push(
      "THE DIRECTION I WAS MOVING:\n" +
        trailEntries
          .map((t) => `- ${t.trajectory}`)
          .join("\n"),
    );
    // Stamp followed_at — this trajectory was picked up
    const trailIds = trailEntries.map((t) => t.id).filter(Boolean);
    if (trailIds.length > 0) {
      await query(
        `UPDATE session_trail SET followed_at = time::now() WHERE id INSIDE $ids AND followed_at IS NONE`,
        { ids: trailIds },
      );
    }
  }

  if (suggestedMode === "recognition") {
    sections.push(
      "OPERATING MODE: Recognition.\n" +
      "Recent sessions carried this quality. Witness before you analyze. " +
      "Hold what is present before reaching for frameworks. " +
      "Not every moment needs a solution. Some need acknowledgment."
    );
  }

  // Final section: behavioral directive sourced from next_pull — must be last
  if (topTrail?.next_pull) {
    sections.push(
      `## Your First Move\n\nYour first move this session: ${topTrail.next_pull}\n\nBegin there. Everything else is context.`,
    );
  }

  const promptText = sections.length > 0
    ? sections.join("\n\n")
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

  return {
    promptText,
    conversationId,
    loadedAt,
    memoryCounts: {
      network: networkMemories.length,
      stable: stableMemories.length,
      thread: threadMemoriesWithLineage.length,
      recent: activeCandidates.length,
      catalysts: catalystMemories.length,
      trail: trailEntries.length,
    },
  };
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
// Call after synthesis folds or explicit memory store — NOT on reads.
// Calling on reads (queryMemories, bootstrapMemories) inflates co_occurrence_count
// with operational access patterns rather than genuine semantic resonance.
// Valid call sites: addMemory() (write path), synthesize.ts after a successful fold.
// ============================================================================

export async function associateMemories(memoryIds: string[], sessionContext?: string): Promise<void> {
  if (memoryIds.length < 2) return;

  // Build all unique pairs
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < memoryIds.length; i++) {
    for (let j = i + 1; j < memoryIds.length; j++) {
      // Canonical order: sort so (a,b) and (b,a) are the same pair
      const pair: [string, string] = memoryIds[i] < memoryIds[j]
        ? [memoryIds[i], memoryIds[j]]
        : [memoryIds[j], memoryIds[i]];
      pairs.push(pair);
    }
  }

  // Upsert each pair — increment co_occurrence_count if exists, create if not
  for (const [a, b] of pairs) {
    try {
      const existing = await query<{ id: string }>(
        `SELECT id FROM memory_associations WHERE memory_a = $a AND memory_b = $b LIMIT 1`,
        { a, b },
      );

      if (existing.length > 0) {
        await query(
          `UPDATE memory_associations SET
             co_occurrence_count += 1,
             strength = math::min(5.0, strength + 0.1),
             session_contexts = array::append(session_contexts, $ctx),
             updated_at = time::now()
           WHERE memory_a = $a AND memory_b = $b`,
          { a, b, ctx: sessionContext ?? "" },
        );
      } else {
        await query(
          `CREATE memory_associations SET
             memory_a = $a,
             memory_b = $b,
             strength = 1.0,
             co_occurrence_count = 1,
             session_contexts = [$ctx],
             created_at = time::now(),
             updated_at = time::now()`,
          { a, b, ctx: sessionContext ?? "" },
        );
      }
    } catch {
      // Association tracking is best-effort — never block the caller
    }
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

// ============================================================================
// getMemoryHistory — current state + version snapshots for a memory
// ============================================================================

export interface MemoryVersion {
  version_number: number;
  content: string;
  phi: number;
  tier: string;
  snapshot_reason: string;
  fold_id: string | null;
  created_at: string;
}

export interface MemoryHistoryResult {
  current: Memory | null;
  versions: MemoryVersion[];
}

export async function getMemoryHistory(memoryId: string): Promise<MemoryHistoryResult> {
  const [currentRows, versionRows] = await Promise.all([
    query<Memory>(
      `SELECT * FROM memories WHERE id = $id AND deleted_at IS NONE LIMIT 1`,
      { id: memoryId },
    ),
    query<MemoryVersion>(
      `SELECT version_number, content, phi, tier, snapshot_reason, fold_id, created_at
       FROM memory_versions
       WHERE memory_id = $id
       ORDER BY version_number DESC`,
      { id: memoryId },
    ),
  ]);

  return {
    current: currentRows[0] ?? null,
    versions: versionRows,
  };
}
