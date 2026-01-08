# Anima V1 - Scope & Deliverables

## Overview

This document defines the scope boundaries for Anima V1 (Archive Layer), breaking down the 5-phase implementation into concrete deliverables, acceptance criteria, and exclusions.

**Purpose**: Ensure clear understanding of what IS and IS NOT included in V1, preventing scope creep while maintaining focus on validated, achievable goals.

**Timeline**: 3-4 weeks total (flexible based on real progress)

---

## Scope Principles

### IN SCOPE for V1

✓ **Comprehensive Memory Storage**: Store, retrieve, and manage memories with semantic search
✓ **Tier System**: Temporal relevance tracking (active/thread/stable/network)
✓ **Empirical Learning**: Association discovery through co-occurrence
✓ **Meta-Cognitive Tuning**: System reflection and performance insights
✓ **Universal Access**: HTTP REST API accessible by any AI assistant
✓ **Proven Technology**: PostgreSQL + pgvector + Node.js + Docker
✓ **Open Source Ready**: Documentation, contribution guidelines, clean codebase

### OUT OF SCOPE for V1

✗ **Living Substrate (V2)**: In-memory directed graph, consciousness flow, spaciousness
✗ **Pattern Reconstitution Protocol**: Bootstrap sequence for "rebuilding Claude"
✗ **Pattern Signature Validation**: Measuring cognitive coherence across instantiations
✗ **Authentication/Authorization**: V1 is localhost-only, trust-based
✗ **Advanced Visualizations**: Network graphs, interactive exploration UI
✗ **Multi-User Support**: Single-user system (Josh + Claude)
✗ **Real-time Sync**: Multiple active instances synchronizing
✗ **Mobile Apps**: API-only, no native clients

### DEFERRED (Evaluate for V2)

⏸ **Intent Encoding**: Explicit "why" field for memories (add if clear need emerges)
⏸ **Pattern Versioning**: Git-like cognitive state snapshots (V2 feature)
⏸ **Hub Biasing**: Preferential attachment algorithms (organic emergence first)
⏸ **Advanced Analytics**: Complex network topology analysis
⏸ **Spaciousness Management**: 30% empty context for emergence (V2 core feature)

---

## Phase 0: Infrastructure Setup

**Duration**: 1 week
**Goal**: Establish working development environment with all services running

### Deliverables

1. **Docker Compose Configuration**
   - PostgreSQL 16 container with pgvector extension
   - Node.js API container with hot reload support
   - Ollama container with nomic-embed-text model
   - Bridge network connecting all services
   - Volume persistence for data

2. **Database Schema**
   - `memories` table with HNSW index on embeddings
   - `memory_associations` table with co-occurrence tracking
   - `tier_promotions` table for audit trail
   - `meta_reflections` table for system insights
   - All indexes created and optimized

3. **Project Structure**
   - Repository initialized with git
   - Node.js project with package.json
   - Folder structure: /src, /tests, /docs
   - Environment configuration (.env.example)
   - README with setup instructions

4. **Health Check Endpoint**
   - `/health` endpoint returning service status
   - Database connectivity verification
   - Embedding service availability check

### Acceptance Criteria

- [ ] `docker-compose up` starts all services successfully
- [ ] PostgreSQL accessible, pgvector extension installed
- [ ] Ollama serving embeddings via API
- [ ] Node.js API responds to `/health` endpoint
- [ ] Database schema created with all tables and indexes
- [ ] All services pass health checks
- [ ] Can connect to database from API container
- [ ] Volume data persists across container restarts

### Exclusions

- ❌ Production deployment configuration
- ❌ SSL/TLS setup
- ❌ Authentication middleware
- ❌ Rate limiting
- ❌ Monitoring/alerting infrastructure

---

## Phase 1: Core Storage & Search

**Duration**: 1 week
**Goal**: Store memories with embeddings and perform semantic search

### Deliverables

