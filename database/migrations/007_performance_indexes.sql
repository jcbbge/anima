-- Migration: Add performance indexes for tier queries and vector search

BEGIN;

-- Index 1: Optimize tier-based queries (bootstrap, promotion checks)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_tier_phi_accessed
ON memories(tier, resonance_phi DESC, last_accessed DESC)
WHERE deleted_at IS NULL;

-- Index 2: Optimize content hash lookups (deduplication)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_content_hash
ON memories(content_hash)
WHERE deleted_at IS NULL;

-- Index 3: Re-create HNSW index with optimized parameters
-- m = 16: More connections = better recall
-- ef_construction = 64: Higher quality index
DROP INDEX IF EXISTS memories_embedding_idx;
CREATE INDEX memories_embedding_idx ON memories
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Update statistics for query planner
ANALYZE memories;
ANALYZE memory_associations;

COMMIT;
