# Anima V1 - Task Breakdown

## Overview

This document provides a detailed, actionable task list for implementing Anima V1. Each task is designed to be:

- **Actionable**: Clear scope, can be started immediately
- **Committable**: Small enough to complete and commit independently
- **Testable**: Clear acceptance criteria
- **Trackable**: Can be imported as GitHub issues

**Format**: Each task includes title, description, acceptance criteria, effort estimate, dependencies, and labels.

**Total Estimated Effort**: 15-20 days (3-4 weeks)

---

## Phase 0: Infrastructure Setup (1 week)

### 0.1: Initialize Repository Structure

**Description**: Set up basic repository structure with proper folders and initial files.

**Tasks**:
- Create `/src` directory for application code
- Create `/tests` directory for unit and integration tests
- Create `/docs` directory for documentation
- Create `.gitignore` for Node.js and Docker
- Create `.editorconfig` for consistent formatting
- Create initial `package.json` with project metadata

**Acceptance Criteria**:
- [ ] Directory structure created
- [ ] `.gitignore` excludes node_modules, .env, logs
- [ ] `package.json` has correct name, version, description
- [ ] Repository ready for development

**Effort**: 1 hour
**Dependencies**: None
**Labels**: `phase-0`, `infrastructure`, `good-first-issue`

---

### 0.2: Create Docker Compose Configuration

**Description**: Set up Docker Compose with PostgreSQL, Node.js API, and Ollama services.

**Tasks**:
- Create `docker-compose.yml` with three services
- Configure PostgreSQL 16 with pgvector image
- Configure Node.js API container
- Configure Ollama container
- Set up bridge network
- Configure volume persistence

**Acceptance Criteria**:
- [ ] `docker-compose.yml` file created
- [ ] PostgreSQL service defined with pgvector/pgvector:pg16 image
- [ ] API service defined with Node.js 20
- [ ] Ollama service defined with ollama/ollama:latest
- [ ] Bridge network configured
- [ ] Volumes defined for postgres_data and ollama_data
- [ ] Environment variables configured

**Effort**: 3 hours
**Dependencies**: None
**Labels**: `phase-0`, `infrastructure`, `docker`

---

### 0.3: Create Application Dockerfile

**Description**: Build Dockerfile for Node.js API with proper security and optimization.

**Tasks**:
- Create `Dockerfile` using Node.js 20-alpine
- Configure working directory
- Copy package files and install dependencies
- Copy application code
- Create non-root user
- Add health check
- Expose port 3000

**Acceptance Criteria**:
- [ ] `Dockerfile` created
- [ ] Uses Node.js 20-alpine base image
- [ ] Installs production dependencies only
- [ ] Runs as non-root user
- [ ] Health check configured
- [ ] Port 3000 exposed
- [ ] Image builds successfully

**Effort**: 2 hours
**Dependencies**: Task 0.2 (Docker Compose)
**Labels**: `phase-0`, `infrastructure`, `docker`

---

### 0.4: Create Database Schema SQL

**Description**: Write SQL script to initialize database with all tables and indexes.

**Tasks**:
- Create `init.sql` file
- Enable uuid-ossp and pgvector extensions
- Create `memories` table with proper fields
- Create HNSW index on embeddings
- Create additional indexes for query performance
- Create `memory_associations` table
- Create `tier_promotions` table
- Create `meta_reflections` table
- Add verification query at end

**Acceptance Criteria**:
- [ ] `init.sql` file created
- [ ] Extensions enabled (uuid-ossp, pgvector)
- [ ] `memories` table created with all fields
- [ ] HNSW index created on embeddings column
- [ ] All performance indexes created
- [ ] Foreign key constraints properly defined
- [ ] Check constraints on tier field
- [ ] All tables created without errors

**Effort**: 3 hours
**Dependencies**: None
**Labels**: `phase-0`, `infrastructure`, `database`

---

### 0.5: Create Environment Configuration

**Description**: Set up environment variable management with example file.

**Tasks**:
- Create `.env.example` with all configuration variables
- Create `src/config/environment.js` for validation
- Add environment variable validation function
- Add documentation for each variable

**Acceptance Criteria**:
- [ ] `.env.example` file created with all variables
- [ ] Environment validation function implemented
- [ ] Required variables checked on startup
- [ ] Clear error messages for missing variables
- [ ] Documentation comments for each variable

**Effort**: 2 hours
**Dependencies**: None
**Labels**: `phase-0`, `infrastructure`, `configuration`

---

### 0.6: Set Up Database Connection Pool

**Description**: Implement PostgreSQL connection pooling with proper error handling.

**Tasks**:
- Create `src/config/database.js`
- Configure pg Pool with connection parameters
- Add pool error handling
- Add startup connection test
- Add graceful shutdown logic

**Acceptance Criteria**:
- [ ] Database connection pool configured
- [ ] Connection parameters read from environment
- [ ] Pool error handler logs errors
- [ ] Startup test verifies connectivity
- [ ] Graceful shutdown closes pool properly
- [ ] Console logs connection status

**Effort**: 2 hours
**Dependencies**: Task 0.5 (Environment config)
**Labels**: `phase-0`, `infrastructure`, `database`

---

### 0.7: Set Up Express Application

**Description**: Create Express app with middleware stack.

**Tasks**:
- Create `src/app.js` for Express configuration
- Create `src/server.js` as entry point
- Add helmet middleware for security
- Add cors middleware
- Add body-parser for JSON
- Add morgan for logging
- Add error handler middleware
- Add health check route

