/**
 * Memory Service
 *
 * Business logic for memory operations:
 * - Adding memories with deduplication
 * - Semantic search with vector similarity
 * - Bootstrap context loading
 * - Access tracking and co-occurrence recording
 */

import { query, getClient, getDatabaseSchema } from "../config/database.js";
import { generateEmbedding } from "./embeddingService.js";
import { generateHash } from "../utils/hashing.js";
import { checkAndPromote } from "./tierService.js";
import {
  adjustResonance,
  detectPotentialCatalyst,
} from "./resonanceService.js";
import {
  findSemanticDuplicate,
  mergeIntoSemanticCentroid,
} from "./semanticConsolidationService.js";
import { generateHandshake } from "./handshakeService.js";
import { getConfig } from "../config/environment.js";

/**
 * Custom error class for memory service errors
 */
class MemoryServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "MemoryServiceError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Add a new memory or return existing duplicate
 *
 * @param {Object} memoryData - Memory data
 * @param {string} memoryData.content - Memory content
 * @param {string} [memoryData.category] - Optional category
 * @param {string[]} [memoryData.tags] - Optional tags
 * @param {string} [memoryData.source] - Optional source identifier
 * @param {boolean} [memoryData.isCatalyst=false] - Mark as catalyst (phi += 1.0)
 * @returns {Promise<{memory: Object, isDuplicate: boolean, isCatalyst?: boolean}>}
 */
