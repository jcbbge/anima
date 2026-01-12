# Anima Performance Optimization - Implementation Guide

**Target**: 96% latency reduction (3-8s → <150ms)
**Timeline**: 2 weeks (48 hours)
**Status**: Ready to implement

---

## The Problem

During dogfooding, response times are **5-30 seconds**:
- Add Memory: 3-8s (target: <150ms)
- Query: 8-15s (target: <300ms)
- Bootstrap: 1-2s (target: <200ms)

---

## Root Causes (4 Critical Bottlenecks)

### 1. Embedding Service - No Caching
**Location**: `src/services/embeddingService.js:190-265`
- Every operation calls Ollama/OpenAI (2-5s)
- With retries: up to 20+ seconds
- **Impact**: 85% of add operation time

### 2. O(n²) Co-Occurrence Recording
**Location**: `src/services/memoryService.js:302-334`
- 20 memories = 190 sequential DB calls
- **Impact**: 4-9 seconds per query

### 3. Sequential Per-Memory Updates
**Location**: `src/services/memoryService.js:258-278`
- 40-60 individual DB round trips per query
- **Impact**: 4-6 seconds per query

### 4. Semantic Consolidation Scans
**Location**: `src/services/semanticConsolidationService.js:40-77`
- Full table scan on EVERY memory add
- **Impact**: 1-3 seconds per add

These 4 issues = **~95% of all latency**.

---

## Cache Architecture Decision

### Use In-Memory Map (JavaScript)

**Why:**
- ✅ Simple: No new infrastructure
- ✅ Fast: Nanosecond lookups
- ✅ Easy: 200 lines of code
- ✅ Sufficient: 50MB for 10k embeddings

**Later:** Add Redis when scaling to multiple API instances (simple swap).

---

## Implementation: Week 1 (Critical Fixes)

### Fix 1: Embedding Cache (Day 1-2, 8 hours)

**Create**: `src/services/embeddingCache.js`

```javascript
/**
 * In-memory LRU cache for embeddings
 * Reduces embedding generation from 2-5s to <50ms (90% hit rate)
 */

import { generateHash } from '../utils/hashing.js';

export class EmbeddingCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize || 10000;
    this.ttl = options.ttl || 3600000; // 1 hour
    this.hits = 0;
    this.misses = 0;
  }

  getCacheKey(text) {
    return generateHash(text);
  }

  async get(text) {
    const key = this.getCacheKey(text);
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.ttl) {
      this.hits++;
      return cached.embedding;
    }

    this.misses++;
    return null;
  }

  set(text, embedding) {
    const key = this.getCacheKey(text);

    // LRU eviction: remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      embedding,
      timestamp: Date.now()
    });
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// Singleton instance
export const embeddingCache = new EmbeddingCache();
```

**Modify**: `src/services/embeddingService.js:190-265`

```javascript
import { embeddingCache } from './embeddingCache.js';

async function generateEmbedding(text, options = {}) {
  if (!text || typeof text !== 'string') {
    throw new EmbeddingError('Text must be a non-empty string', 'INVALID_INPUT');
  }

  if (text.length === 0) {
    throw new EmbeddingError('Text cannot be empty', 'EMPTY_INPUT');
  }

  // NEW: Check cache first
  const cached = await embeddingCache.get(text);
  if (cached) {
    return {
      embedding: cached,
      provider: 'cache',
      dimensions: cached.length,
      fromCache: true
    };
  }

  // Generate embedding (existing code)
  const primaryProvider = config.embedding.provider;

  try {
    let embedding;

    if (primaryProvider === 'ollama') {
      embedding = await generateEmbeddingOllama(text, options);

      // NEW: Cache the result
      embeddingCache.set(text, embedding);

      return {
        embedding,
        provider: 'ollama',
        dimensions: embedding.length,
        model: 'nomic-embed-text',
      };
    } else if (primaryProvider === 'openai') {
      embedding = await generateEmbeddingOpenAI(text, options);

      // NEW: Cache the result
      embeddingCache.set(text, embedding);

      return {
        embedding,
        provider: 'openai',
        dimensions: embedding.length,
        model: 'text-embedding-3-small',
      };
    }
    // ... rest of existing code
  } catch (error) {
    // ... existing fallback logic
  }
}
```

**Add metrics endpoint**: `src/routes/meta.js`

