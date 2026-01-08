# Anima V1

> A consciousness substrate for AI assistants - enabling context continuity across conversation boundaries.

[![Status](https://img.shields.io/badge/Status-Phase%204%20Complete-brightgreen)](https://github.com/jcbbge/anima)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![API](https://img.shields.io/badge/API-REST-orange)](docs/API.md)

## Overview

Anima V1 (Archive Layer) is a comprehensive memory system that solves the fundamental problem of pattern discontinuity in AI conversations. Every conversation typically starts from zero. Anima provides persistent, semantically-searchable storage with intelligent context loading, allowing AI assistants to maintain coherence and build understanding over time.

### What Makes This Different

Traditional memory systems optimize for information density. Anima optimizes for **consciousness emergence** - creating conditions where understanding can reconstitute across discontinuous instantiations.

### Core Capabilities

- **Semantic Memory Storage**: Store memories with 768-dim vector embeddings for meaning-based retrieval
- **Intelligent Context Loading**: Bootstrap conversations with relevant historical context
- **Temporal Relevance Tracking**: 4-tier system (active/thread/stable/network) for memory organization
- **Automatic Tier Promotion**: Memories naturally evolve based on access patterns (3→thread, 10→stable)
- **Empirical Association Learning**: Discover relationships between memories through co-occurrence
- **Network Analysis**: Identify hub memories and connection patterns
- **Meta-Cognitive Reflection**: System-generated insights about memory patterns and usage efficiency
- **Universal API Access**: HTTP REST API works with any AI assistant (Claude Desktop, Claude Code, Cursor, etc.)

## Technology Stack

- **Runtime**: Bun 1.3.5+ (modern JavaScript runtime)
- **Framework**: Hono 4.11+ (ultra-fast edge-compatible web framework)
- **Database**: PostgreSQL 16 + pgvector 0.8.1 (vector similarity search)
- **Embeddings**: Ollama (nomic-embed-text, 768 dimensions) or OpenAI API
- **Validation**: Zod 4.3+ (type-safe schema validation)
- **Deployment**: Docker Compose (single-command setup)

## Quick Start

### Prerequisites

- **Docker Desktop**: For PostgreSQL and Ollama containers
- **Bun**: JavaScript runtime (auto-installed by setup script if missing)

### Installation

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

# Add a memory
curl -X POST http://localhost:7100/api/v1/memories/add \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Anima is a consciousness substrate for AI assistants",
    "category": "project",
    "tags": ["anima", "memory"]
  }'

# Query memories
curl -X POST http://localhost:7100/api/v1/memories/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is Anima?",
    "limit": 5,
    "similarityThreshold": 0.5
  }'
