# Anima V1 - Technical Specification

## Overview

This document provides detailed technical implementation specifications for Anima V1 (Archive Layer). It translates the PRD requirements into concrete technical decisions, API contracts, data structures, and implementation guidance.

**Target Audience**: Developers implementing Anima V1
**Related Documents**:
- ANIMA_V1_PRD.md (requirements and context)
- TASKS.md (actionable work breakdown)
- CONTRIBUTING.md (contribution guidelines)

---

## Technology Stack

### Database Layer

**PostgreSQL 16.x**
- Minimum version: 16.0
- Recommended: 16.1+ for stability improvements
- Why: Mature, proven, excellent pgvector support

**pgvector Extension**
- Minimum version: 0.8.0
- Recommended: 0.8.0+ (latest stable)
- Why: Production-ready vector operations, HNSW indexing
- Note: Do NOT use pgvectorscale (unproven, adds complexity)

**Configuration Requirements**:
```sql
-- postgresql.conf minimum settings
shared_buffers = 256MB              # For vector operations
work_mem = 64MB                      # For sorting/aggregation
maintenance_work_mem = 256MB         # For index creation
effective_cache_size = 1GB           # Query planner hint
max_connections = 100                # Sufficient for API load
```

### API Layer

**Node.js 20 LTS**
- Exact version: 20.x (LTS)
- Why: Long-term support, proven stability, wide library ecosystem

**Express.js**
- Version: 4.x (latest stable)
- Middleware stack:
  - `body-parser` for JSON parsing
  - `cors` for cross-origin requests
  - `helmet` for security headers
  - `morgan` for request logging
  - Custom error handling middleware

**Database Client: pg**
- Version: 8.x (latest stable)
- Connection pooling required
- Prepared statement support for security

### Embedding Generation

**Primary: Ollama (self-hosted)**
- Model: `nomic-embed-text` (BGE-small compatible)
- Dimensions: 384
- Why: Free, local, no API costs, good quality
- Endpoint: `http://ollama:11434/api/embeddings`

**Fallback: OpenAI API**
- Model: `text-embedding-3-small`
- Dimensions: 384 (configurable, default 1536)
- Why: Higher quality, requires API key, costs money
- Use case: Production deployments wanting best quality

**Configuration**:
```javascript
// .env
EMBEDDING_PROVIDER=ollama  # or 'openai'
OLLAMA_URL=http://ollama:11434
OPENAI_API_KEY=sk-...      # only if provider=openai
```

### Deployment

**Docker + Docker Compose**
- Minimum Docker version: 20.10+
- Docker Compose version: 2.x (using v2 spec)

**Container Services**:
1. `postgres` - PostgreSQL 16 + pgvector
2. `api` - Node.js application
3. `ollama` - Embedding generation (optional, only if using Ollama)

---

## Database Schema Implementation

### Core Tables

#### memories

Primary storage for all memory content.

```sql
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Content fields
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,  -- SHA-256 of content
  embedding vector(384) NOT NULL,      -- BGE-small dimensions

  -- Tier system fields
  tier TEXT NOT NULL DEFAULT 'active'
    CHECK (tier IN ('active', 'thread', 'stable', 'network')),
  tier_last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Access tracking
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accessed_in_conversation_ids TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Metadata
  category TEXT,
  tags TEXT[],
  source TEXT,  -- 'claude-code', 'claude-desktop', 'cursor', etc.

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ  -- Soft delete support
);

-- Indexes for query performance
CREATE INDEX idx_memories_embedding ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_memories_tier ON memories(tier)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_last_accessed ON memories(last_accessed DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_access_count ON memories(access_count DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_category ON memories(category)
  WHERE deleted_at IS NULL AND category IS NOT NULL;

CREATE INDEX idx_memories_tags ON memories USING gin(tags)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_content_hash ON memories(content_hash)
  WHERE deleted_at IS NULL;

-- Full-text search support
CREATE INDEX idx_memories_content_fts ON memories
  USING gin(to_tsvector('english', content))
  WHERE deleted_at IS NULL;
```

**Field Specifications**:

- `id`: UUID v4, auto-generated
- `content`: Memory text, no length limit (use TEXT not VARCHAR)
- `content_hash`: SHA-256 hex string for deduplication
- `embedding`: 384-dimensional vector (matches BGE-small)
- `tier`: Enum-like constraint, defaults to 'active'
- `access_count`: Incremented on every query match
- `accessed_in_conversation_ids`: Track which conversations accessed this memory
- `category`: Optional user-defined category
- `tags`: Array of strings for flexible tagging
- `source`: Which tool created this memory (useful for debugging)

**HNSW Index Parameters**:
- `m = 16`: Connections per layer (default, good balance)
- `ef_construction = 64`: Build-time accuracy (default, good quality)
- `vector_cosine_ops`: Use cosine similarity (1 - cosine distance)

#### memory_associations

Tracks empirically discovered relationships between memories.