**Acceptance Criteria**:
- [ ] Express app configured in `src/app.js`
- [ ] Server starts in `src/server.js`
- [ ] All middleware loaded in correct order
- [ ] `/health` endpoint responds
- [ ] Error handling middleware catches errors
- [ ] Graceful shutdown on SIGTERM

**Effort**: 3 hours
**Dependencies**: Task 0.6 (Database pool)
**Labels**: `phase-0`, `infrastructure`, `api`

---

### 0.8: Create Health Check Endpoint

**Description**: Implement comprehensive health check endpoint.

**Tasks**:
- Create `src/routes/health.js`
- Check database connectivity
- Check embedding service availability (optional for Ollama)
- Return structured health status

**Acceptance Criteria**:
- [ ] GET /health endpoint responds
- [ ] Database connection checked
- [ ] Response includes status, timestamp
- [ ] Returns 200 when healthy, 503 when unhealthy
- [ ] Gracefully handles service failures

**Effort**: 2 hours
**Dependencies**: Task 0.7 (Express app)
**Labels**: `phase-0`, `infrastructure`, `api`, `health`

---

### 0.9: Set Up Ollama Embedding Service

**Description**: Configure Ollama for embedding generation.

**Tasks**:
- Create `src/config/embeddings.js`
- Configure axios client for Ollama
- Add OpenAI client as fallback (optional)
- Create `src/services/embeddingService.js`
- Implement embedding generation function
- Add error handling and retries

**Acceptance Criteria**:
- [ ] Ollama client configured
- [ ] Can generate embeddings via POST /api/embeddings
- [ ] Returns 384-dimensional vector
- [ ] Error handling for service unavailable
- [ ] Retry logic for transient failures
- [ ] OpenAI fallback optional

**Effort**: 3 hours
**Dependencies**: Task 0.5 (Environment config)
**Labels**: `phase-0`, `infrastructure`, `embeddings`

---

### 0.10: Verify Full Stack Setup

**Description**: End-to-end verification that all services are running and connected.

**Tasks**:
- Run `docker-compose up -d`
- Verify PostgreSQL is healthy
- Verify API is responding
- Verify Ollama is serving embeddings
- Verify database schema initialized
- Test health check endpoint
- Document any setup issues

**Acceptance Criteria**:
- [ ] All containers start successfully
- [ ] PostgreSQL passes health check
- [ ] API responds to /health endpoint
- [ ] Ollama generates test embedding
- [ ] Database tables exist
- [ ] Can connect to database from API
- [ ] Documentation updated with setup steps

**Effort**: 2 hours
**Dependencies**: All Phase 0 tasks
**Labels**: `phase-0`, `infrastructure`, `verification`

---

## Phase 1: Core Storage & Search (1 week)

### 1.1: Create Content Hashing Utility

**Description**: Implement SHA-256 hashing for memory content deduplication.

**Tasks**:
- Create `src/utils/hashing.js`
- Implement `generateHash(content)` function using crypto
- Add unit tests for hashing
- Document function behavior

**Acceptance Criteria**:
- [ ] Hash function returns consistent SHA-256 hex string
- [ ] Same content produces same hash
- [ ] Different content produces different hash
- [ ] Unit tests pass

**Effort**: 1 hour
**Dependencies**: None
**Labels**: `phase-1`, `core-storage`, `utility`

---

### 1.2: Create Memory Service

**Description**: Implement business logic for memory operations.

**Tasks**:
- Create `src/services/memoryService.js`
- Implement `addMemory()` function
- Implement content hash generation
- Implement duplicate detection
- Implement embedding generation integration
- Add error handling

**Acceptance Criteria**:
- [ ] `addMemory()` stores new memories
- [ ] Duplicate detection works via content hash
- [ ] Returns existing memory if duplicate found
- [ ] Access count incremented for duplicates
- [ ] Embeddings generated and stored
- [ ] Unit tests pass

**Effort**: 4 hours
**Dependencies**: Task 1.1 (Hashing), Task 0.9 (Embeddings)
**Labels**: `phase-1`, `core-storage`, `service`

---

### 1.3: Implement POST /api/v1/memories/add

**Description**: Create API endpoint to add new memories.

**Tasks**:
- Create `src/routes/memories.js`
- Implement POST /add route
- Add request validation
- Call memoryService.addMemory()
- Return proper response format
- Add error handling

**Acceptance Criteria**:
- [ ] POST /api/v1/memories/add endpoint responds
- [ ] Validates required 'content' field
- [ ] Returns 201 for new memory
- [ ] Returns 200 for duplicate memory
- [ ] Returns 400 for validation errors
- [ ] Returns 500 for server errors
- [ ] Response includes memory ID

**Effort**: 3 hours
**Dependencies**: Task 1.2 (Memory service)
**Labels**: `phase-1`, `core-storage`, `api`, `endpoint`

---

### 1.4: Implement Query Service

**Description**: Implement semantic search business logic.

**Tasks**:
- Add `queryMemories()` function to memoryService
- Generate query embedding
- Execute vector similarity search
- Update access tracking for results
- Record co-occurrences
- Add error handling

**Acceptance Criteria**:
- [ ] `queryMemories()` performs semantic search
- [ ] Returns memories ranked by similarity
- [ ] Respects similarity threshold
- [ ] Respects tier filter
- [ ] Respects result limit
- [ ] Updates access counts
- [ ] Records co-occurrences
- [ ] Unit tests pass

