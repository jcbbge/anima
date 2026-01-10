-- Anima V2 - Add metadata field for dream synthesis
-- Migration 004: Add JSONB metadata column to memories table

-- ============================================================================
-- STEP 1: Add metadata column (if it doesn't exist)
-- ============================================================================

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'memories' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE memories ADD COLUMN metadata JSONB DEFAULT NULL;
    
    -- Create GIN index for metadata queries
    CREATE INDEX idx_memories_metadata ON memories USING gin(metadata)
    WHERE deleted_at IS NULL AND metadata IS NOT NULL;
    
    RAISE NOTICE 'Added metadata column to memories table';
  ELSE
    RAISE NOTICE 'metadata column already exists';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 
    column_name, 
    data_type, 
    column_default
FROM information_schema.columns
WHERE table_name = 'memories' 
  AND column_name = 'metadata';
