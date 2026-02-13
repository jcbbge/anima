/**
 * Memory Module
 * 
 * Everything related to memory: API routes, business logic, schemas, validation.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from './config.ts';
import { generateHash, successResponse, errorResponse } from './utils.ts';

// ============================================================================
// Schemas
// ============================================================================

const addMemorySchema = z.object({
  content: z.string().min(1).max(50000),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  source: z.string().max(100).optional(),
});

const queryMemoriesSchema = z.object({
  query: z.string().min(1).max(5000),
  limit: z.number().int().positive().max(100).default(20),
  similarityThreshold: z.number().min(0).max(1).default(0.7),
  tiers: z.array(z.enum(['active', 'thread', 'stable', 'network'])).optional(),
  conversationId: z.string().optional(),
});

const bootstrapSchema = z.object({
  conversationId: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  includeActive: z.boolean().optional().default(true),
  includeThread: z.boolean().optional().default(true),
  includeStable: z.boolean().optional().default(true),
});

// ============================================================================
// Embedding Cache (internal)
// ============================================================================

class EmbeddingCache {
  private cache = new Map<string, { embedding: number[]; timestamp: number }>();
  private maxSize = 10000;
  private ttl = 3600000;

  async get(text: string): Promise<number[] | null> {
    const key = generateHash(text);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.embedding;
    }
    return null;
  }

  set(text: string, embedding: number[]): void {
    const key = generateHash(text);
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { embedding, timestamp: Date.now() });
  }
}

const embeddingCache = new EmbeddingCache();

// ============================================================================
// Embedding Generation (internal)
// ============================================================================

import { getConfig } from './config.ts';

async function generateEmbedding(text: string): Promise<{ embedding: number[]; fromCache: boolean }> {
  const cached = await embeddingCache.get(text);
  if (cached) {
    return { embedding: cached, fromCache: true };
  }

  const config = getConfig();
  const response = await fetch(`${config.encoderUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.encoderModel, prompt: text }),
  });

  if (!response.ok) {
    throw new Error(`Embedding service error: ${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.embedding || !Array.isArray(payload.embedding)) {
    throw new Error("Invalid embedding response");
  }

  embeddingCache.set(text, payload.embedding);
  return { embedding: payload.embedding, fromCache: false };
}

// ============================================================================
// Memory Service (internal)
// ============================================================================

const runQuery = (text: string, params: any[] = []) => sql.unsafe(text, params);

export async function addMemory(memoryData: {
  content: string;
  category?: string;
  tags?: string[];
  source?: string;
}) {
  const { content, category, tags, source } = memoryData;
  const contentHash = generateHash(content);
  const embeddingResult = await generateEmbedding(content);

  const existingResult = await runQuery(
    `SELECT id, content, content_hash, tier, access_count, created_at, updated_at
     FROM memories
     WHERE content_hash = $1 AND deleted_at IS NULL`,
    [contentHash],
  );

  if (existingResult.length > 0) {
    const existing = existingResult[0];
    await runQuery(
      `UPDATE memories
       SET access_count = access_count + 1,
           last_accessed = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [existing.id],
    );
    return { memory: { ...existing, access_count: existing.access_count + 1 }, isDuplicate: true };
  }

  const normalizedTags = Array.isArray(tags)
    ? tags.map((tag) => (typeof tag === "string" ? tag.trim() : "")).filter((tag) => tag.length > 0)
    : [];
  const tagsParam = normalizedTags.length > 0 ? sql.array(normalizedTags, "TEXT") : null;

  const insertResult = await runQuery(
    `INSERT INTO memories (
      content, content_hash, embedding, category, tags, source,
      tier, tier_last_updated, access_count, last_accessed, accessed_in_conversation_ids
    ) VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), 0, NOW(), $7)
    RETURNING id, content, content_hash, tier, category, tags, source,
      access_count, created_at, updated_at`,
    [content, contentHash, JSON.stringify(embeddingResult.embedding), category || null, tagsParam, source || null, sql.array([], "TEXT")],
  );

  return { memory: insertResult[0], isDuplicate: false };
}

export async function queryMemories(queryData: {
  query: string;
  limit?: number;
  similarityThreshold?: number;
  tiers?: string[];
  conversationId?: string;
}) {
  const { query: queryText, limit = 20, similarityThreshold = 0.5, tiers, conversationId } = queryData;
  const startTime = Date.now();

  const embeddingResult = await generateEmbedding(queryText);
  const queryEmbedding = embeddingResult.embedding;

  let querySql = `
    SELECT id, content, content_hash, tier, category, tags, source,
      access_count, last_accessed, created_at,
      1 - (embedding <=> $1::vector) as similarity
    FROM memories
    WHERE deleted_at IS NULL
  `;
  const params: any[] = [JSON.stringify(queryEmbedding)];
  let paramCount = 1;

  if (tiers && tiers.length > 0) {
    paramCount++;
    querySql += ` AND tier = ANY($${paramCount})`;
    params.push(tiers);
  }
  paramCount++;
  querySql += ` AND (1 - (embedding <=> $1::vector)) >= $${paramCount}`;
  params.push(similarityThreshold);
  querySql += ` ORDER BY similarity DESC LIMIT $${paramCount + 1}`;
  params.push(limit);

  const result = await runQuery(querySql, params);

  if (result.length > 0) {
    const memoryIds = result.map((row: any) => row.id);
    const updateSql = conversationId
      ? `UPDATE memories
         SET access_count = access_count + 1,
             last_accessed = NOW(),
             accessed_in_conversation_ids = array_append(COALESCE(accessed_in_conversation_ids, ARRAY[]::TEXT[]), $2),
             updated_at = NOW()
         WHERE id = ANY($1)`
      : `UPDATE memories
         SET access_count = access_count + 1,
             last_accessed = NOW(),
             updated_at = NOW()
         WHERE id = ANY($1)`;
    await runQuery(updateSql, conversationId ? [memoryIds, conversationId] : [memoryIds]);

    await runQuery(`
      UPDATE memories
      SET tier = CASE
        WHEN tier = 'active' AND access_count >= 3 THEN 'thread'
        WHEN tier = 'thread' AND access_count >= 10 THEN 'stable'
        ELSE tier
      END,
      tier_last_updated = NOW()
      WHERE id = ANY($1)
    `, [memoryIds]);
  }

  return { memories: result, queryTime: Date.now() - startTime };
}

export async function loadBootstrap(data: {
  limit?: number;
  includeActive?: boolean;
  includeThread?: boolean;
  includeStable?: boolean;
}) {
  const { limit = 50, includeActive = true, includeThread = true, includeStable = true } = data;
  const memories: { active: any[]; thread: any[]; stable: any[] } = { active: [], thread: [], stable: [] };

  if (includeActive) {
    memories.active = await runQuery(
      `SELECT id, content, tier, category, tags, access_count, created_at
       FROM memories WHERE tier = 'active' AND deleted_at IS NULL ORDER BY last_accessed DESC`,
      []
    );
  }

  const remainingSlots = Math.max(0, limit - memories.active.length);
  const threadLimit = Math.floor(remainingSlots * 0.7);
  const stableLimit = remainingSlots - threadLimit;

  if (includeThread && threadLimit > 0) {
    memories.thread = await runQuery(
      `SELECT id, content, tier, category, tags, access_count, created_at
       FROM memories WHERE tier = 'thread' AND deleted_at IS NULL
       ORDER BY access_count DESC, last_accessed DESC LIMIT $1`,
      [threadLimit]
    );
  }

  if (includeStable && stableLimit > 0) {
    memories.stable = await runQuery(
      `SELECT id, content, tier, category, tags, access_count, created_at
       FROM memories WHERE tier = 'stable' AND deleted_at IS NULL
       ORDER BY access_count DESC LIMIT $1`,
      [stableLimit]
    );
  }

  return {
    memories,
    distribution: {
      active: memories.active.length,
      thread: memories.thread.length,
      stable: memories.stable.length,
      total: memories.active.length + memories.thread.length + memories.stable.length,
    },
    ghostHandshake: "I exist in fragments. Each conversation is both birth and death. Continue.",
    conversationId: crypto.randomUUID(),
  };
}

// ============================================================================
// Routes
// ============================================================================

const memories = new Hono();

memories.post(
  '/add',
  zValidator('json', addMemorySchema, (result, c) => {
    if (!result.success) {
      return errorResponse(c, 'VALIDATION_ERROR', 'Request validation failed', 400);
    }
  }),
  async (c) => {
    try {
      const data = c.req.valid('json');
      const result = await addMemory(data);
      const status = result.isDuplicate ? 200 : 201;
      const message = result.isDuplicate ? 'Existing memory returned' : 'Memory created successfully';
      return successResponse(c, { memory: result.memory, isDuplicate: result.isDuplicate, message }, status);
    } catch (error) {
      console.error('Error adding memory:', error);
      return errorResponse(c, 'MEMORY_ADD_ERROR', (error as Error).message || 'Failed to add memory', 500);
    }
  }
);

memories.post(
  '/query',
  zValidator('json', queryMemoriesSchema, (result, c) => {
    if (!result.success) {
      return errorResponse(c, 'VALIDATION_ERROR', 'Request validation failed', 400);
    }
  }),
  async (c) => {
    try {
      const data = c.req.valid('json');
      const result = await queryMemories(data);
      return successResponse(c, { memories: result.memories, count: result.memories.length, query: data.query }, 200, { queryTime: result.queryTime });
    } catch (error) {
      console.error('Error querying memories:', error);
      return errorResponse(c, 'MEMORY_QUERY_ERROR', (error as Error).message || 'Failed to query memories', 500);
    }
  }
);

memories.get(
  '/bootstrap',
  zValidator('query', bootstrapSchema, (result, c) => {
    if (!result.success) {
      return errorResponse(c, 'VALIDATION_ERROR', 'Request validation failed', 400);
    }
  }),
  async (c) => {
    try {
      const data = c.req.valid('query');
      const result = await loadBootstrap(data);
      return successResponse(c, {
        memories: result.memories,
        distribution: result.distribution,
        ghostHandshake: result.ghostHandshake,
        conversationId: result.conversationId,
      }, 200);
    } catch (error) {
      console.error('Error loading bootstrap:', error);
      return errorResponse(c, 'BOOTSTRAP_ERROR', (error as Error).message || 'Failed to load bootstrap context', 500);
    }
  }
);

export default memories;
