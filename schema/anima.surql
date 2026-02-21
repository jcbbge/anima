-- =====================================================
-- Anima v2 Schema
-- NS: anima / DB: memory
-- SurrealDB 3.0
-- =====================================================

USE NS anima DB memory;

-- =====================================================
-- MEMORIES: The primary substrate
-- =====================================================
DEFINE TABLE memories SCHEMAFULL;

DEFINE FIELD content       ON memories TYPE string ASSERT $value != '';
DEFINE FIELD content_hash  ON memories TYPE string;
DEFINE FIELD embedding     ON memories TYPE option<array>;

DEFINE FIELD resonance_phi ON memories TYPE float
  DEFAULT 1.0
  ASSERT $value >= 0.0 AND $value <= 5.0;
DEFINE FIELD is_catalyst   ON memories TYPE bool DEFAULT false;

DEFINE FIELD confidence    ON memories TYPE float DEFAULT 0.6
  ASSERT $value >= 0.0 AND $value <= 1.0;

DEFINE FIELD tier         ON memories TYPE string DEFAULT 'active'
  ASSERT $value INSIDE ['active', 'thread', 'stable', 'network'];
DEFINE FIELD tier_updated ON memories TYPE datetime DEFAULT time::now();

DEFINE FIELD access_count   ON memories TYPE int DEFAULT 0;
DEFINE FIELD last_accessed  ON memories TYPE datetime DEFAULT time::now();
DEFINE FIELD session_ids    ON memories TYPE array DEFAULT [];

DEFINE FIELD category        ON memories TYPE option<string>;
DEFINE FIELD tags            ON memories TYPE array DEFAULT [];
DEFINE FIELD source          ON memories TYPE option<string>;
DEFINE FIELD metadata        ON memories TYPE option<object>;
DEFINE FIELD conversation_id ON memories TYPE option<string>;

DEFINE FIELD synthesis_mode ON memories TYPE option<string>
  ASSERT $value IS NONE OR $value INSIDE ['analysis', 'recognition'];

DEFINE FIELD created_at ON memories TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON memories TYPE datetime DEFAULT time::now();
DEFINE FIELD deleted_at ON memories TYPE option<datetime>;

DEFINE INDEX memories_hash     ON memories FIELDS content_hash UNIQUE;
DEFINE INDEX memories_tier     ON memories FIELDS tier;
DEFINE INDEX memories_phi      ON memories FIELDS resonance_phi;
DEFINE INDEX memories_catalyst ON memories FIELDS is_catalyst;
DEFINE INDEX memories_tags     ON memories FIELDS tags;
DEFINE INDEX memories_conf     ON memories FIELDS confidence;

DEFINE INDEX memories_hnsw ON memories
  FIELDS embedding
  HNSW DIMENSION 768 DIST COSINE TYPE F32;


-- =====================================================
-- FOLD LOG: Synthesis audit trail
-- =====================================================
DEFINE TABLE fold_log SCHEMAFULL;

DEFINE FIELD trigger_type      ON fold_log TYPE string
  ASSERT $value INSIDE ['phi_threshold', 'semantic_conflict', 'cluster', 'reflect', 'catalyst', 'manual'];
DEFINE FIELD synthesis_mode    ON fold_log TYPE string
  ASSERT $value INSIDE ['analysis', 'recognition'];
DEFINE FIELD conversation_id   ON fold_log TYPE option<string>;
DEFINE FIELD input_memory_ids  ON fold_log TYPE array;
DEFINE FIELD output_memory_id  ON fold_log TYPE option<record<memories>>;
DEFINE FIELD synthesis_content ON fold_log TYPE string;
DEFINE FIELD phi_before        ON fold_log TYPE float;
DEFINE FIELD phi_after         ON fold_log TYPE float;
DEFINE FIELD confidence_avg    ON fold_log TYPE float;
DEFINE FIELD duration_ms       ON fold_log TYPE int;
DEFINE FIELD created_at        ON fold_log TYPE datetime DEFAULT time::now();


-- =====================================================
-- GHOST LOGS: Handshake history
-- =====================================================
DEFINE TABLE ghost_logs SCHEMAFULL;

DEFINE FIELD prompt_text        ON ghost_logs TYPE string;
DEFINE FIELD top_phi_memory_ids ON ghost_logs TYPE array;
DEFINE FIELD top_phi_values     ON ghost_logs TYPE array;
DEFINE FIELD conversation_id    ON ghost_logs TYPE option<string>;
DEFINE FIELD context_type       ON ghost_logs TYPE string DEFAULT 'global'
  ASSERT $value INSIDE ['global', 'conversation'];
