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
- `TIER_UPDATE_ERROR` - Failed to update memory tier (500)
- `ASSOCIATION_DISCOVERY_ERROR` - Failed to discover associations (500)
- `HUB_DISCOVERY_ERROR` - Failed to find hub memories (500)
- `NETWORK_STATS_ERROR` - Failed to retrieve network stats (500)

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

### Tier Management

#### POST /api/v1/memories/update-tier
Manually promote or demote a memory between tiers.

**Request Body**:
```json
{
  "memoryId": "uuid (required)",
  "tier": "active | thread | stable | network (required)",
  "reason": "Optional reason string (max 200 chars)"
}
```

**Response**: 200 OK
```json
{
  "success": true,
  "data": {
    "memory": {
      "id": "uuid",
      "tier": "stable",
      "tier_last_updated": "2026-01-08T20:00:00Z"
    },
    "promotion_recorded": true,
    "message": "Tier updated successfully"
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-08T20:00:00Z"
  }
}
```

**Notes**:
- Records tier change in `tier_promotions` audit table
- Updates `tier_last_updated` timestamp
- Validates tier enum values

---

### Association Discovery

#### GET /api/v1/associations/discover
Find memories associated with a given memory through co-occurrence patterns.

**Query Parameters**:
- `memoryId` (required): UUID of memory to find associations for
- `minStrength` (optional): Minimum association strength 0-1, default 0.1
- `limit` (optional): Maximum associations to return 1-100, default 20

**Example**:
```
GET /api/v1/associations/discover?memoryId=550e8400-e29b-41d4-a716-446655440000&minStrength=0.2&limit=10
```

**Response**: 200 OK
```json
{
  "success": true,
  "data": {
    "memory_id": "550e8400-e29b-41d4-a716-446655440000",
    "associations": [
      {
        "associated_memory_id": "uuid",
        "associated_content": "Related memory content...",
        "associated_tier": "thread",
        "associated_category": "project",
        "associated_tags": ["tag1", "tag2"],
        "associated_access_count": 5,
        "strength": 0.45,
        "co_occurrence_count": 12,
        "first_co_occurred": "2026-01-01T10:00:00Z",
        "last_co_occurred": "2026-01-08T20:00:00Z",
        "conversation_contexts": ["uuid1", "uuid2"]
      }
    ],
    "total_associations": 1
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-08T20:00:00Z"
  }
}
```

**Association Strength Formula**:
```
strength = LOG(1 + co_occurrence_count) / 10.0
```

**Notes**:
- Associations created when memories appear together in query results
- Bidirectional: A→B and B→A both discoverable
- Ordered by strength DESC, then co_occurrence_count DESC

---

#### GET /api/v1/associations/hubs
Find hub memories (most connected nodes in the memory network).

**Query Parameters**:
- `limit` (optional): Number of top hubs to return 1-50, default 10
- `minConnections` (optional): Minimum connections to qualify as hub, default 5

**Example**:
```
GET /api/v1/associations/hubs?limit=5&minConnections=10
```

**Response**: 200 OK
```json
{
  "success": true,
  "data": {
    "hubs": [
      {
        "memory_id": "uuid",
        "content": "Hub memory content...",
        "tier": "stable",
        "category": "core-concept",
        "access_count": 45,
        "created_at": "2026-01-01T10:00:00Z",
        "network_stats": {
          "total_connections": 23,
          "total_co_occurrences": 67,
          "avg_strength": 0.42
        }
      }
    ]
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-08T20:00:00Z"
  }
}
```

**Notes**:
- Hubs are memories with high connection counts
- Useful for identifying central concepts/patterns
- Ordered by total_connections DESC, then avg_strength DESC

---

#### GET /api/v1/associations/network-stats
Get network statistics for a specific memory.

**Query Parameters**:
- `memoryId` (required): UUID of memory to analyze

**Example**:
```
GET /api/v1/associations/network-stats?memoryId=550e8400-e29b-41d4-a716-446655440000
```

**Response**: 200 OK
```json
{
  "success": true,
  "data": {
    "memory_id": "550e8400-e29b-41d4-a716-446655440000",
    "total_associations": 15,
    "avg_strength": 0.35,
    "max_strength": 0.68,
    "total_co_occurrences": 42
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-08T20:00:00Z"
  }
}
```

**Notes**:
- Shows how connected this memory is to others
- Useful for understanding memory importance in network

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