**Effort**: 5 hours
**Dependencies**: Task 1.2 (Memory service)
**Labels**: `phase-1`, `core-storage`, `service`, `search`

---

### 1.5: Implement POST /api/v1/memories/query

**Description**: Create API endpoint for semantic search.

**Tasks**:
- Add POST /query route to memories router
- Add request validation
- Call memoryService.queryMemories()
- Return proper response format
- Add error handling

**Acceptance Criteria**:
- [ ] POST /api/v1/memories/query endpoint responds
- [ ] Validates required 'query' field
- [ ] Validates optional parameters (limit, threshold)
- [ ] Returns results with similarity scores
- [ ] Returns query time in response
- [ ] Returns 400 for validation errors
- [ ] Returns 500 for server errors

**Effort**: 3 hours
**Dependencies**: Task 1.4 (Query service)
**Labels**: `phase-1`, `core-storage`, `api`, `endpoint`, `search`

---

### 1.6: Implement Bootstrap Service

**Description**: Implement initial context loading logic.

**Tasks**:
- Add `loadBootstrap()` function to memoryService
- Load all active tier memories
- Load top thread tier memories (70% of remaining)
- Load top stable tier memories (30% of remaining)
- Track bootstrap event
- Add error handling

**Acceptance Criteria**:
- [ ] `loadBootstrap()` loads proportional context
- [ ] Active tier: all memories loaded
- [ ] Thread tier: top by access count
- [ ] Stable tier: top by access count
- [ ] Returns structured response by tier
- [ ] Tracks bootstrap in meta_reflections
- [ ] Unit tests pass

**Effort**: 4 hours
**Dependencies**: Task 1.2 (Memory service)
**Labels**: `phase-1`, `core-storage`, `service`, `bootstrap`

---

### 1.7: Implement GET /api/v1/memories/bootstrap

**Description**: Create API endpoint for conversation bootstrap.

**Tasks**:
- Add GET /bootstrap route to memories router
- Add query parameter validation
- Call memoryService.loadBootstrap()
- Return proper response format
- Add error handling

**Acceptance Criteria**:
- [ ] GET /api/v1/memories/bootstrap endpoint responds
- [ ] Validates required 'conversationId' parameter
- [ ] Validates optional 'limit' parameter
- [ ] Returns memories grouped by tier
- [ ] Returns tier distribution
- [ ] Returns 400 for validation errors
- [ ] Returns 500 for server errors

**Effort**: 2 hours
**Dependencies**: Task 1.6 (Bootstrap service)
**Labels**: `phase-1`, `core-storage`, `api`, `endpoint`, `bootstrap`

---

### 1.8: Create Unit Tests for Memory Service

**Description**: Comprehensive unit tests for memory operations.

**Tasks**:
- Create `tests/unit/services/memoryService.test.js`
- Test addMemory() with new content
- Test addMemory() with duplicate content
- Test queryMemories() with various parameters
- Test loadBootstrap() with different limits
- Mock database and embedding service

**Acceptance Criteria**:
- [ ] All memory service functions tested
- [ ] Database calls mocked
- [ ] Embedding service mocked
- [ ] Edge cases covered
- [ ] All tests pass
- [ ] Coverage > 80% for memoryService

**Effort**: 4 hours
**Dependencies**: Tasks 1.2, 1.4, 1.6
**Labels**: `phase-1`, `core-storage`, `testing`, `unit-tests`

---

### 1.9: Create Integration Tests for Endpoints

**Description**: Integration tests for all Phase 1 endpoints.

**Tasks**:
- Create `tests/integration/routes/memories.test.js`
- Test POST /api/v1/memories/add success cases
- Test POST /api/v1/memories/add error cases
- Test POST /api/v1/memories/query success cases
- Test POST /api/v1/memories/query error cases
- Test GET /api/v1/memories/bootstrap success cases
- Use real database (test instance)

**Acceptance Criteria**:
- [ ] Integration tests for all endpoints
- [ ] Success cases tested
- [ ] Error cases tested
- [ ] Database state verified after operations
- [ ] All tests pass
- [ ] Tests can run in isolation

**Effort**: 5 hours
**Dependencies**: Tasks 1.3, 1.5, 1.7
**Labels**: `phase-1`, `core-storage`, `testing`, `integration-tests`

---

### 1.10: Create Example Client Usage

**Description**: Document example API usage with curl commands and Node.js client.

**Tasks**:
- Create `docs/API_EXAMPLES.md`
- Add curl examples for all endpoints
- Add Node.js fetch examples
- Add complete workflow example
- Test all examples against running API

**Acceptance Criteria**:
- [ ] Curl examples for add, query, bootstrap
- [ ] Node.js examples for all endpoints
- [ ] Complete conversation workflow documented
- [ ] All examples tested and working
- [ ] Error handling examples included

**Effort**: 3 hours
**Dependencies**: Tasks 1.3, 1.5, 1.7
**Labels**: `phase-1`, `core-storage`, `documentation`, `examples`

---

## Phase 2: Tier System (3 days)

### 2.1: Create Tier Service

**Description**: Implement tier management business logic.

**Tasks**:
- Create `src/services/tierService.js`
- Implement `updateMemoryTier()` function
- Implement `recordTierPromotion()` function
- Implement `checkPromotionThreshold()` function
- Add error handling

**Acceptance Criteria**:
- [ ] `updateMemoryTier()` updates tier and records promotion
- [ ] `recordTierPromotion()` writes to tier_promotions table
- [ ] `checkPromotionThreshold()` detects promotion conditions
- [ ] Unit tests pass

