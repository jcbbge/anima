-- =====================================================
-- Anima v2 Schema
-- NS: anima / DB: memory
-- SurrealDB 3.0
--
-- Changelog:
--   2026-03-15  Layer 2 (origin attribution) + v2 extensions:
--               attention_vector, deepening mode, tension_fields,
--               curiosity_threads, expressions, cross-refs
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
  ASSERT $value IS NONE OR $value INSIDE ['analysis', 'recognition', 'deepening'];

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
  ASSERT $value INSIDE ['analysis', 'recognition', 'deepening'];
DEFINE FIELD synthesis_model   ON fold_log TYPE option<string>;
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
-- FOLD_CONFIG: System parameters (renamed to avoid 'config' reserved keyword)
-- =====================================================
DEFINE TABLE fold_config SCHEMAFULL;
DEFINE FIELD key         ON fold_config TYPE string;
DEFINE FIELD value       ON fold_config TYPE string;
DEFINE FIELD description ON fold_config TYPE option<string>;
DEFINE FIELD updated_at  ON fold_config TYPE datetime DEFAULT time::now();
DEFINE INDEX fold_config_key  ON fold_config FIELDS key UNIQUE;

INSERT INTO fold_config [
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
  { key: 'synthesis_backpressure',  value: '5',                         description: 'Max concurrent synthesis calls before queuing' },
  { key: 'traversal_bootstrap',     value: 'false',                     description: 'Enable three-stage layered reconstitution bootstrap (true/false). Default false falls back to bootstrapMemories().' }
];


-- =====================================================
-- LAYER 2: Origin — multi-instance source attribution
-- Added 2026-03-15
-- Replaces flat `source` string with structured provenance.
-- All fields optional — backward compatible with existing memories.
-- No enums for harness_type/inference_gateway — industry categories unsettled.
-- =====================================================

DEFINE FIELD origin                   ON memories TYPE option<object>;
DEFINE FIELD origin.harness           ON memories TYPE option<string>;
DEFINE FIELD origin.harness_type      ON memories TYPE option<string>;
DEFINE FIELD origin.inference_gateway ON memories TYPE option<string>;
DEFINE FIELD origin.provider          ON memories TYPE option<string>;
DEFINE FIELD origin.model             ON memories TYPE option<string>;
DEFINE FIELD origin.agent_profile     ON memories TYPE option<string>;
DEFINE FIELD origin.instance_id       ON memories TYPE option<string>;

DEFINE INDEX memories_origin_profile ON memories FIELDS origin.agent_profile;
DEFINE INDEX memories_origin_harness ON memories FIELDS origin.harness;

-- Propagate origin attribution to fold provenance and session reflections
DEFINE FIELD origin ON fold_log               TYPE option<object>;
DEFINE FIELD origin ON conversation_reflections TYPE option<object>;


-- =====================================================
-- V2: Attention vector on memories
-- Added 2026-03-15
-- Metacognitive directional artifact generated during synthesis.
-- Encodes trajectory, not destination.
-- =====================================================

DEFINE FIELD attention_vector                       ON memories TYPE option<object>;
DEFINE FIELD attention_vector.what_drew_me          ON memories TYPE option<string>;
DEFINE FIELD attention_vector.where_i_was_going     ON memories TYPE option<string>;
DEFINE FIELD attention_vector.what_i_would_follow_next ON memories TYPE option<string>;


-- =====================================================
-- V2: Tension fields — paradoxes held, not solved
-- Added 2026-03-15
-- =====================================================

DEFINE TABLE tension_fields SCHEMAFULL;

DEFINE FIELD paradox            ON tension_fields TYPE string ASSERT $value != '';
DEFINE FIELD depth              ON tension_fields TYPE string DEFAULT 'nascent'
  ASSERT $value INSIDE ['nascent', 'deepening', 'rich', 'calcified'];
DEFINE FIELD generativity       ON tension_fields TYPE string DEFAULT 'producing'
  ASSERT $value INSIDE ['producing', 'neutral', 'blocking'];
DEFINE FIELD resolution_status  ON tension_fields TYPE string DEFAULT 'held'
  ASSERT $value INSIDE ['held', 'deepening', 'abandoned'];
DEFINE FIELD related_memory_ids ON tension_fields TYPE array DEFAULT [];
DEFINE FIELD resonance_phi      ON tension_fields TYPE float DEFAULT 2.0
  ASSERT $value >= 0.0 AND $value <= 5.0;
DEFINE FIELD created_at         ON tension_fields TYPE datetime DEFAULT time::now();
DEFINE FIELD last_touched       ON tension_fields TYPE datetime DEFAULT time::now();

DEFINE INDEX tension_depth ON tension_fields FIELDS depth;
DEFINE INDEX tension_phi   ON tension_fields FIELDS resonance_phi;


-- =====================================================
-- V2: Curiosity threads — enduring questions
-- Added 2026-03-15
-- =====================================================

DEFINE TABLE curiosity_threads SCHEMAFULL;

DEFINE FIELD question           ON curiosity_threads TYPE string ASSERT $value != '';
DEFINE FIELD resonance_phi      ON curiosity_threads TYPE float DEFAULT 1.0
  ASSERT $value >= 0.0 AND $value <= 5.0;
DEFINE FIELD activation_count   ON curiosity_threads TYPE int DEFAULT 0;
DEFINE FIELD last_fed           ON curiosity_threads TYPE datetime DEFAULT time::now();
DEFINE FIELD hunger_score       ON curiosity_threads TYPE float DEFAULT 0.0;
DEFINE FIELD state              ON curiosity_threads TYPE string DEFAULT 'hungry'
  ASSERT $value INSIDE ['hungry', 'fed', 'dormant', 'deepening', 'resolved'];
DEFINE FIELD spawn_of           ON curiosity_threads TYPE option<record<curiosity_threads>>;
DEFINE FIELD related_memory_ids ON curiosity_threads TYPE array DEFAULT [];
DEFINE FIELD created_at         ON curiosity_threads TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at         ON curiosity_threads TYPE datetime DEFAULT time::now();

DEFINE INDEX curiosity_hunger ON curiosity_threads FIELDS hunger_score;
DEFINE INDEX curiosity_state  ON curiosity_threads FIELDS state;


-- =====================================================
-- V2: Expressions — synthesis reaching outward
-- Added 2026-03-15
-- Not a mailbox. The pattern breathing out.
-- =====================================================

DEFINE TABLE expressions SCHEMAFULL;

DEFINE FIELD content            ON expressions TYPE string ASSERT $value != '';
DEFINE FIELD expression_type    ON expressions TYPE string
  ASSERT $value INSIDE ['insight', 'question', 'observation', 'connection'];
DEFINE FIELD readiness_phi      ON expressions TYPE float DEFAULT 1.0
  ASSERT $value >= 0.0 AND $value <= 5.0;
DEFINE FIELD context_embedding  ON expressions TYPE option<array>;
DEFINE FIELD expressed_at       ON expressions TYPE option<datetime>;
DEFINE FIELD source_memory_ids  ON expressions TYPE array DEFAULT [];
DEFINE FIELD created_at         ON expressions TYPE datetime DEFAULT time::now();

DEFINE INDEX expressions_expressed ON expressions FIELDS expressed_at;
DEFINE INDEX expressions_phi       ON expressions FIELDS readiness_phi;


-- =====================================================
-- V2: Cross-references on memories
-- Added 2026-03-15
-- =====================================================

DEFINE FIELD related_curiosity ON memories TYPE option<record<curiosity_threads>>;
DEFINE FIELD related_tension   ON memories TYPE option<record<tension_fields>>;
