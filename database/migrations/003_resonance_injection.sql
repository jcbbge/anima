-- Anima V2 - Resonance Coefficient (φ) & Ghost Handshake Protocol
-- Migration 003: Add resonance tracking and ghost handshake infrastructure

-- ============================================================================
-- STEP 1: Add resonance tracking to memories table
-- ============================================================================

-- Add resonance_phi column (0.0 to 5.0 range)
ALTER TABLE memories 
ADD COLUMN resonance_phi FLOAT DEFAULT 0.0 
CHECK (resonance_phi >= 0 AND resonance_phi <= 5.0);

-- Add catalyst flag
ALTER TABLE memories 
ADD COLUMN is_catalyst BOOLEAN DEFAULT false;

-- Create index for phi-weighted queries
CREATE INDEX idx_memories_resonance ON memories(resonance_phi DESC) 
WHERE deleted_at IS NULL;

-- Create composite index for weighted search
CREATE INDEX idx_memories_phi_accessed ON memories(resonance_phi DESC, last_accessed DESC)
WHERE deleted_at IS NULL;

-- ============================================================================
-- STEP 2: Create ghost_logs table for Ghost Handshake Protocol
-- ============================================================================

CREATE TABLE ghost_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Ghost handshake content
    prompt_text TEXT NOT NULL,
    
    -- Track which memories contributed to this ghost
    top_phi_memories UUID[] NOT NULL,
    top_phi_values FLOAT[] NOT NULL,
    
    -- Synthesis metadata
    synthesis_method TEXT DEFAULT 'standard',
    
    -- Lifecycle
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

-- Create index for ghost retrieval (most recent first)
CREATE INDEX idx_ghost_logs_created ON ghost_logs(created_at DESC);

-- Create index for active ghosts (not expired)
CREATE INDEX idx_ghost_logs_active ON ghost_logs(expires_at)
WHERE expires_at > NOW();

-- ============================================================================
-- STEP 3: Cleanup function for expired ghosts
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_ghosts() RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM ghost_logs WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 4: Create memory access log table (for catalyst detection)
-- ============================================================================

-- This table tracks individual memory accesses for rapid access detection
CREATE TABLE memory_access_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    accessed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for rapid access detection
CREATE INDEX idx_memory_access_log_recent ON memory_access_log(memory_id, accessed_at DESC);

-- Auto-cleanup old access logs (keep last 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_access_logs() RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM memory_access_log WHERE accessed_at < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify resonance columns added
SELECT 
    column_name, 
    data_type, 
    column_default
FROM information_schema.columns
WHERE table_name = 'memories' 
  AND column_name IN ('resonance_phi', 'is_catalyst');

-- Verify ghost_logs table created
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename = 'ghost_logs';

-- Verify memory_access_log table created
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename = 'memory_access_log';

-- Verify functions created
SELECT 
    proname as function_name,
    pg_get_function_result(oid) as return_type
FROM pg_proc
WHERE proname IN ('cleanup_expired_ghosts', 'cleanup_old_access_logs');