**Effort**: 3 hours
**Dependencies**: None
**Labels**: `phase-2`, `tier-system`, `service`

---

### 2.2: Implement Automatic Tier Promotion

**Description**: Add automatic promotion logic to query operations.

**Tasks**:
- Modify memoryService.queryMemories()
- Check access count after incrementing
- Promote to 'thread' at 3 accesses
- Promote to 'stable' at 10 accesses
- Record promotion with reason 'access_threshold'

**Acceptance Criteria**:
- [ ] Memories promoted to 'thread' at 3 accesses
- [ ] Memories promoted to 'stable' at 10 accesses
- [ ] Promotions recorded in tier_promotions table
- [ ] Promotion reason is 'access_threshold'
- [ ] Unit tests verify promotion logic

**Effort**: 3 hours
**Dependencies**: Task 2.1 (Tier service)
**Labels**: `phase-2`, `tier-system`, `automatic-promotion`

---

### 2.3: Implement POST /api/v1/memories/update-tier

**Description**: Create API endpoint for manual tier updates.

**Tasks**:
- Add POST /update-tier route to memories router
- Add request validation
- Call tierService.updateMemoryTier()
- Return proper response format
- Add error handling

**Acceptance Criteria**:
- [ ] POST /api/v1/memories/update-tier endpoint responds
- [ ] Validates required fields (memoryId, newTier)
- [ ] Validates tier value is valid
- [ ] Updates tier successfully
- [ ] Records promotion with reason 'manual'
- [ ] Returns 200 on success
- [ ] Returns 400 for validation errors
- [ ] Returns 404 for non-existent memory

**Effort**: 2 hours
**Dependencies**: Task 2.1 (Tier service)
**Labels**: `phase-2`, `tier-system`, `api`, `endpoint`

---

### 2.4: Implement Tier Decay Logic

**Description**: Create scheduled job to demote inactive memories.

**Tasks**:
- Create `src/jobs/tierDecay.js`
- Query memories inactive > 30 days in 'active' tier
- Query memories inactive > 90 days in 'thread' tier
- Demote to lower tier
- Record demotion with reason 'time_decay'
- Schedule job to run daily

**Acceptance Criteria**:
- [ ] Decay job identifies inactive memories
- [ ] Active→thread after 30 days inactivity
- [ ] Thread→stable after 90 days inactivity
- [ ] Demotions recorded in tier_promotions
- [ ] Job can be triggered manually for testing
- [ ] Job runs on schedule (daily)

**Effort**: 4 hours
**Dependencies**: Task 2.1 (Tier service)
**Labels**: `phase-2`, `tier-system`, `scheduled-job`, `decay`

---

### 2.5: Enhance Bootstrap with Tier Proportions

**Description**: Update bootstrap to load proportionally by tier.

**Tasks**:
- Modify memoryService.loadBootstrap()
- Calculate tier distribution dynamically
- Adjust thread/stable allocation based on available memories
- Add configuration for proportion ratios

**Acceptance Criteria**:
- [ ] Bootstrap loads all active memories (up to safety limit)
- [ ] Remaining limit allocated 70% thread, 30% stable
- [ ] Handles edge cases (not enough memories in tier)
- [ ] Returns tier distribution in response
- [ ] Unit tests verify proportion logic

**Effort**: 2 hours
**Dependencies**: Task 1.6 (Bootstrap service)
**Labels**: `phase-2`, `tier-system`, `bootstrap`, `enhancement`

---

### 2.6: Create Unit Tests for Tier Service

**Description**: Comprehensive unit tests for tier operations.

**Tasks**:
- Create `tests/unit/services/tierService.test.js`
- Test updateMemoryTier() with all transitions
- Test checkPromotionThreshold() logic
- Test recordTierPromotion()
- Mock database calls

**Acceptance Criteria**:
- [ ] All tier service functions tested
- [ ] Database calls mocked
- [ ] All tier transitions covered
- [ ] Edge cases tested
- [ ] All tests pass
- [ ] Coverage > 80% for tierService

**Effort**: 3 hours
**Dependencies**: Task 2.1 (Tier service)
**Labels**: `phase-2`, `tier-system`, `testing`, `unit-tests`

---

### 2.7: Create Integration Tests for Tier System

**Description**: Integration tests for tier functionality.

**Tasks**:
- Create `tests/integration/tierSystem.test.js`
- Test automatic promotion through queries
- Test manual tier updates via API
- Test tier decay logic
- Test bootstrap tier proportions
- Verify database state after operations

**Acceptance Criteria**:
- [ ] Automatic promotion tested end-to-end
- [ ] Manual tier update tested via API
- [ ] Decay job tested (manual trigger)
- [ ] Bootstrap proportions verified
- [ ] All tests pass
- [ ] Database state properly verified

**Effort**: 4 hours
**Dependencies**: Tasks 2.2, 2.3, 2.4, 2.5
**Labels**: `phase-2`, `tier-system`, `testing`, `integration-tests`

---

## Phase 3: Empirical Learning (4 days)

### 3.1: Create Association Service

**Description**: Implement association management business logic.

**Tasks**:
- Create `src/services/associationService.js`
- Implement `recordCoOccurrence()` function
- Implement `calculateStrength()` function
- Implement `discoverAssociations()` function
- Add error handling