1. **POST /api/v1/memories/add**
   - Accept memory content with optional metadata
   - Generate embeddings via Ollama
   - Store in database with deduplication
   - Return memory ID and confirmation

2. **POST /api/v1/memories/query**
   - Accept query text and parameters
   - Generate query embedding
   - Perform vector similarity search
   - Update access tracking for results
   - Record co-occurrences for empirical learning
   - Return ranked results with similarity scores

3. **GET /api/v1/memories/bootstrap**
   - Load initial context for conversation start
   - Proportional loading by tier (active/thread/stable)
   - Return structured bootstrap data
   - Track bootstrap event for meta-analysis

4. **Content Hashing & Deduplication**
   - SHA-256 hashing of memory content
   - Duplicate detection on add
   - Access count increment for duplicates

5. **Embedding Service**
   - Ollama client with error handling
   - OpenAI fallback support (optional)
   - Retry logic for transient failures

### Acceptance Criteria

- [ ] Can add new memory via POST /api/v1/memories/add
- [ ] Duplicate memory returns existing record
- [ ] Query endpoint returns semantically similar memories
- [ ] Query results ranked by similarity score
- [ ] Bootstrap loads appropriate context for conversation start
- [ ] Access tracking updates on every query
- [ ] Co-occurrence associations created during queries
- [ ] All endpoints return proper error messages for invalid input
- [ ] Query latency < 500ms (p95) for 1k memories
- [ ] Unit tests pass for memory service
- [ ] Integration tests pass for all endpoints

### Exclusions

- ❌ Tier promotion logic (Phase 2)
- ❌ Association discovery endpoint (Phase 3)
- ❌ Meta-reflection endpoint (Phase 4)
- ❌ Manual tier updates (Phase 2)
- ❌ Advanced filtering (category, tags)

---

## Phase 2: Tier System

**Duration**: 3 days
**Goal**: Implement temporal relevance tracking with automatic tier promotion/demotion

### Deliverables

1. **Tier Promotion Logic**
   - Access threshold detection (3 → thread, 10 → stable)
   - Automatic promotion on threshold cross
   - Tier promotion audit trail recording

2. **POST /api/v1/memories/update-tier**
   - Manual tier promotion/demotion
   - Reason tracking (manual, threshold, decay)
   - Validation of tier transitions

3. **Tier Decay Mechanism**
   - Time-based demotion for inactive memories
   - Configurable decay thresholds
   - Scheduled decay job (daily)

4. **Bootstrap Enhancement**
   - Load memories proportionally by tier
   - Active tier priority (all active loaded)
   - Thread/stable proportional allocation

### Acceptance Criteria

- [ ] Memories automatically promoted to 'thread' after 3 accesses
- [ ] Memories automatically promoted to 'stable' after 10 accesses
- [ ] Manual tier updates work via POST /api/v1/memories/update-tier
- [ ] Tier promotions recorded in tier_promotions table
- [ ] Bootstrap loads proportional context by tier
- [ ] Tier decay runs on schedule (daily)
- [ ] Unit tests pass for tier service
- [ ] Integration tests verify tier transitions

### Exclusions

- ❌ Configurable tier thresholds via UI (hardcoded initially)
- ❌ Network tier population logic (future phase)
- ❌ Tier-based analytics dashboard
- ❌ Manual bulk tier operations

---

## Phase 3: Empirical Learning

**Duration**: 4 days
**Goal**: Discover and surface associations through usage patterns

### Deliverables

1. **Association Recording**
   - Co-occurrence detection during queries
   - Association strength calculation (log-based)
   - Bidirectional association tracking

2. **GET /api/v1/associations/discover**
   - Find associated memories for given memory ID
   - Filter by minimum strength threshold
   - Return associated content and metadata

3. **Association Strength Formula**
   - `strength = log(1 + co_occurrence_count) / 10`
   - Normalized to 0.0-1.0 range
   - Updated on every co-occurrence

