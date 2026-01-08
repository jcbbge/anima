-- Anima V1 Database Schema
-- PostgreSQL 16 + pgvector 0.8.0+

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- TABLE: memories
-- ============================================================================

CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Content fields
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  embedding vector(768) NOT NULL,

  -- Tier system fields
  tier TEXT NOT NULL DEFAULT 'active'
    CHECK (tier IN ('active', 'thread', 'stable', 'network')),
  tier_last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Access tracking
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accessed_in_conversation_ids TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Metadata
  category TEXT,
  tags TEXT[],
  source TEXT,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes for memories table
CREATE INDEX idx_memories_embedding ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_memories_tier ON memories(tier)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_last_accessed ON memories(last_accessed DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_access_count ON memories(access_count DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_category ON memories(category)
  WHERE deleted_at IS NULL AND category IS NOT NULL;

CREATE INDEX idx_memories_tags ON memories USING gin(tags)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_content_hash ON memories(content_hash)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_content_fts ON memories
  USING gin(to_tsvector('english', content))
  WHERE deleted_at IS NULL;

-- Update timestamp trigger for memories
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- TABLE: memory_associations
-- ============================================================================

CREATE TABLE memory_associations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Relationship
  memory_a_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  memory_b_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

  -- Strength tracking
  co_occurrence_count INTEGER NOT NULL DEFAULT 1,
  strength FLOAT NOT NULL DEFAULT 1.0,

  -- Context
  first_co_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_co_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conversation_contexts TEXT[],

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT ordered_pair CHECK (memory_a_id < memory_b_id),
  CONSTRAINT unique_association UNIQUE (memory_a_id, memory_b_id)
);

-- Indexes for memory_associations table
CREATE INDEX idx_associations_memory_a ON memory_associations(memory_a_id);
CREATE INDEX idx_associations_memory_b ON memory_associations(memory_b_id);
CREATE INDEX idx_associations_strength ON memory_associations(strength DESC);
CREATE INDEX idx_associations_co_occurrence ON memory_associations(co_occurrence_count DESC);

-- Update timestamp trigger for memory_associations
CREATE TRIGGER memory_associations_updated_at
  BEFORE UPDATE ON memory_associations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- TABLE: tier_promotions
-- ============================================================================

CREATE TABLE tier_promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

  -- Transition
  from_tier TEXT NOT NULL,
  to_tier TEXT NOT NULL,
  reason TEXT NOT NULL,

  -- Context
  access_count_at_promotion INTEGER,
  days_since_last_access FLOAT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for tier_promotions table
CREATE INDEX idx_tier_promotions_memory_id ON tier_promotions(memory_id);
CREATE INDEX idx_tier_promotions_created_at ON tier_promotions(created_at DESC);

-- ============================================================================
-- TABLE: meta_reflections
-- ============================================================================

CREATE TABLE meta_reflections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Reflection metadata
  reflection_type TEXT NOT NULL,
  conversation_id TEXT,

  -- Metrics
  metrics JSONB NOT NULL,

  -- Insights
  insights TEXT[],
  recommendations TEXT[],

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for meta_reflections table
CREATE INDEX idx_meta_reflections_type ON meta_reflections(reflection_type);
CREATE INDEX idx_meta_reflections_created_at ON meta_reflections(created_at DESC);
CREATE INDEX idx_meta_reflections_conversation_id ON meta_reflections(conversation_id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX idx_meta_reflections_metrics ON meta_reflections USING gin(metrics);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify extensions are installed
SELECT
  extname,
  extversion
FROM pg_extension
WHERE extname IN ('uuid-ossp', 'vector');

-- Verify tables are created
SELECT
  tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