**Acceptance Criteria**:
- [ ] `recordCoOccurrence()` creates/updates associations
- [ ] Ensures ordered pairs (memory_a_id < memory_b_id)
- [ ] `calculateStrength()` uses log formula
- [ ] `discoverAssociations()` queries associations
- [ ] Unit tests pass

**Effort**: 4 hours
**Dependencies**: None
**Labels**: `phase-3`, `empirical-learning`, `service`

---

### 3.2: Integrate Association Recording into Query

**Description**: Automatically record associations during query operations.

**Tasks**:
- Modify memoryService.queryMemories()
- After returning results, record all co-occurrences
- Create associations for all memory pairs in results
- Update existing associations if already present
- Add conversation context to associations

**Acceptance Criteria**:
- [ ] Associations created when memories appear together
- [ ] All pairs in query results recorded
- [ ] Existing associations updated (co-occurrence count++)
- [ ] Strength recalculated on update
- [ ] Conversation context tracked
- [ ] No performance degradation (async if needed)

**Effort**: 3 hours
**Dependencies**: Task 3.1 (Association service)
**Labels**: `phase-3`, `empirical-learning`, `integration`

---

### 3.3: Implement GET /api/v1/associations/discover

**Description**: Create API endpoint to discover associations.

**Tasks**:
- Create `src/routes/associations.js`
- Implement GET /discover route
- Add query parameter validation
- Call associationService.discoverAssociations()
- Return proper response format
- Add error handling

**Acceptance Criteria**:
- [ ] GET /api/v1/associations/discover endpoint responds
- [ ] Validates required 'memoryId' parameter
- [ ] Validates optional parameters (minStrength, limit)
- [ ] Returns associated memories with metadata
- [ ] Returns association strength and co-occurrence count
- [ ] Returns 400 for validation errors
- [ ] Returns 404 for non-existent memory
- [ ] Returns 500 for server errors

**Effort**: 3 hours
**Dependencies**: Task 3.1 (Association service)
**Labels**: `phase-3`, `empirical-learning`, `api`, `endpoint`

---

### 3.4: Add Hub Score Tracking

**Description**: Track connection counts per memory for hub detection.

**Tasks**:
- Add `hub_score` column to memories table (migration)
- Implement function to update hub scores
- Update hub score after association changes
- Add index on hub_score

**Acceptance Criteria**:
- [ ] `hub_score` column added to memories table
- [ ] Hub score calculated as total association count
- [ ] Updated when associations created/deleted
- [ ] Index created for efficient queries
- [ ] Migration script documented

**Effort**: 3 hours
**Dependencies**: Task 3.1 (Association service)
**Labels**: `phase-3`, `empirical-learning`, `database`, `migration`

---

### 3.5: Implement Association Strength Formula

**Description**: Properly calculate and normalize association strength.

**Tasks**:
- Implement `calculateStrength()` using formula: log(1 + count) / 10
- Ensure strength normalized to 0.0-1.0 range
- Update strength on every co-occurrence
- Add tests for formula correctness

**Acceptance Criteria**:
- [ ] Strength formula implemented correctly
- [ ] Strength increases with co-occurrence count
- [ ] Strength never exceeds 1.0
- [ ] Strength updated on every association change
- [ ] Unit tests verify formula behavior

**Effort**: 2 hours
**Dependencies**: Task 3.1 (Association service)
**Labels**: `phase-3`, `empirical-learning`, `algorithm`

---

### 3.6: Create Unit Tests for Association Service

**Description**: Comprehensive unit tests for association operations.

**Tasks**:
- Create `tests/unit/services/associationService.test.js`
- Test recordCoOccurrence() with new pair
- Test recordCoOccurrence() with existing pair
- Test calculateStrength() with various counts
- Test discoverAssociations() with filters
- Mock database calls

**Acceptance Criteria**:
- [ ] All association service functions tested
- [ ] Database calls mocked
- [ ] Strength formula verified
- [ ] Ordered pair constraint tested
- [ ] All tests pass
- [ ] Coverage > 80% for associationService

**Effort**: 3 hours
**Dependencies**: Task 3.1 (Association service)
**Labels**: `phase-3`, `empirical-learning`, `testing`, `unit-tests`

---

### 3.7: Create Integration Tests for Associations

**Description**: Integration tests for association discovery.

**Tasks**:
- Create `tests/integration/associations.test.js`
- Test association creation through queries
- Test GET /api/v1/associations/discover
- Test association strength increases
- Test bidirectional associations
- Verify database state

**Acceptance Criteria**:
- [ ] Associations created during queries
- [ ] Discover endpoint returns correct associations
- [ ] Strength increases with co-occurrence
- [ ] Bidirectional queries work (A→B and B→A)
- [ ] All tests pass
- [ ] Database properly verified

**Effort**: 4 hours
**Dependencies**: Tasks 3.2, 3.3
**Labels**: `phase-3`, `empirical-learning`, `testing`, `integration-tests`

---

### 3.8: Document Association System

**Description**: Create comprehensive documentation for association discovery.

**Tasks**:
- Create `docs/ASSOCIATIONS.md`
- Explain co-occurrence detection
- Document strength formula
- Provide usage examples
- Document best practices

**Acceptance Criteria**:
- [ ] Association concept explained clearly
- [ ] Strength formula documented with examples
- [ ] API usage examples provided
- [ ] Best practices for interpretation documented
- [ ] Limitations noted

**Effort**: 2 hours
**Dependencies**: Tasks 3.1, 3.2, 3.3
**Labels**: `phase-3`, `empirical-learning`, `documentation`