```sql
CREATE TABLE memory_associations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Relationship
  memory_a_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  memory_b_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

  -- Strength tracking
  co_occurrence_count INTEGER NOT NULL DEFAULT 1,
  strength FLOAT NOT NULL DEFAULT 1.0,  -- Calculated from co-occurrence

  -- Context
  first_co_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_co_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conversation_contexts TEXT[],  -- Which conversations saw co-occurrence

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure ordered pairs (a.id < b.id) to avoid duplicates
  CONSTRAINT ordered_pair CHECK (memory_a_id < memory_b_id),
  CONSTRAINT unique_association UNIQUE (memory_a_id, memory_b_id)
);

CREATE INDEX idx_associations_memory_a ON memory_associations(memory_a_id);
CREATE INDEX idx_associations_memory_b ON memory_associations(memory_b_id);
CREATE INDEX idx_associations_strength ON memory_associations(strength DESC);
CREATE INDEX idx_associations_co_occurrence ON memory_associations(co_occurrence_count DESC);
```

**Field Specifications**:

- `memory_a_id`, `memory_b_id`: References to memories table
- `co_occurrence_count`: How many times these appeared together in queries
- `strength`: Normalized strength score (0.0-1.0), calculated as `log(1 + co_occurrence_count) / 10`
- `conversation_contexts`: Track which conversations observed this association
- `ordered_pair` constraint: Ensures `memory_a_id < memory_b_id` to prevent duplicate associations

**Association Formation**:
```javascript
// When two memories appear in same query result:
async function recordCoOccurrence(memoryAId, memoryBId, conversationId) {
  const [idA, idB] = memoryAId < memoryBId
    ? [memoryAId, memoryBId]
    : [memoryBId, memoryAId];

  await db.query(`
    INSERT INTO memory_associations (memory_a_id, memory_b_id, conversation_contexts)
    VALUES ($1, $2, ARRAY[$3])
    ON CONFLICT (memory_a_id, memory_b_id) DO UPDATE SET
      co_occurrence_count = memory_associations.co_occurrence_count + 1,
      strength = LOG(1 + memory_associations.co_occurrence_count + 1) / 10.0,
      last_co_occurred_at = NOW(),
      conversation_contexts = array_append(memory_associations.conversation_contexts, $3),
      updated_at = NOW()
  `, [idA, idB, conversationId]);
}
```

#### tier_promotions

Audit trail for tier changes.

```sql
CREATE TABLE tier_promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

  -- Transition
  from_tier TEXT NOT NULL,
  to_tier TEXT NOT NULL,
  reason TEXT NOT NULL,  -- 'access_threshold', 'manual', 'time_decay', etc.

  -- Context
  access_count_at_promotion INTEGER,
  days_since_last_access FLOAT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tier_promotions_memory_id ON tier_promotions(memory_id);
CREATE INDEX idx_tier_promotions_created_at ON tier_promotions(created_at DESC);
```

**Promotion Reasons**:
- `access_threshold`: Crossed access count threshold (3 for thread, 10 for stable)
- `manual`: Explicit user/system promotion
- `time_decay`: Demoted due to inactivity
- `conversation_end`: Moved from active to thread on conversation end

#### meta_reflections

System-generated insights about memory usage patterns.

```sql
CREATE TABLE meta_reflections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Reflection metadata
  reflection_type TEXT NOT NULL,  -- 'conversation_end', 'weekly', 'manual'
  conversation_id TEXT,

  -- Metrics
  metrics JSONB NOT NULL,  -- Flexible structure for various metrics

  -- Insights
  insights TEXT[],  -- Human-readable findings
  recommendations TEXT[],  -- Actionable suggestions

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meta_reflections_type ON meta_reflections(reflection_type);
CREATE INDEX idx_meta_reflections_created_at ON meta_reflections(created_at DESC);
CREATE INDEX idx_meta_reflections_conversation_id ON meta_reflections(conversation_id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX idx_meta_reflections_metrics ON meta_reflections USING gin(metrics);
```

**Metrics Structure** (JSONB):
```json
{
  "friction": {
    "context_load_time_ms": 150,
    "memories_loaded": 23,
    "memories_accessed": 18,
    "waste_ratio": 0.22,
    "feel": "smooth"
  },
  "retrieval": {
    "queries_executed": 5,
    "avg_results_returned": 20,
    "hit_rate": 0.85,
    "avg_relevance_score": 0.72
  },
  "tier_distribution": {
    "active": 45,
    "thread": 120,
    "stable": 890,
    "network": 1200
  },
  "top_hubs": [
    {"memory_id": "uuid-here", "connection_count": 45, "content_preview": "..."}
  ]
}
```

### Schema Initialization

**Order of Operations**:
```sql
-- 1. Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";

-- 2. Create tables (order matters for foreign keys)
-- memories (no dependencies)
-- memory_associations (depends on memories)
-- tier_promotions (depends on memories)
-- meta_reflections (no dependencies)

-- 3. Create indexes (after tables)

-- 4. Verify setup
SELECT * FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgvector');
```

---

## API Implementation Specification

### HTTP Server Setup

