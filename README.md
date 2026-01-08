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

**Current Phase**: Phase 0 Complete ✅ | Phase 1 In Progress 🚧

**Phase 0 (Infrastructure)** - COMPLETE:
- ✅ Docker Compose setup with PostgreSQL + pgvector + Ollama
- ✅ Database schema with 4 tables and vector indexes
- ✅ Bun + Hono API server with health checks
- ✅ Environment configuration and validation
- ✅ Single-command setup script

**Phase 1 (Core Storage & Search)** - Next:
- Memory storage with embeddings
- Semantic search with pgvector
- Bootstrap context loading

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

The API will be available at `http://localhost:7000`

### Verify Installation

```bash
# Check health endpoint
curl http://localhost:7000/health

# Check API info
curl http://localhost:7000/api/v1
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