---

## Phase 4: Meta-Cognitive Tuning (3 days)

### 4.1: Create Meta-Reflection Service

**Description**: Implement system reflection business logic.

**Tasks**:
- Create `src/services/metaService.js`
- Implement `generateReflection()` function
- Implement `calculateFrictionMetrics()` function
- Implement `calculateRetrievalMetrics()` function
- Implement `detectHubs()` function
- Add error handling

**Acceptance Criteria**:
- [ ] `generateReflection()` creates meta_reflections record
- [ ] Friction metrics calculated correctly
- [ ] Retrieval metrics calculated correctly
- [ ] Hub detection identifies top connected memories
- [ ] Unit tests pass

**Effort**: 4 hours
**Dependencies**: None
**Labels**: `phase-4`, `meta-cognition`, `service`

---

### 4.2: Implement Friction Metrics Calculation

**Description**: Calculate friction metrics for conversation analysis.

**Tasks**:
- Implement context_load_time_ms tracking
- Calculate memories_loaded vs memories_accessed
- Calculate waste_ratio = (loaded - accessed) / loaded
- Categorize "feel" (smooth/sticky/rough)
- Add to meta-reflection

**Acceptance Criteria**:
- [ ] Load time tracked accurately
- [ ] Waste ratio calculated correctly
- [ ] Feel categorization logical (< 0.2 smooth, > 0.5 rough)
- [ ] All metrics included in reflection
- [ ] Unit tests verify calculations

**Effort**: 3 hours
**Dependencies**: Task 4.1 (Meta service)
**Labels**: `phase-4`, `meta-cognition`, `metrics`

---

### 4.3: Implement Retrieval Metrics Calculation

**Description**: Calculate retrieval performance metrics.

**Tasks**:
- Track queries_executed per conversation
- Calculate avg_results_returned
- Calculate hit_rate (relevant / total)
- Calculate avg_relevance_score
- Add to meta-reflection

**Acceptance Criteria**:
- [ ] Query count tracked
- [ ] Average results calculated
- [ ] Hit rate calculated correctly
- [ ] Average relevance score calculated
- [ ] All metrics included in reflection
- [ ] Unit tests verify calculations

**Effort**: 3 hours
**Dependencies**: Task 4.1 (Meta service)
**Labels**: `phase-4`, `meta-cognition`, `metrics`

---

### 4.4: Implement Hub Detection

**Description**: Identify most-connected memories for meta-analysis.

**Tasks**:
- Query memories with highest hub_score
- Return top 10 hubs
- Include connection count and content preview
- Add to meta-reflection

**Acceptance Criteria**:
- [ ] Top hubs identified by hub_score
- [ ] Limited to top 10
- [ ] Includes connection count
- [ ] Includes content preview (first 100 chars)
- [ ] Added to reflection metrics
- [ ] Unit tests pass

**Effort**: 2 hours
**Dependencies**: Task 4.1 (Meta service), Task 3.4 (Hub scores)
**Labels**: `phase-4`, `meta-cognition`, `hub-detection`

---

### 4.5: Implement Conversation-End Reflection Trigger

**Description**: Trigger meta-analysis when conversation ends.

**Tasks**:
- Create endpoint or mechanism to signal conversation end
- Gather metrics from conversation
- Call metaService.generateReflection()
- Store reflection in database
- Add error handling

**Acceptance Criteria**:
- [ ] Conversation end can be signaled
- [ ] Metrics gathered from conversation history
- [ ] Reflection generated with all metrics
- [ ] Stored in meta_reflections table
- [ ] Returns reflection ID
- [ ] Handles errors gracefully

**Effort**: 3 hours
**Dependencies**: Tasks 4.1, 4.2, 4.3, 4.4
**Labels**: `phase-4`, `meta-cognition`, `trigger`

---

### 4.6: Implement GET /api/v1/meta/reflection

**Description**: Create API endpoint to retrieve reflections.

**Tasks**:
- Create `src/routes/meta.js`
- Implement GET /reflection route
- Add query parameter validation
- Return most recent reflection for conversation
- Add filtering by reflection type
- Add error handling

**Acceptance Criteria**:
- [ ] GET /api/v1/meta/reflection endpoint responds
- [ ] Validates conversationId parameter
- [ ] Returns most recent reflection
- [ ] Includes all metrics, insights, recommendations
- [ ] Returns 404 if no reflection found
- [ ] Returns 400 for validation errors
- [ ] Returns 500 for server errors

**Effort**: 2 hours
**Dependencies**: Task 4.1 (Meta service)
**Labels**: `phase-4`, `meta-cognition`, `api`, `endpoint`

---

### 4.7: Generate Insights and Recommendations

**Description**: Implement logic to generate actionable insights.

**Tasks**:
- Analyze friction metrics for insights
- Analyze retrieval metrics for insights
- Analyze hub distribution for insights
- Generate actionable recommendations
- Add to meta-reflection

**Acceptance Criteria**:
- [ ] Insights generated based on metrics
- [ ] High waste ratio → insight about context loading
- [ ] High hit rate → insight about relevance
- [ ] Hub concentration → insight about network structure
- [ ] Recommendations specific and actionable
- [ ] Human-readable insight text

**Effort**: 4 hours
**Dependencies**: Tasks 4.2, 4.3, 4.4
**Labels**: `phase-4`, `meta-cognition`, `insights`

---

### 4.8: Create Unit Tests for Meta Service

