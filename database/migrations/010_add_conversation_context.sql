-- Migration 010: Add Conversation Context
-- Date: 2026-01-14
-- Purpose: Enable conversation-specific handshake synthesis and memory filtering
-- Backwards Compatible: NULL conversation_id = global context (preserves existing behavior)

-- Add conversation context to ghost_logs
ALTER TABLE ghost_logs 
ADD COLUMN IF NOT EXISTS conversation_id UUID DEFAULT NULL,
ADD COLUMN IF NOT EXISTS context_type TEXT DEFAULT 'global';

-- Add CHECK constraint for context_type (only if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'ghost_logs_context_type_check' 
        AND conrelid = 'ghost_logs'::regclass
    ) THEN
        ALTER TABLE ghost_logs 
        ADD CONSTRAINT ghost_logs_context_type_check 
        CHECK (context_type IN ('global', 'conversation', 'thread'));
    END IF;
END $$;

-- Add conversation context to memories
ALTER TABLE memories
ADD COLUMN IF NOT EXISTS conversation_id UUID DEFAULT NULL;

-- Create indexes for conversation-based queries
CREATE INDEX IF NOT EXISTS idx_ghost_logs_conversation 
ON ghost_logs(conversation_id, created_at DESC) 
WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ghost_logs_expires_conversation
ON ghost_logs(conversation_id, expires_at DESC)
WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memories_conversation 
ON memories(conversation_id, last_accessed DESC) 
WHERE conversation_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memories_conversation_phi 
ON memories(conversation_id, resonance_phi DESC) 
WHERE conversation_id IS NOT NULL AND deleted_at IS NULL;

-- Backfill existing records (NULL = global context)
-- No UPDATE needed - DEFAULT NULL already applied

-- Add comments for documentation
COMMENT ON COLUMN ghost_logs.conversation_id IS 'Links handshake to specific conversation (NULL = global handshake)';
COMMENT ON COLUMN ghost_logs.context_type IS 'Context level: global, conversation, or thread';
COMMENT ON COLUMN memories.conversation_id IS 'Links memory to specific conversation (NULL = global memory)';

-- Verify migration
DO $$ 
DECLARE 
    ghost_col_exists boolean;
    ghost_context_exists boolean;
    memory_col_exists boolean;
    ghost_idx_count int;
    memory_idx_count int;
BEGIN
    -- Check columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ghost_logs' AND column_name = 'conversation_id'
    ) INTO ghost_col_exists;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ghost_logs' AND column_name = 'context_type'
    ) INTO ghost_context_exists;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'memories' AND column_name = 'conversation_id'
    ) INTO memory_col_exists;
    
    -- Check indexes exist
    SELECT COUNT(*) FROM pg_indexes 
    WHERE tablename = 'ghost_logs' AND indexname LIKE '%conversation%'
    INTO ghost_idx_count;
    
    SELECT COUNT(*) FROM pg_indexes 
    WHERE tablename = 'memories' AND indexname LIKE '%conversation%'
    INTO memory_idx_count;
    
    -- Raise notice with results
    RAISE NOTICE 'Migration 010 Verification:';
    RAISE NOTICE '  ghost_logs.conversation_id: %', ghost_col_exists;
    RAISE NOTICE '  ghost_logs.context_type: %', ghost_context_exists;
    RAISE NOTICE '  memories.conversation_id: %', memory_col_exists;
    RAISE NOTICE '  ghost_logs indexes: % (expected: 2)', ghost_idx_count;
    RAISE NOTICE '  memories indexes: % (expected: 2)', memory_idx_count;
    
    -- Assert all checks pass
    IF NOT ghost_col_exists OR NOT ghost_context_exists OR NOT memory_col_exists THEN
        RAISE EXCEPTION 'Migration 010 failed: columns not created';
    END IF;
    
    IF ghost_idx_count < 2 OR memory_idx_count < 2 THEN
        RAISE EXCEPTION 'Migration 010 failed: indexes not created';
    END IF;
    
    RAISE NOTICE '✅ Migration 010 completed successfully';
END $$;