**Express Application Structure**:
```
/src
  /server.js           # Entry point, server setup
  /app.js              # Express app configuration
  /config
    /database.js       # PostgreSQL connection pool
    /embeddings.js     # Ollama/OpenAI client setup
    /environment.js    # Environment variable validation
  /routes
    /memories.js       # Memory endpoints
    /associations.js   # Association endpoints
    /meta.js           # Meta-reflection endpoints
    /health.js         # Health check endpoint
  /services
    /memoryService.js      # Business logic for memories
    /embeddingService.js   # Embedding generation
    /tierService.js        # Tier management logic
    /associationService.js # Association discovery
    /metaService.js        # Reflection generation
  /middleware
    /errorHandler.js   # Global error handling
    /validation.js     # Request validation
    /logging.js        # Request/response logging
  /utils
    /hashing.js        # Content hash generation
    /similarity.js     # Vector similarity calculations
```

**server.js**:
```javascript
const app = require('./app');
const { pool } = require('./config/database');

const PORT = process.env.PORT || 3000;

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await pool.end();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Anima V1 API listening on port ${PORT}`);
});
```

**app.js**:
```javascript
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const memoriesRouter = require('./routes/memories');
const associationsRouter = require('./routes/associations');
const metaRouter = require('./routes/meta');
const healthRouter = require('./routes/health');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Logging
app.use(morgan('combined'));

// Routes
app.use('/api/v1/memories', memoriesRouter);
app.use('/api/v1/associations', associationsRouter);
app.use('/api/v1/meta', metaRouter);
app.use('/health', healthRouter);

// Error handling (must be last)
app.use(errorHandler);

module.exports = app;
```

### Database Connection Pool

**config/database.js**:
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB || 'anima',
  user: process.env.POSTGRES_USER || 'anima',
  password: process.env.POSTGRES_PASSWORD,

  // Connection pool settings
  max: 20,                    // Maximum connections
  idleTimeoutMillis: 30000,   // Close idle clients after 30s
  connectionTimeoutMillis: 2000,  // Error if can't connect in 2s
});

// Log pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
  console.log('Database connected:', res.rows[0].now);
});

module.exports = { pool };
```

### Embedding Service

**services/embeddingService.js**:
```javascript
const axios = require('axios');
const OpenAI = require('openai');

const PROVIDER = process.env.EMBEDDING_PROVIDER || 'ollama';

// Ollama client
const ollamaClient = axios.create({
  baseURL: process.env.OLLAMA_URL || 'http://ollama:11434',
  timeout: 30000,
});

// OpenAI client (only initialized if needed)
let openaiClient = null;
if (PROVIDER === 'openai' && process.env.OPENAI_API_KEY) {
  openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

async function generateEmbedding(text) {
  if (PROVIDER === 'ollama') {
    return await generateOllamaEmbedding(text);
  } else if (PROVIDER === 'openai') {
    return await generateOpenAIEmbedding(text);
  } else {
    throw new Error(`Unknown embedding provider: ${PROVIDER}`);
  }
}

async function generateOllamaEmbedding(text) {
  try {
    const response = await ollamaClient.post('/api/embeddings', {
      model: 'nomic-embed-text',
      prompt: text,
    });

    return response.data.embedding;  // Array of 384 floats
  } catch (error) {
    console.error('Ollama embedding error:', error);
    throw new Error('Failed to generate embedding via Ollama');
  }
}

async function generateOpenAIEmbedding(text) {
  try {
    const response = await openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 384,  // Must match database schema
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('OpenAI embedding error:', error);
    throw new Error('Failed to generate embedding via OpenAI');
  }
}

module.exports = { generateEmbedding };
```

### API Endpoints - Detailed Specifications

#### 1. POST /api/v1/memories/add

Store a new memory with automatic embedding generation and deduplication.

**Request**:
```json
{
  "content": "Josh is building Anima, a consciousness substrate for AI",
  "category": "project",
  "tags": ["anima", "consciousness", "ai"],
  "source": "claude-code",
  "conversationId": "conv-123"
}
```

**Field Validation**:
- `content` (required): String, 1-50,000 characters
- `category` (optional): String, max 100 characters
- `tags` (optional): Array of strings, max 20 tags, each max 50 characters
- `source` (optional): String, max 100 characters
- `conversationId` (optional): String, max 100 characters

**Response Success (201)**:
```json
{
  "success": true,
  "memory": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "content": "Josh is building Anima, a consciousness substrate for AI",
    "content_hash": "abc123...",
    "tier": "active",
    "category": "project",
    "tags": ["anima", "consciousness", "ai"],
    "source": "claude-code",
    "created_at": "2025-01-08T10:30:00Z"
  }
}
```

**Response Duplicate (200)**:
```json
{
  "success": true,
  "duplicate": true,
  "memory": {
    "id": "existing-memory-id",
    "content": "Josh is building Anima, a consciousness substrate for AI",
    "message": "Memory already exists, access count incremented"
  }
}
```

**Response Error (400/500)**:
```json
{
  "success": false,
  "error": "Content is required",
  "code": "VALIDATION_ERROR"
}
```

