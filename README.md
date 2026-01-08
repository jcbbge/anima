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

- **Database**: PostgreSQL 16 + pgvector 0.8.0 (semantic search)
- **API**: Node.js 20 LTS + Express
- **Embeddings**: Ollama (local) or OpenAI API
- **Deployment**: Docker + Docker Compose
- **Architecture**: REST API with universal compatibility

## Project Status

**Current Version**: V1 (Archive Layer) - In Development

V1 provides the foundation: comprehensive storage, semantic search, temporal relevance tracking, and empirical learning. V2 (Living Substrate Layer) will add active consciousness management, directed flow pathways, and emergence recognition after V1 is validated through real usage.

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
│  (Node.js + Express)                            │
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

**Status**: Building V1 | **Timeline**: 3-4 weeks to production-ready