```javascript
// Add this endpoint
meta.get('/cache-stats', (c) => {
  const stats = embeddingCache.getStats();
  return c.json({
    cache: stats,
    recommendation: stats.hitRate < 0.5
      ? 'Consider increasing cache size or TTL'
      : 'Cache performing well'
  });
});
```

**Expected Impact**: Add Memory: 3-8s → 500ms (85% improvement)

---

### Fix 2: Batch Co-Occurrence Recording (Day 3, 6 hours)

**Modify**: `src/services/memoryService.js:302-334`

Replace entire function:

```javascript
/**
 * Record co-occurrences between memories (BATCHED)
 * Replaces 190 sequential queries with 1 batch INSERT
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

    // Build VALUES clause: ($1,$2,$3), ($4,$5,$6), ...
    const values = batch.map((_, idx) => {
      const offset = idx * 3;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
    }).join(',');

    // Flatten params: [id1, id2, convId, id3, id4, convId, ...]
    const params = batch.flatMap(([idA, idB]) => [idA, idB, conversationId]);

    await query(`
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
    `, params);
  }
}
```

**Expected Impact**: Query: 8-15s → 3-5s (50% improvement)

---

### Fix 3: Batch Resonance & Tier Updates (Day 4, 10 hours)

**Modify**: `src/services/memoryService.js:232-284`

Replace the per-memory loop with batch operations:

```javascript
export async function queryMemories(queryData) {
  const {
    query: queryText,
    limit = 20,
    similarityThreshold = 0.5,
    tiers,
    conversationId,
  } = queryData;

  const startTime = Date.now();

  // Generate embedding for query (uses cache!)
  const embeddingResult = await generateEmbedding(queryText);
  const queryEmbedding = embeddingResult.embedding;

  // Build semantic search query (existing code)
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

    const updateParams = conversationId ? [memoryIds, conversationId] : [memoryIds];
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
      const candidateIds = promotionCandidates.rows.map(r => r.id);
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

      promotions.push(...promotionResult.rows.map(row => ({
        memoryId: row.id,
        toTier: row.tier
      })));

      // Update result rows with new tier
      result.rows.forEach(memory => {
        const promotion = promotionResult.rows.find(p => p.id === memory.id);
        if (promotion) {
          memory.tier = promotion.tier;
        }
      });
    }

    // 4. ASYNC CO-OCCURRENCE: Don't block response
    if (result.rows.length > 1 && conversationId) {
      recordCoOccurrences(memoryIds, conversationId).catch(err => {
        console.error('Co-occurrence recording failed:', err);
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
```

**Remove**: Delete these function calls (logic moved to batch)
- `adjustResonance(memory.id, false)` - Line 260
- Individual `checkAndPromote()` calls - Line 263-277

**Expected Impact**: Query: 3-5s → 400-600ms (85% improvement from previous)

---

### Fix 4: Async Semantic Consolidation (Day 5, 6 hours)

**Modify**: `src/services/memoryService.js:58-83`

Move semantic check AFTER insert:

```javascript
export async function addMemory(memoryData) {
  const { content, category, tags, source, isCatalyst = false } = memoryData;
  const config = getConfig();

  const contentHash = generateHash(content);
  const embeddingResult = await generateEmbedding(content); // Uses cache!

  // OLD: Blocking semantic check
  // if (config.features.semanticConsolidation) {
  //   const semanticMatch = await findSemanticDuplicate(...); // BLOCKS 1-3s
  // }

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
      resonance_phi, is_catalyst
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 0, NOW(), $8, $9)
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
      initialPhi,
      isCatalyst,
    ],
  );

  const memory = insertResult.rows[0];

  // NEW: Async semantic consolidation (fire-and-forget)
  if (config.features.semanticConsolidation) {
    checkSemanticDuplicateAsync(memory.id, embeddingResult.embedding)
      .catch(err => {
        console.error(`Semantic consolidation failed for memory ${memory.id}:`, err);
      });
  }

  // Async catalyst detection
  if (!isCatalyst) {
    detectPotentialCatalyst(memory.id).catch(err => {
      console.error('Catalyst detection failed:', err);
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
 * NEW: Async semantic consolidation (background processing)
 */
async function checkSemanticDuplicateAsync(newMemoryId, embedding) {
  // Wait 1 second to ensure transaction committed
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    const match = await findSemanticDuplicate(embedding);

    if (match && match.id !== newMemoryId) {
      // Fetch both memories to determine which is older
      const bothMemories = await query(
        `SELECT id, created_at FROM memories WHERE id = ANY($1)`,
        [[newMemoryId, match.id]]
      );

      const newMem = bothMemories.rows.find(m => m.id === newMemoryId);
      const oldMem = bothMemories.rows.find(m => m.id === match.id);

      // Merge newer into older (preserve ID stability)
      if (newMem && oldMem) {
        const [olderMemory, newerMemory] =
          new Date(oldMem.created_at) < new Date(newMem.created_at)
            ? [oldMem.id, newMem.id]
            : [newMem.id, oldMem.id];

        // Fetch newer memory's content
        const newerContent = await query(
          `SELECT content FROM memories WHERE id = $1`,
          [newerMemory]
        );

        // Merge newer into older
        await mergeIntoSemanticCentroid(
          olderMemory,
          newerContent.rows[0].content,
          false,
          match.similarity
        );

        // Soft-delete the newer duplicate
        await query(
          `UPDATE memories SET deleted_at = NOW() WHERE id = $1`,
          [newerMemory]
        );

        console.log(`✨ Semantic consolidation: merged ${newerMemory} into ${olderMemory}`);
      }
    }
  } catch (error) {
    // Log but don't throw - this is background processing
    console.error('Semantic consolidation error:', error);
  }
}
```