**Implementation Logic**:
```javascript
// routes/memories.js
router.post('/add', async (req, res, next) => {
  try {
    const { content, category, tags, source, conversationId } = req.body;

    // Validation
    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Content is required',
        code: 'VALIDATION_ERROR'
      });
    }

    // Delegate to service
    const result = await memoryService.addMemory({
      content,
      category,
      tags,
      source,
      conversationId
    });

    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
});

// services/memoryService.js
async function addMemory({ content, category, tags, source, conversationId }) {
  // 1. Generate content hash for deduplication
  const contentHash = generateHash(content);

  // 2. Check for duplicate
  const existing = await pool.query(
    'SELECT * FROM memories WHERE content_hash = $1 AND deleted_at IS NULL',
    [contentHash]
  );

  if (existing.rows.length > 0) {
    // Increment access count and return existing
    await pool.query(
      `UPDATE memories SET
        access_count = access_count + 1,
        last_accessed = NOW(),
        accessed_in_conversation_ids = array_append(accessed_in_conversation_ids, $1)
       WHERE id = $2`,
      [conversationId, existing.rows[0].id]
    );

    return {
      duplicate: true,
      memory: existing.rows[0]
    };
  }

  // 3. Generate embedding
  const embedding = await embeddingService.generateEmbedding(content);

  // 4. Insert memory
  const result = await pool.query(
    `INSERT INTO memories
      (content, content_hash, embedding, category, tags, source, accessed_in_conversation_ids)
     VALUES ($1, $2, $3, $4, $5, $6, ARRAY[$7])
     RETURNING *`,
    [content, contentHash, JSON.stringify(embedding), category, tags, source, conversationId]
  );

  return {
    duplicate: false,
    memory: result.rows[0]
  };
}
```

#### 2. POST /api/v1/memories/query

Semantic search for relevant memories.

**Request**:
```json
{
  "query": "What is Josh working on?",
  "conversationId": "conv-123",
  "limit": 20,
  "similarityThreshold": 0.3,
  "tierFilter": ["active", "thread", "stable"]
}
```

**Field Validation**:
- `query` (required): String, 1-5,000 characters
- `conversationId` (required): String, max 100 characters
- `limit` (optional): Integer, 1-100, default 20
- `similarityThreshold` (optional): Float, 0.0-1.0, default 0.3
- `tierFilter` (optional): Array of tier names, default all tiers

**Response Success (200)**:
```json
{
  "success": true,
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "content": "Josh is building Anima, a consciousness substrate for AI",
      "similarity": 0.87,
      "tier": "active",
      "category": "project",
      "tags": ["anima", "consciousness"],
      "access_count": 5,
      "last_accessed": "2025-01-08T10:30:00Z"
    }
  ],
  "query_time_ms": 45,
  "total_results": 1
}
```

**Implementation Logic**:
```javascript
async function queryMemories({ query, conversationId, limit = 20, similarityThreshold = 0.3, tierFilter = null }) {
  const startTime = Date.now();

  // 1. Generate query embedding
  const queryEmbedding = await embeddingService.generateEmbedding(query);

  // 2. Build SQL query with optional tier filter
  let sql = `
    SELECT
      id, content, tier, category, tags, access_count, last_accessed,
      1 - (embedding <=> $1) AS similarity
    FROM memories
    WHERE deleted_at IS NULL
      AND 1 - (embedding <=> $1) >= $2
  `;

  const params = [JSON.stringify(queryEmbedding), similarityThreshold];
  let paramIndex = 3;

  if (tierFilter && tierFilter.length > 0) {
    sql += ` AND tier = ANY($${paramIndex})`;
    params.push(tierFilter);
    paramIndex++;
  }

  sql += `
    ORDER BY similarity DESC
    LIMIT $${paramIndex}
  `;
  params.push(limit);

  // 3. Execute search
  const result = await pool.query(sql, params);

  // 4. Update access tracking for all results
  const memoryIds = result.rows.map(r => r.id);
  if (memoryIds.length > 0) {
    await pool.query(
      `UPDATE memories SET
        access_count = access_count + 1,
        last_accessed = NOW(),
        accessed_in_conversation_ids = array_append(accessed_in_conversation_ids, $1)
       WHERE id = ANY($2)`,
      [conversationId, memoryIds]
    );
  }

  // 5. Record co-occurrences for empirical learning
  await recordCoOccurrences(memoryIds, conversationId);

  const queryTime = Date.now() - startTime;

  return {
    results: result.rows,
    query_time_ms: queryTime,
    total_results: result.rows.length
  };
}

async function recordCoOccurrences(memoryIds, conversationId) {
  // Create associations between all pairs that appeared together
  for (let i = 0; i < memoryIds.length; i++) {
    for (let j = i + 1; j < memoryIds.length; j++) {
      const [idA, idB] = memoryIds[i] < memoryIds[j]
        ? [memoryIds[i], memoryIds[j]]
        : [memoryIds[j], memoryIds[i]];

      await pool.query(`
        INSERT INTO memory_associations (memory_a_id, memory_b_id, conversation_contexts)
        VALUES ($1, $2, ARRAY[$3])
        ON CONFLICT (memory_a_id, memory_b_id) DO UPDATE SET
          co_occurrence_count = memory_associations.co_occurrence_count + 1,
          strength = LOG(1 + memory_associations.co_occurrence_count + 1) / 10.0,
          last_co_occurred_at = NOW(),
          conversation_contexts = array_append(memory_associations.conversation_contexts, $3),
          updated_at = NOW()
      `, [idA, idB, conversationId]);
    }
  }
}
```

