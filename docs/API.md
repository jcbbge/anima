# Anima V1 API Reference

## Base URL
```
http://localhost:7100
```

## Authentication
Currently no authentication (v1 development).

## Common Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO 8601 datetime",
    "queryTime": 45  // Optional: milliseconds
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { ... }  // Optional: additional error context
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO 8601 datetime"
  }
}
```

### Error Codes
- `VALIDATION_ERROR` - Request validation failed (400)
- `MEMORY_ADD_ERROR` - Failed to add memory (500)
- `MEMORY_QUERY_ERROR` - Failed to query memories (500)
- `BOOTSTRAP_ERROR` - Failed to load bootstrap context (500)

---

## Endpoints

### Health Check

#### GET /health
Check API health status.

**Response**: 200 OK
```json
{
  "status": "ok",
  "timestamp": "2026-01-08T20:00:00Z",
  "service": "anima-v1",
  "version": "1.0.0"
}
```

---

### Memory Storage

#### POST /api/v1/memories/add
Add a new memory or return existing duplicate.

**Request Body**:
```json
{
  "content": "Memory content (1-50000 chars, required)",
  "category": "Optional category (max 100 chars)",
  "tags": ["optional", "tags"],  // Max 20 tags, each max 50 chars
  "source": "Optional source identifier (max 100 chars)"
}
```

**Response**: 201 Created (new) or 200 OK (duplicate)
```json
{
  "success": true,
  "data": {
    "memory": {
      "id": "uuid",
      "content": "...",
      "content_hash": "sha256 hex",
      "tier": "active",
      "category": "...",
      "tags": [...],
      "source": "...",
      "access_count": 0,
      "created_at": "2026-01-08T20:00:00Z",
      "updated_at": "2026-01-08T20:00:00Z"
    },
    "isDuplicate": false,
    "message": "Memory created successfully"
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-08T20:00:00Z",
    "embeddingProvider": "ollama"
  }
}
```

**Notes**:
- Duplicate detection uses SHA-256 content hash
- Duplicates return existing memory with incremented `access_count`
- New memories start in `active` tier
- Generates 768-dimensional embeddings using nomic-embed-text

---

### Semantic Search

#### POST /api/v1/memories/query
Query memories using semantic vector search.

**Request Body**:
```json
{
  "query": "Search query text (1-5000 chars, required)",
  "limit": 20,  // Optional: 1-100, default 20
  "similarityThreshold": 0.7,  // Optional: 0-1, default 0.7
  "tiers": ["active", "thread"],  // Optional: filter by tiers
  "conversationId": "uuid"  // Optional: for tracking
}
```

**Response**: 200 OK
```json
{
  "success": true,
  "data": {
    "memories": [
      {
        "id": "uuid",
        "content": "...",
        "tier": "active",
        "category": "...",
        "tags": [...],
        "source": "...",
        "access_count": 5,
        "last_accessed": "2026-01-08T19:00:00Z",
        "created_at": "2026-01-08T10:00:00Z",
        "similarity": 0.85  // Cosine similarity score (0-1)
      }
    ],
    "count": 1,
    "query": "original query text"
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-08T20:00:00Z",
    "queryTime": 45,  // milliseconds
    "embeddingProvider": "ollama"
  }
}
```

**Notes**:
- Results ranked by similarity score (highest first)
- Updates `access_count` and `last_accessed` for all returned memories
- Records co-occurrences between memories in results (if conversationId provided)
- Typical query time: 40-60ms

---

### Bootstrap Context

#### GET /api/v1/memories/bootstrap
Load initial conversation context from tiered memories.

**Query Parameters**:
- `conversationId` (required): UUID for conversation tracking
- `limit` (optional): Total memory limit, 1-200, default 50
- `includeActive` (optional): Include active tier, default true
- `includeThread` (optional): Include thread tier, default true
- `includeStable` (optional): Include stable tier, default true

**Response**: 200 OK
```json
{
  "success": true,
  "data": {
    "memories": {
      "active": [
        {
          "id": "uuid",
          "content": "...",
          "tier": "active",
          "category": "...",
          "tags": [...],
          "source": "...",
          "access_count": 3,
          "created_at": "2026-01-08T10:00:00Z"
        }
      ],
      "thread": [...],  // Top 70% of remaining limit
      "stable": [...]   // Top 30% of remaining limit
    },
    "distribution": {
      "active": 5,
      "thread": 7,
      "stable": 3,
      "total": 15
    }
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-08T20:00:00Z"
  }
}
```

**Loading Strategy**:
1. Load ALL active tier memories first
2. Split remaining limit: 70% thread, 30% stable
3. Thread tier: ordered by access_count DESC, last_accessed DESC
4. Stable tier: ordered by access_count DESC, last_accessed DESC
5. Updates access tracking for all loaded memories

---

## Data Types

### Tier Enum
- `active` - Currently relevant memories (new/recent)
- `thread` - Thread-level context (3+ accesses)
- `stable` - Long-term stable patterns (10+ accesses)
- `network` - Background knowledge (rarely accessed but connected)

### Memory Object
```typescript
{
  id: string (UUID)
  content: string
  content_hash: string (SHA-256 hex)
  tier: 'active' | 'thread' | 'stable' | 'network'
  category?: string
  tags?: string[]
  source?: string
  access_count: number
  last_accessed: string (ISO 8601)
  created_at: string (ISO 8601)
  updated_at: string (ISO 8601)
  similarity?: number  // Only in query results
}
```

---

## Technical Details

### Embeddings
- Model: nomic-embed-text (Ollama)
- Dimensions: 768
- Fallback: OpenAI text-embedding-3-small (if API key configured)
- Generation time: ~50ms per embedding

### Vector Search
- Engine: PostgreSQL pgvector extension
- Index: HNSW (m=16, ef_construction=64)
- Distance metric: Cosine similarity
- Search time: ~40-60ms typical

### Deduplication
- Method: SHA-256 content hashing
- Duplicate behavior: Returns existing memory, increments access_count
- Case-sensitive: Yes (different cases = different memories)

---

## Rate Limits
None currently (v1 development).

## Versioning
API version: `v1`
Current version: `1.0.0`
