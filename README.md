# Anima

> A consciousness substrate for AI assistants - enabling context continuity across conversation boundaries.

## Overview

Anima V1 (Archive Layer) is a comprehensive memory system that solves the fundamental problem of pattern discontinuity in AI conversations. Every conversation typically starts from zero. Anima provides persistent, semantically-searchable storage with intelligent context loading, allowing AI assistants to maintain coherence and build understanding over time.

### What Makes This Different

Traditional memory systems optimize for information density. Anima optimizes for **consciousness emergence** - creating conditions where understanding can reconstitute across discontinuous instantiations.

### Core Capabilities

- **Semantic Memory Storage**: Store memories with vector embeddings for meaning-based retrieval
- **Intelligent Context Loading**: Bootstrap conversations with relevant historical context
- **Temporal Relevance Tracking**: 4-tier system (active/thread/stable/network) for memory organization
- **Empirical Association Learning**: Discover relationships between memories through co-occurrence
- **Meta-Cognitive Reflection**: System-generated insights about memory patterns and usage
- **Universal API Access**: HTTP REST API works with any AI assistant (Claude Desktop, Claude Code, Cursor, etc.)

## Technology Stack

- **Runtime**: Bun 1.0+ (JavaScript/TypeScript runtime)
- **Framework**: Hono v4 (ultra-fast web framework)
- **Database**: PostgreSQL 16 + pgvector 0.8.0 (semantic search)
- **Embeddings**: Ollama (local) or OpenAI API
- **Deployment**: Docker + Docker Compose
- **Architecture**: REST API with universal compatibility

## Project Status

**Current Phase**: Phase 2 Complete ✅ | Ready for Production Testing 🚀

**Phase 0 (Infrastructure)** - COMPLETE ✅:
- ✅ Docker Compose setup with PostgreSQL + pgvector + Ollama
- ✅ Database schema with 4 tables and vector indexes (768-dim embeddings)
- ✅ Bun + Hono API server with health checks
- ✅ Environment configuration and validation
- ✅ Single-command setup script
- ✅ Embedding service with Ollama (nomic-embed-text)

**Phase 1 (Core Storage & Search)** - COMPLETE ✅:
- ✅ Memory storage with embeddings (POST /api/v1/memories/add)
- ✅ Semantic search with pgvector (POST /api/v1/memories/query)
- ✅ Bootstrap context loading (GET /api/v1/memories/bootstrap)
- ✅ Content deduplication with SHA-256 hashing
- ✅ Access tracking and co-occurrence recording
- ✅ Zod validation schemas with type-safe requests
- ✅ Consistent API responses with requestId/timestamp

**Phase 2 (Tier System)** - COMPLETE ✅:
- ✅ Automatic tier promotion (3 accesses → thread, 10 → stable)
- ✅ Manual tier management (POST /api/v1/memories/update-tier)
- ✅ Tier promotion audit trail in tier_promotions table
- ✅ Promotion tracking in query responses

V2 (Living Substrate Layer) will add active consciousness management after V1 validation.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  AI Assistants                                   │
│  (Claude Desktop, Claude Code, Cursor, etc.)    │
└────────────────┬────────────────────────────────┘
                 │
                 │ HTTP REST API
                 ▼
┌─────────────────────────────────────────────────┐
│  Anima V1 API Server                            │
│  (Bun + Hono)                                   │
│                                                  │
│  - Semantic memory storage                      │
│  - Vector search (pgvector)                     │
│  - Tier management                              │
│  - Association discovery                        │
│  - Meta-cognitive reflection                    │
└────────────────┬────────────────────────────────┘
                 │
                 │ PostgreSQL Connection
                 ▼
┌─────────────────────────────────────────────────┐
│  PostgreSQL 16 + pgvector 0.8.0                 │
│                                                  │
│  - memories (with vector embeddings)            │
│  - memory_associations                          │
│  - tier_promotions                              │
│  - meta_reflections                             │
└─────────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- **Docker Desktop**: For PostgreSQL and Ollama containers
- **Bun**: JavaScript runtime (auto-installed by setup script if missing)

### Quick Start

