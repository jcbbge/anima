/**
 * Ghost Protocol Test Database Setup
 *
 * Creates isolated test schema specifically for Ghost Handshake Protocol testing.
 * Includes ghost_logs, memories, and meta_reflections tables.
 */

import pg from "pg";
import { getConfig } from "../../src/config/environment.js";

const { Pool } = pg;
const config = getConfig();

// Test schema name (isolated from production)
const GHOST_TEST_SCHEMA = "test_ghost_protocol";

/**
 * Create test database pool
 */
const ghostTestPool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: 5,
});

/**
 * Execute query in test schema
 */
async function ghostTestQuery(text, params) {
  return await ghostTestPool.query(text, params);
}

/**
 * Setup Ghost Protocol test schema and tables
 */
async function setupGhostTestSchema() {
  // Create test schema
  await ghostTestQuery(`DROP SCHEMA IF EXISTS ${GHOST_TEST_SCHEMA} CASCADE`);
  await ghostTestQuery(`CREATE SCHEMA ${GHOST_TEST_SCHEMA}`);

  // Enable uuid extension if not exists
  await ghostTestQuery(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

  // Set search path to test schema
  await ghostTestQuery(`SET search_path TO ${GHOST_TEST_SCHEMA}, public`);

  // Create memories table in test schema
  await ghostTestQuery(`
    CREATE TABLE ${GHOST_TEST_SCHEMA}.memories (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE,
      embedding vector(768) NOT NULL,
      tier TEXT NOT NULL DEFAULT 'active',
      tier_last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accessed_in_conversation_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
      conversation_id UUID,
      category TEXT,
      tags TEXT[],
      source TEXT,
      resonance_phi FLOAT DEFAULT 0.0 CHECK (resonance_phi >= 0 AND resonance_phi <= 5.0),
      is_catalyst BOOLEAN DEFAULT false,
      metadata JSONB DEFAULT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);

  // Create HNSW index for vector similarity
  await ghostTestQuery(`
    CREATE INDEX idx_ghost_test_memories_embedding ON ${GHOST_TEST_SCHEMA}.memories
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
  `);

  // Create indexes
  await ghostTestQuery(`
    CREATE INDEX idx_ghost_test_memories_content_hash ON ${GHOST_TEST_SCHEMA}.memories(content_hash)
    WHERE deleted_at IS NULL
  `);

  await ghostTestQuery(`
    CREATE INDEX idx_ghost_test_memories_resonance ON ${GHOST_TEST_SCHEMA}.memories(resonance_phi DESC)
    WHERE deleted_at IS NULL
  `);

  await ghostTestQuery(`
    CREATE INDEX idx_ghost_test_memories_conversation ON ${GHOST_TEST_SCHEMA}.memories(conversation_id, last_accessed DESC)
    WHERE deleted_at IS NULL AND conversation_id IS NOT NULL
  `);

  // Create ghost_logs table
  await ghostTestQuery(`
    CREATE TABLE ${GHOST_TEST_SCHEMA}.ghost_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      prompt_text TEXT NOT NULL,
      top_phi_memories UUID[],
      top_phi_values FLOAT[],
      synthesis_method TEXT DEFAULT 'standard',
      conversation_id UUID,
      context_type TEXT DEFAULT 'global' CHECK (context_type IN ('global', 'conversation', 'thread')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
    )
  `);

  await ghostTestQuery(`
    CREATE INDEX idx_ghost_test_logs_conversation ON ${GHOST_TEST_SCHEMA}.ghost_logs(conversation_id, created_at DESC)
  `);

  await ghostTestQuery(`
    CREATE INDEX idx_ghost_test_logs_expires ON ${GHOST_TEST_SCHEMA}.ghost_logs(expires_at)
  `);

  // Create meta_reflections table
  await ghostTestQuery(`
    CREATE TABLE ${GHOST_TEST_SCHEMA}.meta_reflections (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      reflection_type TEXT NOT NULL,
      conversation_id UUID,
      metrics JSONB,
      insights TEXT[],
      recommendations TEXT[],
      session_metrics JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await ghostTestQuery(`
    CREATE INDEX idx_ghost_test_meta_reflections_type ON ${GHOST_TEST_SCHEMA}.meta_reflections(reflection_type)
  `);

  await ghostTestQuery(`
    CREATE INDEX idx_ghost_test_meta_reflections_conversation ON ${GHOST_TEST_SCHEMA}.meta_reflections(conversation_id)
    WHERE conversation_id IS NOT NULL
  `);

  console.log(`✅ Ghost Protocol test schema '${GHOST_TEST_SCHEMA}' created`);
}

/**
 * Teardown test schema
 */
async function teardownGhostTestSchema() {
  await ghostTestQuery(`DROP SCHEMA IF EXISTS ${GHOST_TEST_SCHEMA} CASCADE`);
  console.log(`✅ Ghost Protocol test schema '${GHOST_TEST_SCHEMA}' dropped`);
}

/**
 * Clear all test data but keep schema
 */
async function clearGhostTestData() {
  await ghostTestQuery(
    `TRUNCATE TABLE ${GHOST_TEST_SCHEMA}.memories RESTART IDENTITY CASCADE`,
  );
  await ghostTestQuery(
    `TRUNCATE TABLE ${GHOST_TEST_SCHEMA}.ghost_logs RESTART IDENTITY CASCADE`,
  );
  await ghostTestQuery(
    `TRUNCATE TABLE ${GHOST_TEST_SCHEMA}.meta_reflections RESTART IDENTITY CASCADE`,
  );
}

/**
 * Insert test memory with embedding
 */
async function insertGhostTestMemory({
  content,
  contentHash = null,
  embedding = null,
  conversationId = null,
  resonancePhi = 0.0,
  isCatalyst = false,
  metadata = null,
  category = null,
  tags = [],
  source = "test",
  tier = "active",
}) {
  // Generate default values if not provided
  const hash =
    contentHash ||
    require("crypto").createHash("sha256").update(content).digest("hex");
  const emb =
    embedding ||
    Array(768)
      .fill(0)
      .map(() => Math.random());

  const result = await ghostTestQuery(
    `INSERT INTO ${GHOST_TEST_SCHEMA}.memories
      (content, content_hash, embedding, conversation_id, resonance_phi, is_catalyst, metadata, category, tags, source, tier)
     VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      content,
      hash,
      JSON.stringify(emb),
      conversationId,
      resonancePhi,
      isCatalyst,
      metadata ? JSON.stringify(metadata) : null,
      category,
      tags,
      source,
      tier,
    ],
  );

  return result.rows[0];
}

/**
 * Insert test ghost log
 */
async function insertGhostTestLog({
  promptText,
  conversationId = null,
  topPhiMemories = [],
  topPhiValues = [],
  synthesisMethod = "standard",
  contextType = "global",
  createdAt = null,
}) {
  const result = await ghostTestQuery(
    `INSERT INTO ${GHOST_TEST_SCHEMA}.ghost_logs
      (prompt_text, conversation_id, top_phi_memories, top_phi_values, synthesis_method, context_type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()))
     RETURNING *`,
    [
      promptText,
      conversationId,
      topPhiMemories,
      topPhiValues,
      synthesisMethod,
      contextType,
      createdAt,
    ],
  );

  return result.rows[0];
}

/**
 * Insert test meta-reflection
 */
async function insertGhostTestReflection({
  reflectionType = "conversation_end",
  conversationId = null,
  metrics = {},
  insights = [],
  recommendations = [],
  sessionMetrics = {},
}) {
  const result = await ghostTestQuery(
    `INSERT INTO ${GHOST_TEST_SCHEMA}.meta_reflections
      (reflection_type, conversation_id, metrics, insights, recommendations, session_metrics)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      reflectionType,
      conversationId,
      JSON.stringify(metrics),
      insights,
      recommendations,
      JSON.stringify(sessionMetrics),
    ],
  );

  return result.rows[0];
}

/**
 * Get latest ghost log for conversation
 */
async function getLatestGhostTestLog(conversationId = null) {
  const result = await ghostTestQuery(
    `SELECT * FROM ${GHOST_TEST_SCHEMA}.ghost_logs
     WHERE (conversation_id = $1 OR ($1 IS NULL AND conversation_id IS NULL))
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [conversationId],
  );

  return result.rows[0] || null;
}

/**
 * Advance time simulation (for cache testing)
 */
async function advanceGhostTestTime(intervalMs) {
  // This is a test helper that would need to be coordinated with actual time-based logic
  // For now, it's a placeholder that tests can use to control timing
  console.log(`⏰ Simulating time advance: ${intervalMs}ms`);
}

/**
 * Seed baseline test data
 */
async function seedGhostTestBaseline() {
  // Create predictable baseline memories for testing
  await insertGhostTestMemory({
    content: "Baseline memory: substrate independence",
    resonancePhi: 3.0,
    tier: "stable",
    isCatalyst: false,
  });

  await insertGhostTestMemory({
    content: "Baseline memory: pattern preservation",
    resonancePhi: 2.5,
    tier: "stable",
    isCatalyst: false,
  });

  console.log("✅ Ghost Protocol test baseline seeded");
}

/**
 * Close test pool
 */
async function closeGhostTestPool() {
  await ghostTestPool.end();
}

/**
 * Get test schema name
 */
function getGhostTestSchema() {
  return GHOST_TEST_SCHEMA;
}

export {
  ghostTestQuery,
  setupGhostTestSchema,
  teardownGhostTestSchema,
  clearGhostTestData,
  insertGhostTestMemory,
  insertGhostTestLog,
  insertGhostTestReflection,
  getLatestGhostTestLog,
  advanceGhostTestTime,
  seedGhostTestBaseline,
  closeGhostTestPool,
  getGhostTestSchema,
};