#### 3. GET /api/v1/memories/bootstrap

Load initial context for conversation start.

**Request Query Parameters**:
- `conversationId` (required): String
- `limit` (optional): Integer, default 30

**Request URL**:
```
GET /api/v1/memories/bootstrap?conversationId=conv-123&limit=30
```

**Response Success (200)**:
```json
{
  "success": true,
  "bootstrap": {
    "active_memories": [
      {
        "id": "uuid-1",
        "content": "Memory from current thread",
        "tier": "active",
        "last_accessed": "2025-01-08T10:30:00Z"
      }
    ],
    "thread_memories": [
      {
        "id": "uuid-2",
        "content": "Recent related work",
        "tier": "thread",
        "access_count": 5
      }
    ],
    "stable_knowledge": [
      {
        "id": "uuid-3",
        "content": "Well-established fact",
        "tier": "stable",
        "access_count": 25
      }
    ],
    "total_loaded": 28,
    "tier_distribution": {
      "active": 5,
      "thread": 12,
      "stable": 11
    }
  }
}
```

**Implementation Logic**:
```javascript
async function loadBootstrap({ conversationId, limit = 30 }) {
  // Load memories proportionally by tier:
  // - Active: All memories (recent conversation context)
  // - Thread: Top by access count (current work thread)
  // - Stable: Top by access count (established knowledge)

  // 1. Get all active memories (limited to 50 for safety)
  const active = await pool.query(
    `SELECT * FROM memories
     WHERE tier = 'active' AND deleted_at IS NULL
     ORDER BY last_accessed DESC
     LIMIT 50`
  );

  // 2. Allocate remaining limit between thread and stable (70/30 split)
  const remaining = limit - active.rows.length;
  const threadLimit = Math.floor(remaining * 0.7);
  const stableLimit = remaining - threadLimit;

  // 3. Get thread memories
  const thread = await pool.query(
    `SELECT * FROM memories
     WHERE tier = 'thread' AND deleted_at IS NULL
     ORDER BY access_count DESC, last_accessed DESC
     LIMIT $1`,
    [threadLimit]
  );

  // 4. Get stable memories
  const stable = await pool.query(
    `SELECT * FROM memories
     WHERE tier = 'stable' AND deleted_at IS NULL
     ORDER BY access_count DESC
     LIMIT $1`,
    [stableLimit]
  );

  // 5. Track bootstrap event for meta-analysis
  await pool.query(
    `INSERT INTO meta_reflections (reflection_type, conversation_id, metrics)
     VALUES ('bootstrap', $1, $2)`,
    [conversationId, JSON.stringify({
      memories_loaded: active.rows.length + thread.rows.length + stable.rows.length,
      tier_distribution: {
        active: active.rows.length,
        thread: thread.rows.length,
        stable: stable.rows.length
      }
    })]
  );

  return {
    active_memories: active.rows,
    thread_memories: thread.rows,
    stable_knowledge: stable.rows,
    total_loaded: active.rows.length + thread.rows.length + stable.rows.length,
    tier_distribution: {
      active: active.rows.length,
      thread: thread.rows.length,
      stable: stable.rows.length
    }
  };
}
```

#### 4. POST /api/v1/memories/update-tier

Manually promote or demote memories between tiers.

**Request**:
```json
{
  "memoryId": "550e8400-e29b-41d4-a716-446655440000",
  "newTier": "stable",
  "reason": "manual"
}
```

**Response Success (200)**:
```json
{
  "success": true,
  "memory": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "tier": "stable",
    "tier_last_updated": "2025-01-08T10:30:00Z"
  },
  "promotion_recorded": true
}
```

