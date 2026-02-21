/**
 * memory.ts
 * Core memory operations for Anima v2.
 * addMemory() and queryMemories() — the two Phase 1 operations.
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
  conversation_id?: string;
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
    conversation_id,
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
      tier = 'active',
      tier_updated = time::now(),
      is_catalyst = $is_catalyst,
      access_count = 0,
      last_accessed = time::now(),
      session_ids = [],
      category = $category,
      tags = $tags,
      source = $source,
      conversation_id = $conversation_id,
      created_at = time::now(),
      updated_at = time::now()`,
    {
      content,
      content_hash,
      embedding: embedding ?? undefined,
      resonance_phi,
      confidence,
      is_catalyst,
      category: category ?? undefined,
      tags,
      source: source ?? undefined,
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

  return { memories, queryTimeMs: Date.now() - start };
}
