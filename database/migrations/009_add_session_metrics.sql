-- ============================================================================
-- MIGRATION: Add session_metrics column to meta_reflections
-- ============================================================================
-- Purpose: Store raw session metrics alongside processed metrics
-- Date: 2026-01-13
-- ============================================================================

-- Add session_metrics column to meta_reflections
ALTER TABLE meta_reflections
ADD COLUMN IF NOT EXISTS session_metrics JSONB;

-- Add comment explaining the column
COMMENT ON COLUMN meta_reflections.session_metrics IS 'Raw session metrics collected during conversation (memories_loaded, memories_accessed, etc.)';

-- Verification query
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'meta_reflections'
  AND column_name = 'session_metrics';
