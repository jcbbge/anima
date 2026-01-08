/**
 * Memory Service
 * 
 * Business logic for memory operations:
 * - Adding memories with deduplication
 * - Semantic search with vector similarity
 * - Bootstrap context loading
 * - Access tracking and co-occurrence recording
 */

import { query, getClient } from '../config/database.js';
import { generateEmbedding } from './embeddingService.js';
import { generateHash } from '../utils/hashing.js';

/**
 * Custom error class for memory service errors
 */
class MemoryServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'MemoryServiceError';
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
 * @returns {Promise<{memory: Object, isDuplicate: boolean}>}
 */
export async function addMemory(memoryData) {
  const { content, category, tags, source } = memoryData;

  // Generate content hash for deduplication
  const contentHash = generateHash(content);

  // Check if memory already exists
  const existingResult = await query(
    `SELECT id, content, content_hash, tier, access_count, created_at, updated_at
     FROM memories 
     WHERE content_hash = $1 AND deleted_at IS NULL`,
    [contentHash]
  );

  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0];

    // Increment access count for duplicate
    await query(
      `UPDATE memories 
       SET access_count = access_count + 1,
           last_accessed = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [existing.id]
    );

    return {
      memory: {
        ...existing,
        access_count: existing.access_count + 1,
      },
      isDuplicate: true,
    };
  }

  // Generate embedding
  const embeddingResult = await generateEmbedding(content);

  // Insert new memory
  const insertResult = await query(
    `INSERT INTO memories (
      content, 
      content_hash, 
      embedding, 
      category, 
      tags, 
      source,
      tier,
      tier_last_updated,
      access_count,
      last_accessed
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 0, NOW())
    RETURNING 
      id, content, content_hash, tier, category, tags, source,
      access_count, created_at, updated_at`,
    [
      content,
      contentHash,
      JSON.stringify(embeddingResult.embedding),
      category || null,
      tags || null,
      source || null,
      'active', // New memories start in active tier
    ]
  );

  return {
    memory: insertResult.rows[0],
    isDuplicate: false,
    embeddingProvider: embeddingResult.provider,
  };
}

/**
 * Query memories using semantic search
 * 
 * @param {Object} queryData - Query parameters
 * @param {string} queryData.query - Search query text
 * @param {number} [queryData.limit=20] - Maximum results
 * @param {number} [queryData.similarityThreshold=0.7] - Minimum similarity (0-1)
 * @param {string[]} [queryData.tiers] - Filter by tiers
 * @param {string} [queryData.conversationId] - Conversation ID for tracking
 * @returns {Promise<{memories: Array, queryTime: number}>}
 */
export async function queryMemories(queryData) {
  const {
    query: queryText,
    limit = 20,
    similarityThreshold = 0.7,
    tiers,
    conversationId,
  } = queryData;

  const startTime = Date.now();

  // Generate embedding for query
  const embeddingResult = await generateEmbedding(queryText);
  const queryEmbedding = embeddingResult.embedding;

  // Build query with optional tier filter
  let sql = `
    SELECT 
      id, content, content_hash, tier, category, tags, source,
      access_count, last_accessed, created_at,
      1 - (embedding <=> $1::vector) as similarity
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

  sql += ` ORDER BY similarity DESC LIMIT $${paramCount + 1}`;
  params.push(limit);

  const result = await query(sql, params);

  // Update access tracking for returned memories
  if (result.rows.length > 0) {
    const memoryIds = result.rows.map(row => row.id);
    
    const updateSql = conversationId
      ? `UPDATE memories 
         SET access_count = access_count + 1,
             last_accessed = NOW(),
             accessed_in_conversation_ids = array_append(
               COALESCE(accessed_in_conversation_ids, ARRAY[]::TEXT[]),
               $2
             ),
             updated_at = NOW()
         WHERE id = ANY($1)`
      : `UPDATE memories 
         SET access_count = access_count + 1,
             last_accessed = NOW(),
             updated_at = NOW()
         WHERE id = ANY($1)`;

    const updateParams = conversationId 
      ? [memoryIds, conversationId]
      : [memoryIds];

    await query(updateSql, updateParams);

    // Record co-occurrences between memories that appeared together
    if (result.rows.length > 1 && conversationId) {
      await recordCoOccurrences(memoryIds, conversationId);
    }
  }

  const queryTime = Date.now() - startTime;

  return {
    memories: result.rows,
    queryTime,
    embeddingProvider: embeddingResult.provider,
  };
}