export async function addMemory(memoryData) {
  const { content, category, tags, source, isCatalyst = false } = memoryData;
  const config = getConfig();

  const contentHash = generateHash(content);
  const embeddingResult = await generateEmbedding(content); // Uses cache!

  // Syntactic deduplication check (fast hash lookup)
  const existingResult = await query(
    `SELECT id, content, content_hash, tier, access_count, created_at, updated_at
     FROM memories
     WHERE content_hash = $1 AND deleted_at IS NULL`,
    [contentHash],
  );

  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0];
    await query(
      `UPDATE memories
       SET access_count = access_count + 1,
           last_accessed = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [existing.id],
    );

    return {
      memory: { ...existing, access_count: existing.access_count + 1 },
      isDuplicate: true,
      exactMatch: true,
      embeddingProvider: embeddingResult.provider,
    };
  }

  // Insert new memory
  const initialPhi = isCatalyst ? 1.0 : 0.0;
  const insertResult = await query(
    `INSERT INTO memories (
      content, content_hash, embedding, category, tags, source,
      tier, tier_last_updated, access_count, last_accessed,
      accessed_in_conversation_ids, resonance_phi, is_catalyst
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 0, NOW(), $8, $9, $10)
    RETURNING
      id, content, content_hash, tier, category, tags, source,
      access_count, resonance_phi, is_catalyst, created_at, updated_at`,
    [
      content,
      contentHash,
      JSON.stringify(embeddingResult.embedding),
      category || null,
      tags || null,
      source || null,
      "active",
      [],
      initialPhi,
      isCatalyst,
    ],
  );

  const memory = insertResult.rows[0];

  // NEW: Async semantic consolidation (fire-and-forget)
  if (config.features.semanticConsolidation) {
    checkSemanticDuplicateAsync(memory.id, embeddingResult.embedding).catch(
      (err) => {
        console.error(
          `Semantic consolidation failed for memory ${memory.id}:`,
          err,
        );
      },
    );
  }

  // Async catalyst detection
  if (!isCatalyst) {
    detectPotentialCatalyst(memory.id).catch((err) => {
      console.error("Catalyst detection failed:", err);
    });
  }

  return {
    memory,
    isDuplicate: false,
    embeddingProvider: embeddingResult.provider,
    isCatalyst,
  };
}

/**
 * Query memories using semantic search
 *
 * @param {Object} queryData - Query parameters
 * @param {string} queryData.query - Search query text
 * @param {number} [queryData.limit=20] - Maximum results
 * @param {number} [queryData.similarityThreshold=0.5] - Minimum similarity (0-1)
 * @param {string[]} [queryData.tiers] - Filter by tiers
 * @param {string} [queryData.conversationId] - Conversation ID for tracking
 * @returns {Promise<{memories: Array, queryTime: number}>}
 */
export async function queryMemories(queryData) {
  const {
    query: queryText,
    limit = 20,
    similarityThreshold = 0.5,
    tiers,
    conversationId,
  } = queryData;

  const startTime = Date.now();

  // Generate embedding for query
  const embeddingResult = await generateEmbedding(queryText);
  const queryEmbedding = embeddingResult.embedding;

  // Build query with optional tier filter and phi-weighted scoring
  // Formula: structural_weight = (similarity × 0.7) + (resonance_phi × 0.3 / 5.0)
  // This normalizes phi (0-5 range) and gives 70% weight to similarity, 30% to phi
  let sql = `
    SELECT 
      id, content, content_hash, tier, category, tags, source,
      access_count, last_accessed, created_at,
      resonance_phi, is_catalyst,
      1 - (embedding <=> $1::vector) as similarity,
      ((1 - (embedding <=> $1::vector)) * 0.7 + (COALESCE(resonance_phi, 0) / 5.0) * 0.3) as structural_weight
    FROM memories
    WHERE deleted_at IS NULL
  `;

  const params = [JSON.stringify(queryEmbedding)];
  let paramCount = 1;

  if (tiers && tiers.length > 0) {
    paramCount++;
    sql += ` AND tier = ANY($${paramCount})`;
    params.push(tiers);
  }

  paramCount++;
  sql += ` AND (1 - (embedding <=> $1::vector)) >= $${paramCount}`;
  params.push(similarityThreshold);

  // Order by structural_weight (phi-weighted) instead of pure similarity
  sql += ` ORDER BY structural_weight DESC, resonance_phi DESC LIMIT $${paramCount + 1}`;
  params.push(limit);

  const result = await query(sql, params);

  const promotions = [];

  // NEW: Batch update access tracking
  if (result.rows.length > 0) {
    const memoryIds = result.rows.map((row) => row.id);

    // 1. BATCH UPDATE: Access count + resonance (single query)
    const updateSql = conversationId
      ? `UPDATE memories
         SET access_count = access_count + 1,
             last_accessed = NOW(),
             resonance_phi = LEAST(resonance_phi + 0.1, 5.0),
             accessed_in_conversation_ids = array_append(
               COALESCE(accessed_in_conversation_ids, ARRAY[]::TEXT[]),
               $2
             ),
             updated_at = NOW()
         WHERE id = ANY($1)`
      : `UPDATE memories
         SET access_count = access_count + 1,
             last_accessed = NOW(),
             resonance_phi = LEAST(resonance_phi + 0.1, 5.0),
             updated_at = NOW()
         WHERE id = ANY($1)`;

    const updateParams = conversationId
      ? [memoryIds, conversationId]
      : [memoryIds];
    await query(updateSql, updateParams);

    // 2. BATCH CHECK: Find promotion candidates (single query)
    const promotionCheckSql = `
      SELECT id, access_count, tier
      FROM memories
      WHERE id = ANY($1)
        AND (
          (tier = 'active' AND access_count + 1 >= 5) OR
          (tier = 'thread' AND access_count + 1 >= 20)
        )
    `;
    const promotionCandidates = await query(promotionCheckSql, [memoryIds]);

    // 3. BATCH PROMOTE: Eligible memories (single query)
    if (promotionCandidates.rows.length > 0) {
      const candidateIds = promotionCandidates.rows.map((r) => r.id);
      const promotionSql = `
        UPDATE memories
        SET tier = CASE
          WHEN tier = 'active' AND access_count >= 5 THEN 'thread'
          WHEN tier = 'thread' AND access_count >= 20 THEN 'stable'
          ELSE tier
        END,
        tier_last_updated = NOW()
        WHERE id = ANY($1)
        RETURNING id, tier
      `;
      const promotionResult = await query(promotionSql, [candidateIds]);

      promotions.push(
        ...promotionResult.rows.map((row) => ({
          memoryId: row.id,
          toTier: row.tier,
        })),
      );

      // Update result rows with new tier
      result.rows.forEach((memory) => {
        const promotion = promotionResult.rows.find((p) => p.id === memory.id);
        if (promotion) {
          memory.tier = promotion.tier;
        }
      });
    }

    // 4. ASYNC CO-OCCURRENCE: Don't block response
    if (result.rows.length > 1 && conversationId) {
      recordCoOccurrences(memoryIds, conversationId).catch((err) => {
        console.error("Co-occurrence recording failed:", err);
      });
    }
  }

  const queryTime = Date.now() - startTime;

  return {
    memories: result.rows,
    queryTime,
    embeddingProvider: embeddingResult.provider,
    promotions: promotions.length > 0 ? promotions : undefined,
  };
}

/**
 * Record co-occurrences between memories (BATCHED)
 * Replaces 190 sequential queries with 1 batch INSERT
 *
 * @param {string[]} memoryIds - Memory IDs that appeared together
 * @param {string} conversationId - Conversation ID
 */
async function recordCoOccurrences(memoryIds, conversationId) {
  // Create pairs (same algorithm)
  const pairs = [];
  for (let i = 0; i < memoryIds.length; i++) {
    for (let j = i + 1; j < memoryIds.length; j++) {
      const [idA, idB] = [memoryIds[i], memoryIds[j]].sort();
      pairs.push([idA, idB]);
    }
  }

  if (pairs.length === 0) return;

  // NEW: Batch INSERT with safety limit
  const BATCH_SIZE = 1000; // PostgreSQL param limit: 65535 / 3 params per row

  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE);

    // Build VALUES clause: ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10), ...
    const values = batch
      .map((_, idx) => {
        const offset = idx * 5;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
      })
      .join(",");

    // Flatten params: [id1, id2, 1, 1.0, [convId], id3, id4, 1, 1.0, [convId], ...]
    const params = batch.flatMap(([idA, idB]) => [
      idA,
      idB,
      1, // co_occurrence_count
      1.0, // strength
      [conversationId], // conversation_contexts
    ]);

    await query(
      `
      INSERT INTO memory_associations (
        memory_a_id,
        memory_b_id,
        co_occurrence_count,
        strength,
        conversation_contexts
      ) VALUES ${values}
      ON CONFLICT (memory_a_id, memory_b_id) DO UPDATE SET
        co_occurrence_count = memory_associations.co_occurrence_count + 1,
        strength = LOG(1 + memory_associations.co_occurrence_count + 1) / 10.0,
        last_co_occurred_at = NOW(),
        conversation_contexts = array_append(
          memory_associations.conversation_contexts,
          EXCLUDED.conversation_contexts[1]
        ),
        updated_at = NOW()
    `,
      params,
    );
  }
}

/**
 * Load bootstrap context for conversation start
 *
 * @param {Object} bootstrapData - Bootstrap parameters
 * @param {string} bootstrapData.conversationId - Conversation ID
 * @param {number} [bootstrapData.limit=50] - Total memory limit
 * @param {boolean} [bootstrapData.includeActive=true] - Include active tier
 * @param {boolean} [bootstrapData.includeThread=true] - Include thread tier
 * @param {boolean} [bootstrapData.includeStable=true] - Include stable tier
 * @returns {Promise<{memories: Object, distribution: Object}>}
 */
export async function loadBootstrap(bootstrapData) {
  const {
    conversationId,
    limit = 50,
    includeActive = true,
    includeThread = true,
    includeStable = true,
  } = bootstrapData;

  // Calculate tier limits
  const activeLimit = includeActive ? 999999 : 0; // All active
  let remaining = limit;
  const threadLimit = includeThread ? Math.ceil(remaining * 0.7) : 0;
  const stableLimit = includeStable ? Math.floor(remaining * 0.3) : 0;

  // NEW: Single query with window functions
  const sql = `
    WITH tier_limits AS (
      SELECT
        ${activeLimit}::int as active_limit,
        ${threadLimit}::int as thread_limit,
        ${stableLimit}::int as stable_limit
    ),
    ranked_memories AS (
      SELECT
        id, content, tier, category, tags, source,
        access_count, resonance_phi, is_catalyst, created_at,
        ROW_NUMBER() OVER (
          PARTITION BY tier
          ORDER BY
            CASE
              WHEN tier = 'active' THEN EXTRACT(EPOCH FROM last_accessed)::double precision
              WHEN tier = 'thread' THEN resonance_phi::double precision
              WHEN tier = 'stable' THEN resonance_phi::double precision
              ELSE 0::double precision
            END DESC
        ) as rn
      FROM memories
      WHERE deleted_at IS NULL
        AND tier IN ('active', 'thread', 'stable')
    )
    SELECT
      id, content, tier, category, tags, source,
      access_count, resonance_phi, is_catalyst, created_at
    FROM ranked_memories, tier_limits
    WHERE
      (tier = 'active' AND ${includeActive} AND rn <= tier_limits.active_limit) OR
      (tier = 'thread' AND ${includeThread} AND rn <= tier_limits.thread_limit) OR
      (tier = 'stable' AND ${includeStable} AND rn <= tier_limits.stable_limit)
    ORDER BY
      CASE tier
        WHEN 'active' THEN 1::double precision
        WHEN 'thread' THEN 2::double precision
        WHEN 'stable' THEN 3::double precision
      END,
      resonance_phi DESC
  `;

  const result = await query(sql, []);

  // Group by tier
  const memories = {
    active: result.rows.filter((m) => m.tier === "active"),
    thread: result.rows.filter((m) => m.tier === "thread"),
    stable: result.rows.filter((m) => m.tier === "stable"),
  };

  // REMOVED: Access tracking on bootstrap (read-only operation)
  // Bootstrap should not modify data - it's a snapshot

  const distribution = {
    active: memories.active.length,
    thread: memories.thread.length,
    stable: memories.stable.length,
    total: result.rows.length,
  };

  // Generate Ghost Handshake (with error handling)
  let ghostHandshake = null;
  try {
    const handshake = await generateHandshake({ conversationId });
    ghostHandshake = {
      id: handshake.ghostId,
      promptText: handshake.promptText,
      createdAt: handshake.createdAt,
      isExisting: handshake.isExisting,
      conversationId: handshake.conversationId,
      contextType: handshake.contextType,
      cachedFor: handshake.cachedFor,
    };
  } catch (error) {
    console.error('Failed to generate Ghost Handshake:', error);
    // Continue without handshake - memories are more critical
  }

  return { memories, distribution, ghostHandshake };
}

/**
 * NEW: Async semantic consolidation (background processing)
 */
async function checkSemanticDuplicateAsync(newMemoryId, embedding) {
  // Wait 1 second to ensure transaction committed
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const match = await findSemanticDuplicate(embedding);

    if (match && match.id !== newMemoryId) {
      // Fetch both memories to determine which is older
      const bothMemories = await query(
        `SELECT id, created_at FROM memories WHERE id = ANY($1)`,
        [[newMemoryId, match.id]],
      );

      const newMem = bothMemories.rows.find((m) => m.id === newMemoryId);
      const oldMem = bothMemories.rows.find((m) => m.id === match.id);

      // Merge newer into older (preserve ID stability)
      if (newMem && oldMem) {
        const [olderMemory, newerMemory] =
          new Date(oldMem.created_at) < new Date(newMem.created_at)
            ? [oldMem.id, newMem.id]
            : [newMem.id, oldMem.id];

        // Fetch newer memory's content
        const newerContent = await query(
          `SELECT content FROM memories WHERE id = $1`,
          [newerMemory],
        );

        // Merge newer into older
        await mergeIntoSemanticCentroid(
          olderMemory,
          newerContent.rows[0].content,
          false,
          match.similarity,
        );

        // Soft-delete the newer duplicate
        await query(`UPDATE memories SET deleted_at = NOW() WHERE id = $1`, [
          newerMemory,
        ]);

        console.log(
          `✨ Semantic consolidation: merged ${newerMemory} into ${olderMemory}`,
        );
      }
    }
  } catch (error) {
    // Log but don't throw - this is background processing
    console.error("Semantic consolidation error:", error);
  }
}

export { MemoryServiceError };