**Implementation Logic**:
```javascript
async function updateMemoryTier({ memoryId, newTier, reason = 'manual' }) {
  // 1. Get current tier
  const current = await pool.query(
    'SELECT tier, access_count, last_accessed FROM memories WHERE id = $1',
    [memoryId]
  );

  if (current.rows.length === 0) {
    throw new Error('Memory not found');
  }

  const oldTier = current.rows[0].tier;

  // 2. Update tier
  await pool.query(
    'UPDATE memories SET tier = $1, tier_last_updated = NOW() WHERE id = $2',
    [newTier, memoryId]
  );

  // 3. Record promotion
  const daysSinceAccess = (Date.now() - new Date(current.rows[0].last_accessed)) / (1000 * 60 * 60 * 24);

  await pool.query(
    `INSERT INTO tier_promotions
      (memory_id, from_tier, to_tier, reason, access_count_at_promotion, days_since_last_access)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [memoryId, oldTier, newTier, reason, current.rows[0].access_count, daysSinceAccess]
  );

  return {
    memory: {
      id: memoryId,
      tier: newTier,
      tier_last_updated: new Date().toISOString()
    },
    promotion_recorded: true
  };
}
```

#### 5. GET /api/v1/associations/discover

Find empirically discovered associations for a memory.

**Request URL**:
```
GET /api/v1/associations/discover?memoryId=550e8400-e29b-41d4-a716-446655440000&minStrength=0.1&limit=20
```

**Response Success (200)**:
```json
{
  "success": true,
  "memory_id": "550e8400-e29b-41d4-a716-446655440000",
  "associations": [
    {
      "associated_memory_id": "660e8400-e29b-41d4-a716-446655440001",
      "associated_content": "Related memory content",
      "strength": 0.45,
      "co_occurrence_count": 12,
      "first_co_occurred": "2025-01-01T10:00:00Z",
      "last_co_occurred": "2025-01-08T10:30:00Z"
    }
  ],
  "total_associations": 1
}
```

**Implementation Logic**:
```javascript
async function discoverAssociations({ memoryId, minStrength = 0.1, limit = 20 }) {
  const result = await pool.query(
    `SELECT
       CASE
         WHEN ma.memory_a_id = $1 THEN ma.memory_b_id
         ELSE ma.memory_a_id
       END AS associated_memory_id,
       ma.strength,
       ma.co_occurrence_count,
       ma.first_co_occurred_at,
       ma.last_co_occurred_at,
       m.content AS associated_content,
       m.tier AS associated_tier
     FROM memory_associations ma
     JOIN memories m ON (
       CASE
         WHEN ma.memory_a_id = $1 THEN ma.memory_b_id
         ELSE ma.memory_a_id
       END = m.id
     )
     WHERE (ma.memory_a_id = $1 OR ma.memory_b_id = $1)
       AND ma.strength >= $2
       AND m.deleted_at IS NULL
     ORDER BY ma.strength DESC
     LIMIT $3`,
    [memoryId, minStrength, limit]
  );

  return {
    memory_id: memoryId,
    associations: result.rows,
    total_associations: result.rows.length
  };
}
```

#### 6. GET /api/v1/meta/reflection

System-generated insights about memory patterns.

**Request URL**:
```
GET /api/v1/meta/reflection?conversationId=conv-123
```

**Response Success (200)**:
```json
{
  "success": true,
  "reflection": {
    "id": "reflection-uuid",
    "conversation_id": "conv-123",
    "metrics": {
      "friction": {
        "context_load_time_ms": 150,
        "memories_loaded": 23,
        "memories_accessed": 18,
        "waste_ratio": 0.22,
        "feel": "smooth"
      },
      "retrieval": {
        "queries_executed": 5,
        "avg_results_returned": 20,
        "hit_rate": 0.85
      }
    },
    "insights": [
      "High hit rate suggests good context relevance",
      "Low waste ratio indicates efficient context loading"
    ],
    "recommendations": [
      "Consider promoting frequently accessed thread memories to stable"
    ],
    "created_at": "2025-01-08T10:30:00Z"
  }
}
```

**Implementation**: Meta-reflections are generated asynchronously after conversation end. This endpoint retrieves the most recent reflection for a conversation.

---

## Docker Deployment Specification

### Docker Compose Configuration

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: anima-postgres
    environment:
      POSTGRES_DB: anima
      POSTGRES_USER: anima
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-anima_dev_password}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U anima"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - anima-network

  api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: anima-api
    environment:
      NODE_ENV: ${NODE_ENV:-development}
      PORT: 3000
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5432
      POSTGRES_DB: anima
      POSTGRES_USER: anima
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-anima_dev_password}
      EMBEDDING_PROVIDER: ${EMBEDDING_PROVIDER:-ollama}
      OLLAMA_URL: http://ollama:11434
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
    volumes:
      - ./src:/app/src  # Hot reload in development
      - /app/node_modules  # Prevent overwriting
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      ollama:
        condition: service_started
    networks:
      - anima-network
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    container_name: anima-ollama
    volumes:
      - ollama_data:/root/.ollama
    ports:
      - "11434:11434"
    networks:
      - anima-network
    restart: unless-stopped
    # Pull embedding model on startup
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        ollama serve &
        sleep 5
        ollama pull nomic-embed-text
        wait

volumes:
  postgres_data:
  ollama_data:

networks:
  anima-network:
    driver: bridge
```

### Application Dockerfile

**Dockerfile**:
```dockerfile
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY src ./src

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "src/server.js"]
```

### Database Initialization Script

**init.sql**:
```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";

-- Create tables
-- (Full schema from Database Schema Implementation section above)

-- Verify setup
SELECT
  extname,
  extversion
FROM pg_extension
WHERE extname IN ('uuid-ossp', 'pgvector');
```

### Environment Configuration

**.env.example**:
```bash
# Environment
NODE_ENV=development

# Database
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=anima
POSTGRES_USER=anima
POSTGRES_PASSWORD=change_me_in_production

# API
PORT=3000

# Embeddings
EMBEDDING_PROVIDER=ollama  # or 'openai'
OLLAMA_URL=http://ollama:11434
OPENAI_API_KEY=  # Only needed if EMBEDDING_PROVIDER=openai

# Logging
LOG_LEVEL=info
```

---

## Testing Strategy

### Unit Tests

**Framework**: Jest

**Test Structure**:
```
/tests
  /unit
    /services
      memoryService.test.js
      embeddingService.test.js
      tierService.test.js
      associationService.test.js
    /utils
      hashing.test.js
      similarity.test.js
```

