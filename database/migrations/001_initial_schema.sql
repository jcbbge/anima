-- Anima Core Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  embedding vector(768) NOT NULL,
  tier TEXT NOT NULL DEFAULT 'active' CHECK (tier IN ('active', 'thread', 'stable', 'network')),
  tier_last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accessed_in_conversation_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
  category TEXT,
  tags TEXT[],
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memories_embedding ON memories 
  USING hnsw (embedding vector_cosine_ops) 
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_memories_tier ON memories(tier);

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