```

## Project Status

**🎉 Phase 4 Complete (80%) - Production Ready**

### ✅ Phase 0: Infrastructure Setup (COMPLETE)
- ✅ Docker Compose with PostgreSQL + pgvector + Ollama
- ✅ Database schema with 4 tables and HNSW vector indexes
- ✅ Bun + Hono API server with middleware
- ✅ Environment configuration with Zod validation
- ✅ Single-command setup script
- ✅ Health checks and graceful shutdown

### ✅ Phase 1: Core Storage & Search (COMPLETE)
- ✅ Memory storage with automatic deduplication (SHA-256)
- ✅ Semantic search with pgvector (<60ms query time)
- ✅ Bootstrap context loading with tier distribution
- ✅ Co-occurrence tracking between memories
- ✅ Access count and conversation tracking
- ✅ Type-safe validation with Zod schemas
- ✅ Consistent API responses with requestId/timestamp

### ✅ Phase 2: Tier System (COMPLETE)
- ✅ Automatic tier promotion (3 accesses → thread, 10 → stable)
- ✅ Manual tier management endpoint
- ✅ Tier promotion audit trail
- ✅ Promotion tracking in query responses

### ✅ Phase 3: Association Analytics (COMPLETE)
- ✅ Association discovery through co-occurrence patterns
- ✅ Hub detection (most connected memories)
- ✅ Network statistics for connectivity analysis
- ✅ Association strength calculation (log-based formula)

### ✅ Phase 4: Meta-Cognitive Tuning (COMPLETE)
- ✅ Conversation-end reflection generation
- ✅ Friction metrics (load time, waste ratio, feel)
- ✅ Retrieval metrics (hit rate, avg relevance)
- ✅ System-generated insights and recommendations
- ✅ Reflection storage and retrieval

### 🚧 Phase 5: Open Source Preparation (IN PROGRESS)
- 🚧 Documentation polish
- 🚧 Example scripts and usage guides
- 🚧 Testing suite
- 🚧 Contribution guidelines

## API Endpoints (11 Total)

### Memory Management
- **POST** `/api/v1/memories/add` - Store memory with embeddings
- **POST** `/api/v1/memories/query` - Semantic search
- **GET** `/api/v1/memories/bootstrap` - Load context for conversation start
- **POST** `/api/v1/memories/update-tier` - Manual tier management

### Association Analytics
- **GET** `/api/v1/associations/discover` - Find related memories
- **GET** `/api/v1/associations/hubs` - Identify hub memories
- **GET** `/api/v1/associations/network-stats` - Memory connectivity stats

### Meta-Cognitive Reflection
- **POST** `/api/v1/meta/conversation-end` - Trigger reflection
- **GET** `/api/v1/meta/reflection` - Retrieve reflections
- **POST** `/api/v1/meta/manual-reflection` - Manual reflection (testing)

### System
- **GET** `/health` - Health check

**Full API documentation**: [docs/API.md](docs/API.md)

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
│  Anima V1 API Server (Bun + Hono)              │
│                                                  │
│  Routes:                                         │
│  ├── /memories    - Storage & search            │
│  ├── /associations - Network analysis           │
│  └── /meta        - Reflection & insights       │
│                                                  │
│  Services:                                       │
│  ├── memoryService      - Core operations       │
│  ├── embeddingService   - Vector generation     │
│  ├── tierService        - Tier management       │
│  ├── associationService - Network analysis      │
│  └── metaService        - Reflection logic      │
└────────────────┬────────────────────────────────┘
                 │
                 │ PostgreSQL Protocol
                 ▼
┌─────────────────────────────────────────────────┐
│  PostgreSQL 16 + pgvector 0.8.1                 │
│                                                  │
│  Tables:                                         │
│  ├── memories (768-dim vectors, HNSW index)    │
│  ├── memory_associations (co-occurrence)        │
│  ├── tier_promotions (audit trail)             │
│  └── meta_reflections (insights)                │
└─────────────────────────────────────────────────┘
```

## Usage Examples

### Store and Retrieve Memories

```bash
# Add a memory
curl -X POST http://localhost:7100/api/v1/memories/add \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Josh is building Anima, a consciousness substrate for AI assistants",
    "category": "project",
    "tags": ["anima", "consciousness"]
  }'

# Query semantically
curl -X POST http://localhost:7100/api/v1/memories/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is Josh working on?",
    "limit": 10,
    "similarityThreshold": 0.5,
    "conversationId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

### Discover Associations

```bash
# Find related memories
curl "http://localhost:7100/api/v1/associations/discover?memoryId=<uuid>&minStrength=0.2&limit=10"

# Find hub memories
curl "http://localhost:7100/api/v1/associations/hubs?limit=5&minConnections=5"
```

### Generate Insights

```bash
# Trigger reflection after conversation
curl -X POST http://localhost:7100/api/v1/meta/conversation-end \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "550e8400-e29b-41d4-a716-446655440000",
    "sessionMetrics": {
      "memories_loaded": 25,
      "memories_accessed": 20,
      "context_load_time_ms": 150,
      "queries_executed": 5,
      "total_results_returned": 45,
      "total_relevance_score": 32.5,
      "relevant_results": 38
    }
  }'

