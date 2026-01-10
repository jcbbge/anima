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
- `REFLECTION_ERROR` - Failed to generate reflection (500)
- `REFLECTION_RETRIEVAL_ERROR` - Failed to retrieve reflections (500)

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

---

### Meta-Cognitive Reflection

#### POST /api/v1/meta/conversation-end
Trigger system reflection after a conversation ends.

**Request Body**:
```json
{
  "conversationId": "uuid (required)",
  "sessionMetrics": {
    "memories_loaded": 25,
    "memories_accessed": 20,
    "context_load_time_ms": 150,
    "queries_executed": 5,
    "total_results_returned": 45,
    "total_relevance_score": 32.5,
    "relevant_results": 38
  }
}
```

**Response**: 200 OK
```json
{
  "success": true,
  "data": {
    "reflection": {
      "id": "uuid",
      "reflection_type": "conversation_end",
      "conversation_id": "uuid",
      "metrics": {
        "friction": {
          "context_load_time_ms": 150,
          "memories_loaded": 25,
          "memories_accessed": 20,
          "waste_ratio": 0.2,
          "feel": "smooth"
        },
        "retrieval": {
          "queries_executed": 5,
          "avg_results_returned": 9,
          "avg_relevance_score": 0.72,
          "hit_rate": 0.84
        },
        "tier_distribution": {
          "active": 45,
          "thread": 120,
          "stable": 890,
          "network": 1200
        },
        "top_hubs": [
          {
            "memory_id": "uuid",
            "connection_count": 23,
            "content_preview": "Hub memory preview...",
            "tier": "stable"
          }
        ]
      },
      "insights": [
        "System friction is low - context loading is efficient",
        "High hit rate suggests excellent query relevance"
      ],
      "recommendations": [
        "Continue current bootstrap strategy",
        "Consider caching frequently accessed memories"
      ],
      "created_at": "2026-01-08T20:00:00Z"
    }
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-08T20:00:00Z"
  }
}
```

**Metrics Explained**:

- **Friction Metrics** - How smooth is the system?
  - `context_load_time_ms` - Time to load initial context
  - `memories_loaded` - Total memories loaded
  - `memories_accessed` - Memories actually used
  - `waste_ratio` - (loaded - accessed) / loaded (0-1, lower is better)
  - `feel` - "smooth" | "sticky" | "rough"

- **Retrieval Metrics** - How well are queries working?
  - `queries_executed` - Number of queries in session
  - `avg_results_returned` - Average results per query
  - `avg_relevance_score` - Average similarity score (0-1)
  - `hit_rate` - Relevant results / total results (0-1)

- **Tier Distribution** - Memory distribution across tiers

- **Top Hubs** - Most connected memories in network

**Notes**:
- Automatically stores reflection in `meta_reflections` table
- Generates human-readable insights and recommendations
- All metrics optional - calculates based on provided data

---

#### GET /api/v1/meta/reflection
Retrieve stored reflections.

**Query Parameters**:
- `conversationId` (optional): UUID to filter by conversation
- `reflectionType` (optional): Filter by type: 'conversation_end', 'weekly', 'manual'
- `limit` (optional): Number to return 1-50, default 1

**Examples**:
```
GET /api/v1/meta/reflection?conversationId=550e8400-e29b-41d4-a716-446655440000
GET /api/v1/meta/reflection?reflectionType=conversation_end&limit=10
GET /api/v1/meta/reflection?limit=5
```

**Response**: 200 OK
```json
{
  "success": true,
  "data": {
    "reflections": [
      {
        "id": "uuid",
        "reflection_type": "conversation_end",
        "conversation_id": "uuid",
        "metrics": { ... },
        "insights": [ ... ],
        "recommendations": [ ... ],
        "created_at": "2026-01-08T20:00:00Z"
      }
    ],
    "count": 1
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-01-08T20:00:00Z"
  }
}
```

**Notes**:
- Without filters, returns most recent reflections globally
- With conversationId, returns reflections for that conversation
- With reflectionType, returns reflections of that type

---

#### POST /api/v1/meta/manual-reflection
Manually trigger a reflection (for testing/debugging).

**Request Body**:
```json
{
  "conversationId": "uuid (optional)",
  "sessionMetrics": {
    // Same as conversation-end endpoint
  }
}
```

**Response**: 200 OK (same structure as conversation-end)

**Notes**:
- Creates reflection with type 'manual'
- Useful for testing reflection logic
- ConversationId optional for manual reflections

---

## Data Types

### Reflection Type Enum
- `conversation_end` - Generated after conversation ends
- `weekly` - Periodic weekly reflection (future)
- `manual` - Manually triggered reflection

### Feel Enum
- `smooth` - Low friction, efficient operation
- `sticky` - Some friction present
- `rough` - High friction, needs optimization