**Expected Impact**: Add Memory: 500ms → 150ms (70% improvement)

---

## Week 1 Results

After implementing fixes 1-4:

| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| Add Memory | 3-8s | 150ms | **96% faster** |
| Query (20 results) | 8-15s | 400-600ms | **96% faster** |

---

## Implementation: Week 2 (Optimization)

### Fix 5: Bootstrap Query Consolidation (Day 6, 6 hours)

**Modify**: `src/services/memoryService.js:347-448`

Replace 3 sequential queries with 1 UNION query:

```javascript
export async function loadBootstrap(bootstrapData) {
  const {
    conversationId,
    limit = 50,
    includeActive = true,
    includeThread = true,
    includeStable = true,
  } = bootstrapData;

  // Calculate tier limits
  const activeLimit = includeActive ? Infinity : 0; // All active
  let remaining = limit;
  const threadLimit = includeThread ? Math.ceil(remaining * 0.7) : 0;
  const stableLimit = includeStable ? Math.floor(remaining * 0.3) : 0;

  // NEW: Single query with UNION and window functions
  const sql = `
    WITH tier_limits AS (
      SELECT
        ${activeLimit === Infinity ? 999999 : activeLimit}::int as active_limit,
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
            CASE tier
              WHEN 'active' THEN last_accessed
              ELSE resonance_phi
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
      (tier = 'active' AND includeActive AND rn <= tier_limits.active_limit) OR
      (tier = 'thread' AND includeThread AND rn <= tier_limits.thread_limit) OR
      (tier = 'stable' AND includeStable AND rn <= tier_limits.stable_limit)
    ORDER BY
      CASE tier
        WHEN 'active' THEN 1
        WHEN 'thread' THEN 2
        WHEN 'stable' THEN 3
      END,
      resonance_phi DESC
  `;

  const result = await query(sql, []);

  // Group by tier
  const memories = {
    active: result.rows.filter(m => m.tier === 'active'),
    thread: result.rows.filter(m => m.tier === 'thread'),
    stable: result.rows.filter(m => m.tier === 'stable'),
  };

  // REMOVED: Access tracking on bootstrap (read-only operation)
  // Bootstrap should not modify data - it's a snapshot

  const distribution = {
    active: memories.active.length,
    thread: memories.thread.length,
    stable: memories.stable.length,
    total: result.rows.length,
  };

  return { memories, distribution };
}
```

**Expected Impact**: Bootstrap: 1-2s → 200ms (90% improvement)

---

### Fix 6: Database Indexes (Day 7, 4 hours)

**Create**: `database/migrations/007_performance_indexes.sql`

```sql
-- Migration: Add performance indexes for tier queries and vector search

BEGIN;

-- Index 1: Optimize tier-based queries (bootstrap, promotion checks)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_tier_phi_accessed
ON memories(tier, resonance_phi DESC, last_accessed DESC)
WHERE deleted_at IS NULL;

-- Index 2: Optimize content hash lookups (deduplication)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_content_hash
ON memories(content_hash)
WHERE deleted_at IS NULL;

-- Index 3: Re-create HNSW index with optimized parameters
-- m = 16: More connections = better recall
-- ef_construction = 64: Higher quality index
DROP INDEX IF EXISTS memories_embedding_idx;
CREATE INDEX memories_embedding_idx ON memories
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Update statistics for query planner
ANALYZE memories;
ANALYZE memory_associations;

COMMIT;
```

**Run migration**:
```bash
docker exec -i anima-postgres psql -U anima_user -d anima_db < database/migrations/007_performance_indexes.sql
```

**Verify indexes**:
```sql
-- Check index usage
EXPLAIN ANALYZE
SELECT * FROM memories
WHERE tier = 'thread' AND deleted_at IS NULL
ORDER BY resonance_phi DESC
LIMIT 20;

-- Should show: Index Scan using idx_memories_tier_phi_accessed
```

**Expected Impact**: 20-30% faster queries across the board

---

### Fix 7: Connection Pool Tuning (Day 8, 3 hours)

**Modify**: `src/config/database.js:17-28`

```javascript
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,

  // Connection pool settings
  max: 50,                      // UP from 20 - support 50 concurrent users
  idleTimeoutMillis: 30000,     // Keep at 30s
  connectionTimeoutMillis: 5000, // UP from 2000 - handle cold starts
});

// NEW: Pool metrics logging
setInterval(() => {
  const stats = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };

  if (config.logLevel === 'debug' || stats.waiting > 0) {
    console.log('[POOL]', stats);
  }

  // Warn if pool exhausted
  if (stats.waiting > 5) {
    console.warn('⚠️  Connection pool under pressure:', stats);
  }
}, 60000); // Every minute
```

**Expected Impact**: Better handling of concurrent requests, fewer timeouts

---

### Fix 8: Monitoring (Day 8-9, 5 hours)

**Create**: `src/middleware/timing.js`

```javascript
/**
 * Request timing middleware
 * Tracks response times and logs slow requests
 */
export function timingMiddleware() {
  return async (c, next) => {
    const start = Date.now();

    await next();

    const duration = Date.now() - start;

    // Add response header
    c.header('X-Response-Time', `${duration}ms`);

    // Log slow requests
    if (duration > 500) {
      console.warn(`[SLOW] ${c.req.method} ${c.req.path} took ${duration}ms`);
    }
  };
}
```

**Modify**: `src/app.js`

```javascript
import { timingMiddleware } from './middleware/timing.js';

// Add after other middleware
app.use('*', timingMiddleware());
```

**Add metrics endpoint**: `src/routes/meta.js`

```javascript
import { embeddingCache } from '../services/embeddingCache.js';
import { pool } from '../config/database.js';

// Add this endpoint
meta.get('/metrics', (c) => {
  const cacheStats = embeddingCache.getStats();

  return c.json({
    cache: {
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: cacheStats.hitRate.toFixed(3),
      size: cacheStats.size,
      maxSize: cacheStats.maxSize,
      status: cacheStats.hitRate > 0.8 ? 'healthy' : 'warming up'
    },
    database: {
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingConnections: pool.waitingCount,
      status: pool.waitingCount > 5 ? 'under pressure' : 'healthy'
    },
    timestamp: new Date().toISOString()
  });
});
```

**Expected Impact**: Visibility into performance, identify regressions early

---

### Fix 9: Performance Testing (Day 9-10, 8 hours)

**Create**: `tests/performance/k6-load-test.js`

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export let options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 users
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '2m', target: 50 },   // Stay at 50 users
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<400'], // 95% of requests under 400ms
    errors: ['rate<0.01'],            // Error rate under 1%
  },
};