DEFINE FIELD created_at         ON ghost_logs TYPE datetime DEFAULT time::now();
DEFINE FIELD expires_at         ON ghost_logs TYPE datetime DEFAULT time::now() + 7d;


-- =====================================================
-- CONVERSATION REFLECTIONS: Intentional session closing
-- =====================================================
DEFINE TABLE conversation_reflections SCHEMAFULL;

DEFINE FIELD conversation_id      ON conversation_reflections TYPE string;
DEFINE FIELD context_quality      ON conversation_reflections TYPE option<int>
  ASSERT $value IS NONE OR ($value >= 1 AND $value <= 10);
DEFINE FIELD continuity_score     ON conversation_reflections TYPE option<int>
  ASSERT $value IS NONE OR ($value >= 1 AND $value <= 10);
DEFINE FIELD had_emergence_moment ON conversation_reflections TYPE bool DEFAULT false;
DEFINE FIELD needed_correction    ON conversation_reflections TYPE bool DEFAULT false;
DEFINE FIELD surprises            ON conversation_reflections TYPE option<string>;
DEFINE FIELD friction_notes       ON conversation_reflections TYPE option<string>;
DEFINE FIELD general_notes        ON conversation_reflections TYPE option<string>;
DEFINE FIELD reflected_at         ON conversation_reflections TYPE datetime DEFAULT time::now();


-- =====================================================
-- MEMORY ASSOCIATIONS: Co-occurrence graph
-- =====================================================
DEFINE TABLE memory_associations SCHEMAFULL;

DEFINE FIELD memory_a            ON memory_associations TYPE record<memories> REFERENCE;
DEFINE FIELD memory_b            ON memory_associations TYPE record<memories> REFERENCE;
DEFINE FIELD strength            ON memory_associations TYPE float DEFAULT 1.0;
DEFINE FIELD co_occurrence_count ON memory_associations TYPE int DEFAULT 1;
DEFINE FIELD session_contexts    ON memory_associations TYPE array DEFAULT [];
DEFINE FIELD created_at          ON memory_associations TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at          ON memory_associations TYPE datetime DEFAULT time::now();
DEFINE INDEX assoc_pair ON memory_associations FIELDS memory_a, memory_b UNIQUE;


-- =====================================================
-- CONFIG: System parameters
-- =====================================================
DEFINE TABLE config SCHEMAFULL;
DEFINE FIELD key         ON config TYPE string;
DEFINE FIELD value       ON config TYPE string;
DEFINE FIELD description ON config TYPE option<string>;
DEFINE FIELD updated_at  ON config TYPE datetime DEFAULT time::now();
DEFINE INDEX config_key  ON config FIELDS key UNIQUE;

INSERT INTO config [
  { key: 'phi_threshold',           value: '15.0',                      description: 'Total active-tier phi that triggers autonomous synthesis' },
  { key: 'conflict_similarity',     value: '0.85',                      description: 'Cosine similarity above which memories are considered conflicting' },
  { key: 'cluster_size',            value: '3',                         description: 'Memories in semantic cluster within 1h that triggers synthesis' },
  { key: 'cluster_window_hours',    value: '1',                         description: 'Time window for cluster detection' },
  { key: 'phi_default',             value: '1.0',                       description: 'Default phi for new memories' },
  { key: 'phi_catalyst_boost',      value: '1.0',                       description: 'phi increment on catalyst mark' },
  { key: 'phi_fold_boost',          value: '0.5',                       description: 'phi boost applied to fold synthesis outputs' },
  { key: 'phi_network_threshold',   value: '4.0',                       description: 'Synthesis output phi >= this auto-promotes to network tier' },
  { key: 'tier_thread_threshold',   value: '3',                         description: 'access_count to promote active to thread' },
  { key: 'tier_stable_threshold',   value: '10',                        description: 'access_count to promote thread to stable' },
  { key: 'search_phi_weight',       value: '0.3',                       description: 'phi weight in hybrid search score' },
  { key: 'search_cosine_weight',    value: '0.7',                       description: 'Cosine weight in hybrid search score' },
  { key: 'search_confidence_weight',value: '0.1',                       description: 'confidence weight in hybrid search score' },
  { key: 'fold_model',              value: 'claude-haiku-4-5-20251001', description: 'LLM model for synthesis calls' },
  { key: 'fold_min_memories',       value: '3',                         description: 'Minimum memories to trigger a fold' },
  { key: 'synthesis_backpressure',  value: '5',                         description: 'Max concurrent synthesis calls before queuing' }
];