**Description**: Comprehensive unit tests for meta-cognition.

**Tasks**:
- Create `tests/unit/services/metaService.test.js`
- Test generateReflection() with various metrics
- Test friction metric calculations
- Test retrieval metric calculations
- Test hub detection
- Test insight generation
- Mock database calls

**Acceptance Criteria**:
- [ ] All meta service functions tested
- [ ] Database calls mocked
- [ ] Metric calculations verified
- [ ] Insight generation tested
- [ ] All tests pass
- [ ] Coverage > 80% for metaService

**Effort**: 3 hours
**Dependencies**: Task 4.1 (Meta service)
**Labels**: `phase-4`, `meta-cognition`, `testing`, `unit-tests`

---

### 4.9: Create Integration Tests for Meta-Cognition

**Description**: Integration tests for reflection system.

**Tasks**:
- Create `tests/integration/meta.test.js`
- Test conversation-end reflection generation
- Test GET /api/v1/meta/reflection
- Verify metrics calculated correctly
- Verify insights generated
- Verify database state

**Acceptance Criteria**:
- [ ] Reflection generation tested end-to-end
- [ ] Metrics verified in database
- [ ] Insights present and meaningful
- [ ] Retrieve endpoint returns correct data
- [ ] All tests pass
- [ ] Database properly verified

**Effort**: 3 hours
**Dependencies**: Tasks 4.5, 4.6, 4.7
**Labels**: `phase-4`, `meta-cognition`, `testing`, `integration-tests`

---

## Phase 5: Open Source Preparation (2 days)

### 5.1: Create Comprehensive README

**Description**: Write complete README with setup, usage, and contribution info.

**Tasks**:
- Add project overview and vision
- Add architecture diagram (text-based)
- Add setup instructions (step-by-step)
- Add usage examples
- Add API documentation links
- Add troubleshooting section
- Add roadmap to V2

**Acceptance Criteria**:
- [ ] README covers all essential topics
- [ ] Setup instructions tested by fresh user
- [ ] Examples work and are clear
- [ ] Links to other documentation
- [ ] Markdown formatting correct
- [ ] Professional and welcoming tone

**Effort**: 4 hours
**Dependencies**: None
**Labels**: `phase-5`, `open-source`, `documentation`

---

### 5.2: Create CONTRIBUTING.md

**Description**: Write contribution guidelines for external contributors.

**Tasks**:
- Explain how to set up development environment
- Document code style and standards
- Explain pull request process
- List good first issues
- Add testing requirements
- Add documentation requirements

**Acceptance Criteria**:
- [ ] Contributing guidelines comprehensive
- [ ] Setup process documented
- [ ] PR requirements clear
- [ ] Code standards documented
- [ ] Testing requirements specified
- [ ] Welcoming to new contributors

**Effort**: 2 hours
**Dependencies**: None
**Labels**: `phase-5`, `open-source`, `documentation`

---

### 5.3: Create CODE_OF_CONDUCT.md

**Description**: Establish community standards and behavior expectations.

**Tasks**:
- Use Contributor Covenant template
- Customize for Anima project
- Define enforcement procedures
- Add contact information

**Acceptance Criteria**:
- [ ] Code of conduct present
- [ ] Based on Contributor Covenant
- [ ] Enforcement procedures clear
- [ ] Contact information provided

**Effort**: 1 hour
**Dependencies**: None
**Labels**: `phase-5`, `open-source`, `documentation`

---

### 5.4: Add LICENSE File

**Description**: Choose and add appropriate open source license.

**Tasks**:
- Decide on license (MIT or Apache 2.0 recommended)
- Add LICENSE file
- Add license badge to README
- Add license headers to source files (optional)

**Acceptance Criteria**:
- [ ] LICENSE file present
- [ ] License chosen (MIT or Apache 2.0)
- [ ] Copyright holder specified
- [ ] README includes license badge

**Effort**: 1 hour
**Dependencies**: None
**Labels**: `phase-5`, `open-source`, `legal`

---

### 5.5: Create ARCHITECTURE.md

**Description**: Document system architecture and design decisions.

**Tasks**:
- Explain dual-layer vision (V1 + V2)
- Document V1 architecture
- Explain database schema design
- Explain tier system design
- Explain association discovery
- Add diagrams (text-based or mermaid)

**Acceptance Criteria**:
- [ ] Architecture well-explained
- [ ] Design decisions documented
- [ ] Diagrams included
- [ ] V2 vision referenced
- [ ] Technical but accessible

**Effort**: 3 hours
**Dependencies**: None
**Labels**: `phase-5`, `open-source`, `documentation`

---

### 5.6: Set Up ESLint and Prettier

**Description**: Configure code quality and formatting tools.

**Tasks**:
- Install ESLint and Prettier
- Create `.eslintrc.js` configuration
- Create `.prettierrc` configuration
- Add npm scripts for linting and formatting
- Fix all existing linting errors
- Add pre-commit hook (optional)

**Acceptance Criteria**:
- [ ] ESLint configured
- [ ] Prettier configured
- [ ] All code passes linting
- [ ] All code properly formatted
- [ ] npm run lint works
- [ ] npm run format works

**Effort**: 2 hours
**Dependencies**: None
**Labels**: `phase-5`, `open-source`, `code-quality`

---

### 5.7: Achieve 70%+ Test Coverage

**Description**: Ensure comprehensive test coverage across codebase.

