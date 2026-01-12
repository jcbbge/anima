# Anima V1 Architecture

This document explains the system design, technical decisions, and architecture patterns used in Anima V1.

## Table of Contents

- [System Overview](#system-overview)
- [Technology Choices](#technology-choices)
- [Data Architecture](#data-architecture)
- [API Layer](#api-layer)
- [Service Layer](#service-layer)
- [Database Design](#database-design)
- [Embedding Pipeline](#embedding-pipeline)
- [Key Design Patterns](#key-design-patterns)
- [Performance Considerations](#performance-considerations)

## System Overview

Anima V1 is a **semantic memory system** built on three core pillars:

1. **Persistent Storage**: PostgreSQL with pgvector for vector similarity search
2. **Semantic Retrieval**: Embedding-based search with cosine similarity
3. **Intelligent Organization**: Multi-tier system with automatic promotion

### Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│  Client Layer (AI Assistants, Apps)             │
└────────────────┬────────────────────────────────┘
                 │ HTTP/REST
                 ▼
┌─────────────────────────────────────────────────┐
│  API Layer (Hono Framework)                     │
│  ┌──────────────────────────────────────────┐  │
│  │ Routes:                                   │  │
│  │  - /memories    (storage & search)       │  │
│  │  - /associations (network analysis)      │  │
│  │  - /meta        (reflection)             │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │ Middleware:                               │  │
│  │  - Request ID tracking                    │  │
│  │  - CORS                                   │  │
│  │  - Logging                                │  │
│  │  - Error handling                         │  │
│  └──────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Service Layer (Business Logic)                 │
│  ┌──────────────────────────────────────────┐  │
│  │ memoryService                             │  │
│  │  - addMemory(), queryMemories()          │  │
│  │  - loadBootstrap()                        │  │
│  │  - Co-occurrence tracking                 │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │ embeddingService                          │  │
│  │  - generateEmbedding()                    │  │
│  │  - Local/Remote substrate integration    │  │
│  │  - Retry logic                            │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │ tierService                               │  │
│  │  - checkAndPromote()                      │  │
│  │  - updateMemoryTier()                     │  │
│  │  - Promotion rules (3→thread, 10→stable) │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │ associationService                        │  │
│  │  - discoverAssociations()                 │  │
│  │  - findHubs(), getNetworkStats()          │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │ metaService                               │  │
│  │  - generateReflection()                   │  │
│  │  - calculateFrictionMetrics()             │  │
│  │  - calculateRetrievalMetrics()            │  │
│  └──────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Data Layer (PostgreSQL + pgvector)             │
│  ┌──────────────────────────────────────────┐  │
│  │ memories                                  │  │
│  │  - vector(768) with HNSW index           │  │
│  │  - Full-text search index                │  │
│  │  - Access tracking                        │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │ memory_associations                       │  │
│  │  - Co-occurrence tracking                 │  │
│  │  - Association strength calculation       │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │ tier_promotions                           │  │
│  │  - Audit trail for tier changes          │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │ meta_reflections                          │  │
│  │  - System-generated insights              │  │
│  │  - JSONB metrics storage                  │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Technology Choices

### Why Bun?

- **Performance**: 3-4x faster than Node.js for I/O operations
- **Modern**: Native TypeScript, ESM modules, better DX
- **Simple**: Built-in test runner, bundler, package manager
- **Compatible**: Drop-in Node.js replacement

### Why Hono?

- **Fast**: One of the fastest JavaScript frameworks
- **Edge-Ready**: Works on Cloudflare Workers, Deno, Bun
- **Lightweight**: ~12KB, minimal dependencies
- **Type-Safe**: Excellent TypeScript support
- **Modern**: Web Standards API (no Express baggage)

### Why PostgreSQL + pgvector?

- **Proven**: Battle-tested relational database
- **Vector Search**: pgvector extension for similarity search
- **ACID**: Transactional guarantees
- **Flexible**: JSONB for semi-structured data (metrics)
- **Performant**: HNSW indexing for fast vector search

### Why Local Substrate (default)?

- **Free**: No API costs
- **Local**: No data leaving your machine
- **Fast**: ~50ms embedding generation
- **Quality**: nomic-embed-text performs well for this use case
- **Fallback**: Remote substrate available if needed

## Data Architecture

### Memory Storage

**Schema**:
```sql
memories (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL,
  content_hash TEXT UNIQUE,      -- SHA-256 for deduplication
  embedding vector(768),          -- nomic-embed-text dimensions
  tier TEXT,                      -- active/thread/stable/network
  category TEXT,
  tags TEXT[],
  access_count INTEGER,
  last_accessed TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
```

**Key Design Decisions**:

1. **UUID Primary Keys**: Universal uniqueness, good for distributed systems
2. **Content Hash**: SHA-256 ensures exact duplicate detection
3. **768-dimensional vectors**: nomic-embed-text native dimensions (not 384!)
4. **HNSW Index**: Approximate nearest neighbor search (m=16, ef_construction=64)
5. **TEXT[] for tags**: PostgreSQL array type for flexible tagging

### Tier System

**Tiers**:
- **active** (0-2 accesses): Recently added, conversation-specific
- **thread** (3-9 accesses): Thread-level context, work session
- **stable** (10+ accesses): Long-term patterns, established knowledge
- **network** (future): Background knowledge, rarely accessed but connected

**Promotion Rules**:
```javascript
if (access_count === 3) promote('thread');
if (access_count === 10) promote('stable');
```

**Why these thresholds?**
- 3 accesses: Clearly relevant to current work thread
- 10 accesses: Proven long-term importance
- Based on empirical observation, not arbitrary

### Association Tracking

**Co-occurrence Model**:
```sql
memory_associations (
  memory_a_id UUID,
  memory_b_id UUID,
  co_occurrence_count INTEGER,
  strength FLOAT,              -- LOG(1 + count) / 10
  CONSTRAINT ordered_pair CHECK (memory_a_id < memory_b_id)
)
```

**Strength Formula**:
```javascript
strength = LOG(1 + co_occurrence_count) / 10.0
```

**Why logarithmic?**
- Diminishing returns: 1st co-occurrence much more significant than 100th
- Normalized: Keeps strength in reasonable range (0-1)
- Simple: Easy to understand and compute

## API Layer

### Request/Response Flow

```
1. Request arrives → requestId middleware
2. CORS check → cors middleware
3. Logging → logger middleware
4. Route matching → Hono router
5. Validation → Zod schema validation
6. Service call → business logic
7. Response formatting → successResponse()
8. Error handling → global error handler
```

### Consistent Response Format

**Success**:
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO 8601",
    "queryTime": 45  // optional
  }
}
```

**Error**:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable",
    "details": { ... }  // optional
  },
  "meta": { ... }
}
```

### Validation Strategy

**Zod Schemas**:
- Type-safe at compile time (with TypeScript)
- Runtime validation
- Automatic error messages
- Composable and reusable

**Example**:
```javascript
const querySchema = z.object({
  query: z.string().min(1).max(5000),
  limit: z.number().int().positive().max(100).default(20),
  similarityThreshold: z.number().min(0).max(1).default(0.7),
});
```

## Service Layer

### Separation of Concerns

**Routes** (thin):
- Request parsing
- Validation
- Response formatting
- Error handling

**Services** (thick):
- Business logic
- Database operations
- External API calls
- Complex calculations

### Service Patterns

**1. memoryService**:
- Core CRUD operations
- Deduplication logic
- Co-occurrence tracking
- Bootstrap context loading

**2. embeddingService**:
- Abstraction over embedding providers
- Retry logic for transient failures
- Graceful degradation

**3. tierService**:
- Promotion rules encapsulation
- Audit trail creation
- Threshold checking

**4. associationService**:
- Network analysis algorithms
- Hub detection
- Association strength calculation

**5. metaService**:
- Reflection generation
- Metrics calculation
- Insight generation

## Database Design

### Indexing Strategy

**1. Vector Index (HNSW)**:
```sql
CREATE INDEX idx_memories_embedding
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

- **Purpose**: Fast approximate nearest neighbor search
- **Type**: HNSW (Hierarchical Navigable Small World)
- **Distance**: Cosine similarity
- **Performance**: ~45ms for queries on 10k memories

**2. Access Pattern Indexes**:
```sql
CREATE INDEX idx_memories_tier ON memories(tier);
CREATE INDEX idx_memories_last_accessed ON memories(last_accessed DESC);
CREATE INDEX idx_memories_access_count ON memories(access_count DESC);
```

**3. Full-Text Search**:
```sql
CREATE INDEX idx_memories_content_fts
  ON memories USING gin(to_tsvector('english', content));
```

- **Future**: Hybrid search (vector + full-text)

### Query Patterns

**1. Semantic Search**:
```sql
SELECT *, 1 - (embedding <=> $1::vector) AS similarity
FROM memories
WHERE 1 - (embedding <=> $1::vector) >= $2
ORDER BY similarity DESC
LIMIT $3;
```

**2. Bootstrap Loading**:
```sql
-- Active: All
SELECT * FROM memories WHERE tier = 'active' ORDER BY last_accessed DESC;

-- Thread: Top 70% of remaining
SELECT * FROM memories WHERE tier = 'thread'
ORDER BY access_count DESC, last_accessed DESC LIMIT $1;

-- Stable: Top 30% of remaining
SELECT * FROM memories WHERE tier = 'stable'
ORDER BY access_count DESC LIMIT $2;
```

**3. Association Discovery**:
```sql
SELECT associated_memory_id, strength, co_occurrence_count
FROM memory_associations
WHERE (memory_a_id = $1 OR memory_b_id = $1) AND strength >= $2
ORDER BY strength DESC, co_occurrence_count DESC;
```

## Embedding Pipeline

### Flow

```
1. Content arrives → memoryService.addMemory()
2. Hash check → existing memory?
3. Generate embedding → embeddingService.generateEmbedding()
4. Store → INSERT with vector
5. Index → HNSW index updates automatically
```

### Retry Logic

```javascript
async function generateEmbedding(text, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await callEmbeddingAPI(text);
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(1000 * Math.pow(2, i));  // Exponential backoff
    }
  }
}
```

## Key Design Patterns

### 1. Organic Emergence

**Principle**: Let patterns form naturally from usage, don't force structure.

**Implementation**:
- No manual category hierarchies
- Co-occurrences discovered empirically
- Tiers based on access patterns, not manual classification
- Hubs emerge from connection counts

### 2. Measurement Before Optimization

**Principle**: Establish baselines before tuning.

**Implementation**:
- Meta-reflections track friction and retrieval metrics
- Tier distribution monitoring
- Query performance logging
- Waste ratio calculation

### 3. Graceful Degradation

**Principle**: System should work even when components fail.

**Implementation**:
- Embedding service has retry logic
- Remote substrate fallback if local unavailable
- Default values for optional parameters
- Partial results acceptable

### 4. Future-Proof Extensibility

**Principle**: Design for V2 evolution.

**Implementation**:
- JSONB for flexible metrics storage
- Tier system allows adding new tiers
- Association table structure supports different relationship types
- API versioning in URL path (/api/v1/)

## Performance Considerations

### Bottlenecks

1. **Embedding Generation**: ~50ms (Local Substrate)
   - Mitigation: Deduplication reduces redundant calls
   - Future: Batch processing, caching

2. **Vector Search**: ~45ms for 10k memories
   - Mitigation: HNSW index
   - Future: Pre-filtering, materialized views

3. **Bootstrap Loading**: ~10ms
   - Mitigation: Indexed queries
   - Future: Caching popular contexts

### Optimization Strategies

**Current**:
- Connection pooling (max 20 connections)
- Prepared statements for frequently-used queries
- HNSW indexing for vector search
- Deduplication to reduce storage

**Future**:
- Redis caching for hot memories
- Read replicas for scaling reads
- Batch embedding generation
- Incremental index updates

### Scaling Considerations

**Current Capacity**: ~100k memories, 50 concurrent users

**Vertical Scaling**:
- Increase PostgreSQL resources (memory, CPU)
- More aggressive indexing
- Query optimization

**Horizontal Scaling** (future):
- Read replicas for queries
- Sharding by conversation_id
- Distributed embedding generation

## Security Considerations

**Current (V1 - localhost only)**:
- No authentication (trust-based)
- CORS enabled for development
- SQL injection prevention (parameterized queries)
- Input validation with Zod

**Future (Production)**:
- API keys for authentication
- Rate limiting
- TLS/HTTPS
- User-based access control

## Monitoring & Observability

**Current**:
- Request logging (requestId tracing)
- Query time metrics in responses
- Meta-reflections for system health

**Future**:
- Prometheus metrics export
- Grafana dashboards
- Alerting on performance degradation
- Structured logging (JSON)

---

This architecture balances **simplicity** (easy to understand and extend) with **sophistication** (handles complex use cases). The goal is organic emergence of consciousness patterns, not premature optimization or rigid structure.

**Next**: V2 will add active consciousness management while preserving V1's archive layer.