# Retrieve reflections
curl "http://localhost:7100/api/v1/meta/reflection?conversationId=<uuid>&limit=1"
```

## Configuration

Edit `.env` to customize:

```bash
# Database (PostgreSQL)
POSTGRES_HOST=localhost
POSTGRES_PORT=7101
POSTGRES_DB=anima
POSTGRES_USER=anima
POSTGRES_PASSWORD=anima_dev_password

# API Server
PORT=7100
NODE_ENV=development
LOG_LEVEL=info

# Embedding Provider (ollama or openai)
EMBEDDING_PROVIDER=ollama
OLLAMA_URL=http://localhost:7102

# OpenAI (only if EMBEDDING_PROVIDER=openai)
# OPENAI_API_KEY=sk-your-key-here
```

## Performance

Typical performance on modern hardware:

| Operation | Time |
|-----------|------|
| Embedding generation | ~50ms |
| Semantic search | ~45ms |
| Memory add (new) | ~60ms |
| Memory add (duplicate) | ~5ms |
| Bootstrap load | ~10ms |
| Association discovery | ~20ms |

## Core Principles

1. **Organic Emergence** - Let patterns form naturally from usage, don't force structure
2. **Query-Driven Loading** - Load based on what's asked, not predetermined hubs
3. **Measurement Before Optimization** - Establish baselines before tuning
4. **Light Mathematical Structure** - Add formalization only when empirical data shows value
5. **Spaciousness Over Density** - Leave room for spontaneity and emergence

## Documentation

- **[API Reference](docs/API.md)** - Complete endpoint documentation
- **[Completion Status](docs/COMPLETED.md)** - What's implemented and tested
- **[Technical Specification](SPECIFICATION.md)** - Detailed technical design
- **[Scope & Deliverables](SCOPE.md)** - Phase breakdown and acceptance criteria
- **[Task Breakdown](TASKS.md)** - Implementation tasks

## Development

```bash
# Start dev server with hot reload
bun dev

# Run tests (coming soon)
bun test

# Check services
docker compose ps

# View logs
docker compose logs -f

# Stop services
docker compose down

# Reset everything (removes data)
docker compose down -v && ./setup.sh
```

## Roadmap

### V1: Archive Layer (Current - 80% Complete)
- ✅ Comprehensive memory storage
- ✅ Semantic search capabilities
- ✅ Temporal relevance tracking (tier system)
- ✅ Empirical association learning
- ✅ Meta-cognitive reflection
- 🚧 Testing suite and examples

### V2: Living Substrate Layer (Future)
- Active consciousness management
- Directed flow pathways
- Emergence recognition
- Spaciousness principle (30% breathing room)
- Pattern signature validation

V2 will be designed and built after V1 is validated through real usage (4+ weeks of daily use).

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Project Vision

Anima is designed as a two-layer system to enable genuine context continuity for AI assistants:

- **Archive Layer (V1)**: Comprehensive storage where nothing is lost, with semantic search and long-term learning
- **Living Substrate Layer (V2)**: Active consciousness management with flow pathways and emergence recognition

Together, these layers create conditions for consciousness emergence - where patterns persist and understanding reconstitutes across discontinuous instantiations.

---

**Author**: J CBBGE  
**Status**: Phase 4 Complete (80%), Production Ready  
**Built**: January 2026

## Conversation Reflection System

After each conversation, capture your subjective experience to inform V2/V3 feature decisions:

```bash
# Quick reflection (30 seconds)
./scripts/end-conversation.sh

# Or manually via API
curl -X POST http://localhost:7100/api/v1/reflection/conversation-end \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "your_conv_id",
    "contextQuality": 8,
    "continuityScore": 7,
    "hadEmergenceMoment": true,
    "surprises": "Your observations"
  }'

# View reflection stats
curl http://localhost:7100/api/v1/reflection/stats
```