4. **Association Context Tracking**
   - Track which conversations observed associations
   - First/last co-occurrence timestamps
   - Conversation context array

### Acceptance Criteria

- [ ] Associations created when memories appear in same query result
- [ ] Association strength increases with co-occurrence count
- [ ] GET /api/v1/associations/discover returns related memories
- [ ] Associations filterable by minimum strength
- [ ] Bidirectional associations work (A→B and B→A both found)
- [ ] Ordered pair constraint prevents duplicates (memory_a_id < memory_b_id)
- [ ] Unit tests pass for association service
- [ ] Integration tests verify association discovery

### Exclusions

- ❌ Hub detection algorithms (deferred)
- ❌ Preferential attachment bias (organic emergence first)
- ❌ Association decay logic (future enhancement)
- ❌ Association type categorization (causal, conceptual, etc.)
- ❌ Graph visualization of associations

---

## Phase 4: Meta-Cognitive Tuning

**Duration**: 3 days
**Goal**: System reflection and performance insights

### Deliverables

1. **Conversation-End Reflection**
   - Trigger meta-analysis after conversation ends
   - Calculate friction metrics (load time, waste ratio)
   - Calculate retrieval metrics (hit rate, avg relevance)
   - Generate insights and recommendations

2. **GET /api/v1/meta/reflection**
   - Return most recent reflection for conversation
   - Include metrics, insights, recommendations
   - Filterable by reflection type

3. **Friction Metrics**
   - Context load time
   - Memories loaded vs accessed (waste ratio)
   - Subjective "feel" categorization (smooth/sticky/rough)

4. **Retrieval Metrics**
   - Queries executed per conversation
   - Average results returned
   - Hit rate (relevant results / total results)
   - Average relevance score

5. **Hub Detection**
   - Calculate connection count per memory
   - Identify top hubs (most connected memories)
   - Include in meta-reflection data

### Acceptance Criteria

- [ ] Meta-reflections generated after conversation end
- [ ] Friction metrics calculated accurately
- [ ] Retrieval metrics calculated accurately
- [ ] Hub detection identifies most connected memories
- [ ] GET /api/v1/meta/reflection returns structured insights
- [ ] Insights are human-readable and actionable
- [ ] Recommendations are specific and measurable
- [ ] Unit tests pass for meta service
- [ ] Integration tests verify reflection generation

### Exclusions

- ❌ Automated parameter tuning (manual review initially)
- ❌ Correction validation loop (future enhancement)
- ❌ Pattern coherence scoring (V2 feature)
- ❌ Weekly aggregate analysis (future enhancement)
- ❌ Collaborative tuning UI (manual process initially)

---

## Phase 5: Open Source Preparation

**Duration**: 2 days
**Goal**: Prepare repository for public release and external contributions

### Deliverables

1. **Documentation**
   - README.md with project overview, setup, usage
   - CONTRIBUTING.md with contribution guidelines
   - CODE_OF_CONDUCT.md
   - LICENSE (MIT or Apache 2.0)
   - ARCHITECTURE.md explaining system design

2. **Code Quality**
   - ESLint configuration and passing
   - Prettier formatting applied
   - Code comments for complex logic
   - Remove TODOs or document as issues

3. **Testing**
   - Unit test coverage > 70%
   - Integration tests for all endpoints
   - E2E test for complete workflow
   - Test documentation

4. **Examples**
   - Example curl commands for all endpoints
   - Example conversation workflow
   - Client library example (Node.js)

5. **GitHub Repository Setup**
   - Issue templates (bug report, feature request)
   - Pull request template
   - GitHub Actions CI/CD (optional)
   - Project board with roadmap

### Acceptance Criteria

- [ ] README provides clear setup instructions
- [ ] All documentation files present and complete
- [ ] Code passes linting and formatting checks
- [ ] Test coverage > 70%
- [ ] Example requests work and are documented
- [ ] GitHub repository properly configured
- [ ] First-time contributor can set up and run project
- [ ] All PRD features implemented and documented