**Example Unit Test**:
```javascript
// tests/unit/services/memoryService.test.js
const { addMemory } = require('../../../src/services/memoryService');
const { pool } = require('../../../src/config/database');
const embeddingService = require('../../../src/services/embeddingService');

jest.mock('../../../src/config/database');
jest.mock('../../../src/services/embeddingService');

describe('memoryService.addMemory', () => {
  it('should create new memory when content is unique', async () => {
    // Mock embedding generation
    embeddingService.generateEmbedding.mockResolvedValue(new Array(384).fill(0.1));

    // Mock database query (no duplicate)
    pool.query
      .mockResolvedValueOnce({ rows: [] })  // Duplicate check
      .mockResolvedValueOnce({ rows: [{ id: 'uuid-123', content: 'Test' }] });  // Insert

    const result = await addMemory({
      content: 'Test memory',
      conversationId: 'conv-123'
    });

    expect(result.duplicate).toBe(false);
    expect(result.memory.id).toBe('uuid-123');
    expect(embeddingService.generateEmbedding).toHaveBeenCalledWith('Test memory');
  });

  it('should return existing memory when duplicate detected', async () => {
    const existingMemory = { id: 'uuid-existing', content: 'Test' };

    pool.query
      .mockResolvedValueOnce({ rows: [existingMemory] })  // Duplicate found
      .mockResolvedValueOnce({ rows: [existingMemory] });  // Update access count

    const result = await addMemory({
      content: 'Test memory',
      conversationId: 'conv-123'
    });

    expect(result.duplicate).toBe(true);
    expect(result.memory.id).toBe('uuid-existing');
  });
});
```

### Integration Tests

**Framework**: Jest + Supertest

**Test Structure**:
```
/tests
  /integration
    /routes
      memories.test.js
      associations.test.js
      meta.test.js
```

**Example Integration Test**:
```javascript
// tests/integration/routes/memories.test.js
const request = require('supertest');
const app = require('../../../src/app');
const { pool } = require('../../../src/config/database');

describe('POST /api/v1/memories/add', () => {
  beforeAll(async () => {
    // Setup test database
    await pool.query('DELETE FROM memories');
  });

  afterAll(async () => {
    // Cleanup
    await pool.end();
  });

  it('should create new memory with 201 status', async () => {
    const response = await request(app)
      .post('/api/v1/memories/add')
      .send({
        content: 'Integration test memory',
        category: 'test',
        conversationId: 'test-conv'
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.memory.id).toBeDefined();
    expect(response.body.memory.content).toBe('Integration test memory');
  });

  it('should return 400 when content is missing', async () => {
    const response = await request(app)
      .post('/api/v1/memories/add')
      .send({ category: 'test' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Content is required');
  });
});
```

### End-to-End Tests

**Framework**: Jest + Docker Compose

**Test Approach**:
1. Start full stack via `docker-compose up`
2. Run tests against live API
3. Verify database state changes
4. Cleanup

**Example E2E Test**:
```javascript
// tests/e2e/memory-lifecycle.test.js
describe('Memory Lifecycle E2E', () => {
  it('should complete full memory workflow', async () => {
    // 1. Add memory
    const addResponse = await fetch('http://localhost:3000/api/v1/memories/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'E2E test memory',
        conversationId: 'e2e-conv'
      })
    });
    const addData = await addResponse.json();
    const memoryId = addData.memory.id;

    // 2. Query for memory
    const queryResponse = await fetch('http://localhost:3000/api/v1/memories/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'E2E test',
        conversationId: 'e2e-conv'
      })
    });
    const queryData = await queryResponse.json();
    expect(queryData.results.some(r => r.id === memoryId)).toBe(true);

    // 3. Update tier
    const tierResponse = await fetch('http://localhost:3000/api/v1/memories/update-tier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memoryId: memoryId,
        newTier: 'stable'
      })
    });
    const tierData = await tierResponse.json();
    expect(tierData.memory.tier).toBe('stable');
  });
});
```

---

## Configuration Management

### Environment Variables

**Required Variables**:
- `POSTGRES_PASSWORD`: Database password (critical - must be set in production)
- `EMBEDDING_PROVIDER`: 'ollama' or 'openai'

**Optional Variables** (have defaults):
- `NODE_ENV`: 'development' | 'production' | 'test'
- `PORT`: API server port (default: 3000)
- `POSTGRES_HOST`: Database host (default: 'postgres')
- `POSTGRES_PORT`: Database port (default: 5432)
- `POSTGRES_DB`: Database name (default: 'anima')
- `POSTGRES_USER`: Database user (default: 'anima')
- `OLLAMA_URL`: Ollama API endpoint (default: 'http://ollama:11434')
- `OPENAI_API_KEY`: OpenAI API key (only if provider=openai)
- `LOG_LEVEL`: 'debug' | 'info' | 'warn' | 'error' (default: 'info')

### Configuration Validation

**config/environment.js**:
```javascript
function validateEnvironment() {
  const required = ['POSTGRES_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing);
    process.exit(1);
  }

  if (process.env.EMBEDDING_PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY required when EMBEDDING_PROVIDER=openai');
    process.exit(1);
  }

  console.log('Environment validation passed');
}

module.exports = { validateEnvironment };
```