**Tasks**:
- Install coverage tool (jest --coverage)
- Run coverage report
- Identify uncovered areas
- Add missing tests
- Achieve 70%+ overall coverage

**Acceptance Criteria**:
- [ ] Coverage tool configured
- [ ] Coverage report generates
- [ ] Overall coverage > 70%
- [ ] Critical paths 100% covered
- [ ] npm run test:coverage works

**Effort**: 4 hours
**Dependencies**: All unit and integration tests
**Labels**: `phase-5`, `open-source`, `testing`, `coverage`

---

### 5.8: Create GitHub Issue Templates

**Description**: Set up templates for bug reports and feature requests.

**Tasks**:
- Create `.github/ISSUE_TEMPLATE/bug_report.md`
- Create `.github/ISSUE_TEMPLATE/feature_request.md`
- Create `.github/ISSUE_TEMPLATE/question.md`
- Test templates on GitHub

**Acceptance Criteria**:
- [ ] Bug report template created
- [ ] Feature request template created
- [ ] Question template created
- [ ] Templates appear in GitHub UI
- [ ] Templates guide users effectively

**Effort**: 2 hours
**Dependencies**: None
**Labels**: `phase-5`, `open-source`, `github`

---

### 5.9: Create Pull Request Template

**Description**: Set up template for pull requests.

**Tasks**:
- Create `.github/PULL_REQUEST_TEMPLATE.md`
- Include checklist for contributors
- Link to contributing guidelines
- Test template on GitHub

**Acceptance Criteria**:
- [ ] PR template created
- [ ] Checklist includes testing, docs, linting
- [ ] Links to CONTRIBUTING.md
- [ ] Template appears in GitHub UI

**Effort**: 1 hour
**Dependencies**: None
**Labels**: `phase-5`, `open-source`, `github`

---

### 5.10: Create Initial GitHub Issues

**Description**: Import tasks from this document as GitHub issues.

**Tasks**:
- Create issues for Phase 0 tasks
- Create issues for Phase 1 tasks
- Create issues for Phase 2 tasks
- Create issues for Phase 3 tasks
- Create issues for Phase 4 tasks
- Label issues appropriately
- Assign milestones

**Acceptance Criteria**:
- [ ] All tasks from TASKS.md created as issues
- [ ] Issues properly labeled
- [ ] Issues assigned to milestones (Phase 0-5)
- [ ] Issues have clear titles and descriptions
- [ ] Dependencies noted in issue descriptions

**Effort**: 3 hours
**Dependencies**: None
**Labels**: `phase-5`, `open-source`, `github`, `project-management`

---

### 5.11: Set Up GitHub Project Board

**Description**: Create project board for tracking progress.

**Tasks**:
- Create GitHub Projects board
- Add columns: Backlog, Ready, In Progress, Review, Done
- Add all issues to board
- Configure automation rules
- Document workflow

**Acceptance Criteria**:
- [ ] Project board created
- [ ] Columns configured
- [ ] All issues added to board
- [ ] Automation rules set up
- [ ] Workflow documented in README

**Effort**: 2 hours
**Dependencies**: Task 5.10 (GitHub issues)
**Labels**: `phase-5`, `open-source`, `github`, `project-management`

---

### 5.12: Write End-to-End Documentation

**Description**: Create complete workflow documentation from setup to usage.

**Tasks**:
- Create `docs/GETTING_STARTED.md`
- Walk through complete setup
- Walk through example conversation
- Document all API endpoints
- Add troubleshooting tips

**Acceptance Criteria**:
- [ ] Getting started guide complete
- [ ] Fresh user can follow and succeed
- [ ] Example conversation documented
- [ ] All endpoints documented
- [ ] Common issues addressed

**Effort**: 3 hours
**Dependencies**: All previous phases
**Labels**: `phase-5`, `open-source`, `documentation`

---

## Summary

**Total Tasks**: 72 tasks across 5 phases

**Phase Breakdown**:
- Phase 0 (Infrastructure): 10 tasks, ~1 week
- Phase 1 (Core Storage): 10 tasks, ~1 week
- Phase 2 (Tier System): 7 tasks, ~3 days
- Phase 3 (Empirical Learning): 8 tasks, ~4 days
- Phase 4 (Meta-Cognition): 9 tasks, ~3 days
- Phase 5 (Open Source): 12 tasks, ~2 days

**Labels Used**:
- Phase labels: `phase-0` through `phase-5`
- Component labels: `infrastructure`, `api`, `database`, `service`, `testing`, `documentation`
- Type labels: `endpoint`, `unit-tests`, `integration-tests`, `configuration`, `enhancement`
- Special labels: `good-first-issue`, `help-wanted`, `bug`, `feature`

**Milestone Strategy**:
- Milestone 1: Phase 0 complete (Infrastructure ready)
- Milestone 2: Phase 1 complete (Core functionality working)
- Milestone 3: Phase 2 complete (Tier system operational)
- Milestone 4: Phase 3 complete (Associations discovered)
- Milestone 5: Phase 4 complete (Meta-cognition implemented)
- Milestone 6: Phase 5 complete (Open source ready)

**GitHub Import Note**:
This task list can be imported into GitHub Issues using GitHub CLI or manually. Each task should become an issue with:
- Title from task heading
- Description from task body
- Labels as specified
- Assigned to appropriate milestone
- Dependencies noted in issue description

---

This task breakdown provides actionable, committable work items for building Anima V1. Each task is scoped for independent completion and has clear acceptance criteria. Ready for GitHub import and collaborative development.