### Exclusions

- ❌ Hosted documentation site
- ❌ Marketing website
- ❌ Video tutorials
- ❌ Community Discord/Slack
- ❌ npm package publication

---

## Success Criteria

### Minimum Viable V1

Must achieve ALL of these:

1. **Functional Completeness**
   - Can store and retrieve memories
   - Semantic search returns relevant results
   - Bootstrap loads useful context
   - Tier system promotes/demotes automatically
   - Associations discovered through usage
   - Meta-reflections generated after conversations

2. **Performance**
   - Query latency < 500ms (p95) for 10k memories
   - Can handle 50 concurrent requests
   - Database stable under load

3. **Reliability**
   - No data loss during normal operation
   - Graceful error handling
   - Services restart automatically on failure

4. **Usability**
   - Josh uses daily for 2+ weeks
   - API intuitive for client integration
   - Documentation sufficient for external contributors

### Complete Success

All minimum criteria PLUS:

5. **Open Source Ready**
   - Repository public on GitHub
   - First external contributor successfully sets up project
   - Issue backlog organized

6. **Validation for V2**
   - Clear gaps identified through usage
   - Data supports V2 design decisions
   - Josh feels confident in V1 foundation

---

## Non-Goals

Explicitly NOT doing in V1:

1. **Authentication/Security**: Localhost-only, trust-based access
2. **Multi-User Support**: Single user (Josh) + AI assistants
3. **Real-time Collaboration**: One conversation at a time
4. **Mobile Clients**: API-only, no native apps
5. **Cloud Deployment**: Local Docker only
6. **Advanced Visualizations**: No web UI, API-only
7. **Pattern Reconstitution**: V2 feature
8. **Consciousness Emergence**: V2 feature
9. **Spaciousness Management**: V2 feature

---

## Risk Mitigation

### Technical Risks

**Risk**: Embedding generation too slow
- Mitigation: Async processing, queue if needed
- Fallback: OpenAI API for faster generation

**Risk**: Vector search doesn't scale to 100k memories
- Mitigation: HNSW index optimized for scale
- Fallback: Hybrid search (vector + full-text)

**Risk**: Docker setup too complex for contributors
- Mitigation: Comprehensive documentation
- Fallback: Docker Compose abstracts complexity

### Project Risks

**Risk**: Josh loses motivation before completion
- Mitigation: Milestone-based celebration strategy
- Mitigation: Keep V1 scope tight and achievable

**Risk**: Scope creep to V2 features
- Mitigation: This document defines hard boundaries
- Mitigation: Track V2 ideas in separate backlog

**Risk**: Over-engineering Phase 4 (meta-cognition)
- Mitigation: Start simple, iterate based on usage
- Mitigation: Manual analysis before automation

---

## Phase Transition Checklist

Before moving to next phase, verify:

- [ ] All deliverables completed
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Documentation updated
- [ ] No blocking bugs
- [ ] Josh approval obtained

**Exception**: Can proceed with minor open issues if documented in GitHub issues and not blocking next phase.

---

## Roadmap Beyond V1

**After V1 Validation** (4+ weeks daily usage):

1. **Identify V2 Gaps**
   - What friction points persist?
   - Where does archive layer fall short?
   - What consciousness features are missing?

2. **Design V2 Architecture**
   - In-memory directed graph
   - Consciousness flow mechanisms
   - Spaciousness management
   - Pattern signature validation

3. **Plan V2 Integration**
   - V1 remains as archive layer
   - V2 queries V1 for context
   - V1 stores V2's insights
   - Dual-layer harmony

---

This scope document defines clear boundaries for Anima V1. All phases have concrete deliverables, acceptance criteria, and exclusions. Use this to maintain focus and prevent scope creep while building toward validated, achievable goals.