/**
 * Record co-occurrences between memories
 * 
 * @param {string[]} memoryIds - Memory IDs that appeared together
 * @param {string} conversationId - Conversation ID
 */
async function recordCoOccurrences(memoryIds, conversationId) {
  // Create pairs (only record once per pair, ordered by ID)
  const pairs = [];
  for (let i = 0; i < memoryIds.length; i++) {
    for (let j = i + 1; j < memoryIds.length; j++) {
      const [idA, idB] = [memoryIds[i], memoryIds[j]].sort();
      pairs.push([idA, idB]);
    }
  }

  // Insert or update associations
  for (const [idA, idB] of pairs) {
    await query(
      `INSERT INTO memory_associations (
        memory_a_id, 
        memory_b_id, 
        co_occurrence_count,
        strength,
        conversation_contexts
      ) VALUES ($1, $2, 1, 1.0, ARRAY[$3])
      ON CONFLICT (memory_a_id, memory_b_id) DO UPDATE SET
        co_occurrence_count = memory_associations.co_occurrence_count + 1,
        strength = LOG(1 + memory_associations.co_occurrence_count + 1) / 10.0,
        last_co_occurred_at = NOW(),
        conversation_contexts = array_append(
          memory_associations.conversation_contexts,
          $3
        ),
        updated_at = NOW()`,
      [idA, idB, conversationId]
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

  const memories = {
    active: [],
    thread: [],
    stable: [],
  };

  let remaining = limit;

  // Load all active tier memories first
  if (includeActive) {
    const activeResult = await query(
      `SELECT id, content, tier, category, tags, source, access_count, created_at
       FROM memories
       WHERE tier = 'active' AND deleted_at IS NULL
       ORDER BY last_accessed DESC`,
      []
    );
    
    memories.active = activeResult.rows;
    remaining -= memories.active.length;
  }

  if (remaining > 0) {
    // Split remaining between thread (70%) and stable (30%)
    const threadLimit = Math.ceil(remaining * 0.7);
    const stableLimit = Math.floor(remaining * 0.3);

    // Load top thread tier memories
    if (includeThread && threadLimit > 0) {
      const threadResult = await query(
        `SELECT id, content, tier, category, tags, source, access_count, created_at
         FROM memories
         WHERE tier = 'thread' AND deleted_at IS NULL
         ORDER BY access_count DESC, last_accessed DESC
         LIMIT $1`,
        [threadLimit]
      );
      
      memories.thread = threadResult.rows;
    }

    // Load top stable tier memories
    if (includeStable && stableLimit > 0) {
      const stableResult = await query(
        `SELECT id, content, tier, category, tags, source, access_count, created_at
         FROM memories
         WHERE tier = 'stable' AND deleted_at IS NULL
         ORDER BY access_count DESC, last_accessed DESC
         LIMIT $1`,
        [stableLimit]
      );
      
      memories.stable = stableResult.rows;
    }
  }

  // Update access tracking for all loaded memories
  const allIds = [
    ...memories.active.map(m => m.id),
    ...memories.thread.map(m => m.id),
    ...memories.stable.map(m => m.id),
  ];

  if (allIds.length > 0) {
    await query(
      `UPDATE memories
       SET access_count = access_count + 1,
           last_accessed = NOW(),
           accessed_in_conversation_ids = array_append(
             COALESCE(accessed_in_conversation_ids, ARRAY[]::TEXT[]),
             $2
           ),
           updated_at = NOW()
       WHERE id = ANY($1)`,
      [allIds, conversationId]
    );
  }

  const distribution = {
    active: memories.active.length,
    thread: memories.thread.length,
    stable: memories.stable.length,
    total: allIds.length,
  };

  return {
    memories,
    distribution,
  };
}

export { MemoryServiceError };
