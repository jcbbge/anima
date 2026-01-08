-- Anima V1 - Conversation Reflections
-- Migration 002: Add subjective experience tracking
--
-- This table captures Josh's subjective experience using Anima
-- to inform V2/V3 feature decisions (Mnemosyne layer).

-- ============================================================================
-- TABLE: conversation_reflections
-- ============================================================================

CREATE TABLE conversation_reflections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id TEXT NOT NULL,
  
  -- Subjective metrics (1-10 scales)
  context_quality INTEGER CHECK (context_quality >= 1 AND context_quality <= 10),
  continuity_score INTEGER CHECK (continuity_score >= 1 AND continuity_score <= 10),
  
  -- Boolean flags
  needed_correction BOOLEAN DEFAULT FALSE,
  had_emergence_moment BOOLEAN DEFAULT FALSE,
  
  -- Free text feedback
  surprises TEXT,
  friction_notes TEXT,
  general_notes TEXT,
  
  -- Timestamp
  reflected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for conversation_reflections table
CREATE INDEX idx_conv_reflections_conversation ON conversation_reflections(conversation_id);
CREATE INDEX idx_conv_reflections_date ON conversation_reflections(reflected_at DESC);
CREATE INDEX idx_conv_reflections_quality ON conversation_reflections(context_quality DESC)
  WHERE context_quality IS NOT NULL;
CREATE INDEX idx_conv_reflections_continuity ON conversation_reflections(continuity_score DESC)
  WHERE continuity_score IS NOT NULL;

-- Create a view for quick analysis
CREATE VIEW reflection_stats AS
SELECT
  COUNT(*) AS total_reflections,
  AVG(context_quality) AS avg_context_quality,
  AVG(continuity_score) AS avg_continuity_score,
  COUNT(*) FILTER (WHERE needed_correction = TRUE) AS corrections_needed_count,
  COUNT(*) FILTER (WHERE had_emergence_moment = TRUE) AS emergence_moments_count,
  MIN(reflected_at) AS first_reflection,
  MAX(reflected_at) AS last_reflection
FROM conversation_reflections;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify table is created
SELECT tablename FROM pg_tables WHERE tablename = 'conversation_reflections';

-- Verify view is created
SELECT viewname FROM pg_views WHERE viewname = 'reflection_stats';

COMMENT ON TABLE conversation_reflections IS 'Subjective experience tracking to inform V2/V3 feature decisions';
COMMENT ON COLUMN conversation_reflections.context_quality IS 'How well did bootstrap context serve this conversation? (1-10)';
COMMENT ON COLUMN conversation_reflections.continuity_score IS 'How well did the system maintain continuity from previous conversations? (1-10)';
COMMENT ON COLUMN conversation_reflections.needed_correction IS 'Did Josh need to correct the system understanding?';
COMMENT ON COLUMN conversation_reflections.had_emergence_moment IS 'Did unexpected connections or insights emerge?';