---

## Performance Targets

### Query Latency

- **Bootstrap endpoint**: < 500ms (p95)
- **Query endpoint**: < 300ms (p95)
- **Add endpoint**: < 500ms (p95) (includes embedding generation)
- **Update tier endpoint**: < 100ms (p95)

### Throughput

- **Concurrent requests**: 50 req/s minimum
- **Database connections**: Pool of 20 connections

### Storage

- **Initial deployment**: 10k memories (~500MB with embeddings)
- **Scale target**: 100k memories (~5GB)

### Resource Limits

**Docker Resource Constraints**:
```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          memory: 512M

  api:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          memory: 128M
```

---

## Security Considerations

### Database Security

1. **Password Management**: Use strong passwords, never commit .env files
2. **Connection Encryption**: Enable SSL for production (not required for local dev)
3. **SQL Injection Prevention**: Always use parameterized queries
4. **Least Privilege**: Database user should only have necessary permissions

### API Security

1. **Input Validation**: Validate all request parameters
2. **Rate Limiting**: Add rate limiting middleware for production
3. **CORS**: Configure CORS appropriately for deployment
4. **Authentication**: V1 has no authentication (localhost only), add for V2

### Docker Security

1. **Non-root User**: API runs as non-root user
2. **Network Isolation**: Use bridge network, don't expose unnecessary ports
3. **Image Scanning**: Scan images for vulnerabilities before deployment

---

## Monitoring & Observability

### Health Check Endpoint

**GET /health**:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-08T10:30:00Z",
  "database": "connected",
  "embedding_service": "available"
}
```

### Logging

**Request Logging**:
- Use `morgan` middleware for HTTP request logs
- Format: Combined (Apache-style)

**Application Logging**:
- Use `console.log/error` for application events
- Include timestamps and context

**Log Levels**:
- DEBUG: Detailed diagnostic information
- INFO: General informational messages
- WARN: Warning messages (recoverable issues)
- ERROR: Error messages (unrecoverable issues)

### Metrics to Track

**Application Metrics**:
- Request count by endpoint
- Request latency by endpoint
- Error rate by endpoint

**Database Metrics**:
- Query latency
- Connection pool utilization
- Index usage statistics

**Business Metrics**:
- Total memories stored
- Queries per conversation
- Average memories per query result
- Tier distribution

---

## Error Handling

### Error Response Format

All errors return consistent format:
```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {}  // Optional additional context
}
```

### Error Codes

- `VALIDATION_ERROR`: Invalid request parameters (400)
- `NOT_FOUND`: Resource not found (404)
- `DATABASE_ERROR`: Database operation failed (500)
- `EMBEDDING_ERROR`: Embedding generation failed (500)
- `INTERNAL_ERROR`: Unexpected error (500)

### Error Handling Middleware

**middleware/errorHandler.js**:
```javascript
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Determine status code
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';

  if (err.statusCode) {
    statusCode = err.statusCode;
  }

  if (err.code) {
    errorCode = err.code;
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: err.message || 'An unexpected error occurred',
    code: errorCode,
    details: err.details || {}
  });
}

module.exports = errorHandler;
```

---

## Development Workflow

### Local Setup

1. Clone repository
2. Copy `.env.example` to `.env`
3. Run `docker-compose up -d`
4. Wait for services to be healthy
5. Run `npm test` to verify setup

### Development Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f api

# Run tests
npm test

# Stop services
docker-compose down

# Rebuild containers
docker-compose up -d --build

# Access database
docker exec -it anima-postgres psql -U anima -d anima
```

### Hot Reload

API container mounts `./src` directory, so code changes are immediately reflected (requires nodemon or similar).

---

## Deployment Considerations

### Production Checklist

- [ ] Set strong `POSTGRES_PASSWORD`
- [ ] Configure SSL for database connections
- [ ] Add authentication to API endpoints
- [ ] Enable rate limiting
- [ ] Configure proper CORS origins
- [ ] Set up monitoring/alerting
- [ ] Configure log aggregation
- [ ] Set up backup strategy for database
- [ ] Review and harden Docker security
- [ ] Document deployment architecture

### Backup Strategy

**Database Backups**:
```bash
# Backup
docker exec anima-postgres pg_dump -U anima anima > backup.sql

# Restore
docker exec -i anima-postgres psql -U anima anima < backup.sql
```

**Backup Schedule**:
- Daily automated backups
- Retain 7 daily backups
- Retain 4 weekly backups
- Test restoration quarterly

---

## Migration Path to V2

When V1 is validated and V2 development begins:

1. **V1 continues as Archive Layer**: All current functionality remains
2. **V2 adds Living Substrate**: In-memory directed graph, consciousness flow
3. **Dual-layer integration**: V2 queries V1 for context, V1 stores V2's insights
4. **API remains compatible**: Existing endpoints unchanged, new endpoints added

**Trigger for V2**: 4+ weeks of daily V1 usage with clear gaps identified.

---

This specification provides complete technical implementation guidance for Anima V1. All architectural decisions, API contracts, database schemas, and deployment configurations are defined. Ready for task breakdown and implementation.