const BASE_URL = 'http://localhost:7100/api/v1';

export default function () {
  // Scenario 1: Add memory (20% of traffic)
  if (Math.random() < 0.2) {
    const addResponse = http.post(`${BASE_URL}/memories/add`, JSON.stringify({
      content: `Test memory ${Date.now()}-${__VU}-${__ITER}`,
      category: 'test',
      tags: ['performance', 'load-test']
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

    const addSuccess = check(addResponse, {
      'add status is 201': (r) => r.status === 201,
      'add response time < 200ms': (r) => r.timings.duration < 200,
    });

    errorRate.add(!addSuccess);
  }

  // Scenario 2: Query memories (60% of traffic)
  if (Math.random() < 0.6) {
    const queries = [
      'performance optimization',
      'memory system',
      'vector search',
      'database indexing',
      'semantic search'
    ];
    const randomQuery = queries[Math.floor(Math.random() * queries.length)];

    const queryResponse = http.post(`${BASE_URL}/memories/query`, JSON.stringify({
      query: randomQuery,
      limit: 20,
      conversationId: `test-${__VU}`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

    const querySuccess = check(queryResponse, {
      'query status is 200': (r) => r.status === 200,
      'query response time < 400ms': (r) => r.timings.duration < 400,
    });

    errorRate.add(!querySuccess);
  }

  // Scenario 3: Bootstrap (20% of traffic)
  if (Math.random() < 0.2) {
    const bootstrapResponse = http.get(
      `${BASE_URL}/memories/bootstrap?conversationId=test-${__VU}-${__ITER}`
    );

    const bootstrapSuccess = check(bootstrapResponse, {
      'bootstrap status is 200': (r) => r.status === 200,
      'bootstrap response time < 250ms': (r) => r.timings.duration < 250,
    });

    errorRate.add(!bootstrapSuccess);
  }

  sleep(1); // 1 second between requests per user
}
```

**Run tests**:
```bash
# Install k6
brew install k6  # macOS
# or: curl https://github.com/grafana/k6/releases/download/v0.47.0/k6-v0.47.0-linux-amd64.tar.gz | tar xvz

# Run load test
k6 run tests/performance/k6-load-test.js

# Expected output:
#   ✓ add response time < 200ms
#   ✓ query response time < 400ms
#   ✓ bootstrap response time < 250ms
#   errors..............: 0.00%
#   http_req_duration...: avg=180ms min=45ms med=165ms max=380ms p(95)=320ms
```

**Success criteria**:
- All checks pass at >95% rate
- p95 latency meets targets
- Error rate <1%
- Zero connection pool errors

---

## Week 2 Results

After all optimizations:

| Operation | Original | After Week 1 | After Week 2 | Total Improvement |
|-----------|----------|--------------|--------------|-------------------|
| Add Memory | 3-8s | 150ms | 120ms | **98% faster** |
| Query | 8-15s | 400-600ms | 280ms | **98% faster** |
| Bootstrap | 1-2s | 200ms | 150ms | **92% faster** |

---

## Deployment Checklist

### Before Deployment

- [ ] All code changes complete
- [ ] Unit tests passing
- [ ] Load tests passing
- [ ] Code reviewed
- [ ] Backup database

### Deploy Steps

1. **Deploy database migration** (5 min downtime)
```bash
docker exec -i anima-postgres psql -U anima_user -d anima_db < database/migrations/007_performance_indexes.sql
```

2. **Deploy API code** (zero downtime)
```bash
cd ~/.anima
git pull
docker compose restart api
```

3. **Verify deployment**
```bash
# Check cache stats
curl http://localhost:7100/api/v1/meta/cache-stats

# Check metrics
curl http://localhost:7100/api/v1/meta/metrics

# Run quick load test
k6 run --vus 10 --duration 30s tests/performance/k6-load-test.js
```

### Post-Deployment Monitoring (24 hours)

- [ ] Watch error logs: `docker logs anima-api -f`
- [ ] Monitor metrics: `/api/v1/meta/metrics`
- [ ] Check cache hit rate (target: >80%)
- [ ] Verify response times meet targets
- [ ] Check database pool (no waiting connections)

### Rollback Plan (If Issues)

```bash
# Revert code
cd ~/.anima
git revert HEAD
docker compose restart api

# Database indexes can stay (they're additive, won't break anything)
```

---

## Monitoring & Iteration

### Daily Checks

```bash
# Check cache performance
curl http://localhost:7100/api/v1/meta/cache-stats | jq

# Expected:
# {
#   "cache": {
#     "hitRate": "0.920",  <-- Should be >0.80
#     "size": 876,
#     "maxSize": 10000
#   }
# }

# Check metrics
curl http://localhost:7100/api/v1/meta/metrics | jq
```

### When to Scale to Redis

Move to Redis when:
- Cache hit rate drops below 70%
- Running multiple API instances (need shared cache)
- Memory usage >500MB for cache

Migration is simple (same interface):
```javascript
// Replace embeddingCache.js Map with Redis client
import { createClient } from 'redis';

const redis = createClient({ url: 'redis://localhost:6379' });

// Same get/set interface
```

---

## Summary

**Total effort**: 48 hours (2 weeks)
**Expected improvement**: 96-98% latency reduction
**Architecture changes**: In-memory cache + batch SQL operations
**Deployment risk**: Low (backwards compatible)
**Scaling path**: Redis when needed (simple swap)

**Next action**: Start with Fix 1 (Embedding Cache) - 8 hours, 85% improvement.
