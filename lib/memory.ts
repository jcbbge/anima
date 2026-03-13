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
  metadata: Record<string, unknown> | null;
  conversation_id: string | null;
  synthesis_mode: "analysis" | "recognition" | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AddMemoryParams {
  content: string;
  category?: string;
  tags?: string[];
  source?: string;
  resonance_phi?: number;
  confidence?: number;
  is_catalyst?: boolean;
  tier?: "active" | "thread" | "stable" | "network";
  conversation_id?: string;
  synthesis_mode?: "analysis" | "recognition";
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