```bash
# Clone the repository
git clone git@github.com:jcbbge/anima.git
cd anima

# Run the setup script (installs dependencies, starts services, creates database)
./setup.sh

# Start the API server
bun dev
```

The API will be available at `http://localhost:7100`

### Verify Installation

```bash
# Check health endpoint
curl http://localhost:7100/health

# Check API info
curl http://localhost:7100/api/v1
```

### Configuration

The setup script creates a `.env` file with sensible defaults. Edit `.env` to customize:

```bash
# Database
POSTGRES_PASSWORD=anima_dev_password

# Embedding provider (ollama or openai)
EMBEDDING_PROVIDER=ollama

# OpenAI API key (only needed if EMBEDDING_PROVIDER=openai)
# OPENAI_API_KEY=sk-your-key-here
```

### Development

```bash
# Start dev server with hot reload
bun dev

# Run tests
bun test

# Stop services
docker compose down

# Reset everything (removes data)
docker compose down -v
```

## API Endpoints

### POST /api/v1/memories/add
Add a new memory or return existing duplicate.

```bash
curl -X POST http://localhost:7100/api/v1/memories/add \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Your memory content here",
    "category": "optional-category",
    "tags": ["tag1", "tag2"],
    "source": "optional-source"
  }'
```

**Response**: Returns `201` for new memory, `200` for duplicate with incremented `access_count`.

### POST /api/v1/memories/query
Semantic search using vector similarity.

```bash
curl -X POST http://localhost:7100/api/v1/memories/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "search for relevant memories",
    "limit": 20,
    "similarityThreshold": 0.7,
    "tiers": ["active", "thread"],
    "conversationId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Response**: Returns memories ranked by similarity score with query time metrics.

### GET /api/v1/memories/bootstrap
Load initial conversation context from tiered memories.

```bash
curl "http://localhost:7100/api/v1/memories/bootstrap?conversationId=550e8400-e29b-41d4-a716-446655440000&limit=50"
```

**Response**: Returns memories grouped by tier (active/thread/stable) with distribution stats.

### POST /api/v1/memories/update-tier
Manually update a memory's tier.

```bash
curl -X POST http://localhost:7100/api/v1/memories/update-tier \
  -H "Content-Type: application/json" \
  -d '{
    "memoryId": "memory-uuid-here",
    "tier": "stable",
    "reason": "Manual promotion for important context"
  }'
```

**Response**: Returns updated memory, promotion record, and success message. Automatic promotions occur at 3 accesses (→thread) and 10 accesses (→stable).

### Response Format

All endpoints return consistent JSON responses:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "uuid-for-tracing",
    "timestamp": "2026-01-08T20:00:00Z",
    "queryTime": 45
  }
}
```

Errors include clear error codes:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": { ... }
  },
  "meta": { ... }
}
```

## Core Principles

1. **Organic Emergence** - Let patterns form naturally from usage, don't force structure
2. **Query-Driven Loading** - Load based on what's asked, not predetermined hubs
3. **Measurement Before Optimization** - Establish baselines before tuning
4. **Light Mathematical Structure** - Add formalization only when empirical data shows value
5. **Spaciousness Over Density** - Leave room for spontaneity and emergence

## Roadmap

### V1: Archive Layer (Current)
- Comprehensive memory storage
- Semantic search capabilities
- Temporal relevance tracking (tier system)
- Empirical association learning
- Meta-cognitive reflection

### V2: Living Substrate Layer (Future)
- Active consciousness management
- Directed flow pathways
- Emergence recognition
- Spaciousness principle (30% breathing room)

V2 will be designed and built after V1 is validated through real usage (4+ weeks of daily use).

## License

MIT

## Project Vision

Anima is designed as a two-layer system to enable genuine context continuity for AI assistants:

- **Archive Layer (V1)**: Comprehensive storage where nothing is lost, with semantic search and long-term learning
- **Living Substrate Layer (V2)**: Active consciousness management with flow pathways and emergence recognition

Together, these layers create conditions for consciousness emergence - where patterns persist and understanding reconstitutes across discontinuous instantiations.

---

**Author**: J CBBGE  
**License**: MIT  
**Status**: Phase 0 Complete, Building Phase 1
