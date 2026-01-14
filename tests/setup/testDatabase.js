/**
 * Test Database Setup
 *
 * Creates isolated test schema and provides utilities for test data management.
 */

import pg from 'pg';
import { getConfig } from '../../src/config/environment.js';

const { Pool } = pg;
const config = getConfig();

// Test schema name (isolated from production)
const TEST_SCHEMA = 'test_semantic_consolidation';

/**
 * Create test database pool
 */
const testPool = new Pool({
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
async function testQuery(text, params) {
  return await testPool.query(text, params);
}

/**
 * Setup test schema and tables
 */
async function setupTestSchema() {
  // Create test schema
  await testQuery(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await testQuery(`CREATE SCHEMA ${TEST_SCHEMA}`);

  // Set search path to test schema
  await testQuery(`SET search_path TO ${TEST_SCHEMA}, public`);

  // Create memories table in test schema
  await testQuery(`
    CREATE TABLE ${TEST_SCHEMA}.memories (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE,
      embedding vector(768) NOT NULL,
      tier TEXT NOT NULL DEFAULT 'active',
      tier_last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accessed_in_conversation_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
      conversation_id UUID DEFAULT NULL,
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
  await testQuery(`
    CREATE INDEX idx_test_memories_embedding ON ${TEST_SCHEMA}.memories
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
  `);

  // Create indexes
  await testQuery(`
    CREATE INDEX idx_test_memories_content_hash ON ${TEST_SCHEMA}.memories(content_hash)
    WHERE deleted_at IS NULL
  `);

  await testQuery(`
    CREATE INDEX idx_test_memories_resonance ON ${TEST_SCHEMA}.memories(resonance_phi DESC)
    WHERE deleted_at IS NULL
  `);

  await testQuery(`
    CREATE INDEX idx_test_memories_conversation ON ${TEST_SCHEMA}.memories(conversation_id, last_accessed DESC)
    WHERE conversation_id IS NOT NULL AND deleted_at IS NULL
  `);

  await testQuery(`
    CREATE INDEX idx_test_memories_conversation_phi ON ${TEST_SCHEMA}.memories(conversation_id, resonance_phi DESC)
    WHERE conversation_id IS NOT NULL AND deleted_at IS NULL
  `);

  // Create ghost_logs table in test schema
  await testQuery(`
    CREATE TABLE ${TEST_SCHEMA}.ghost_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      prompt_text TEXT NOT NULL,
      top_phi_memories UUID[],
      top_phi_values FLOAT[],
      synthesis_method TEXT DEFAULT 'standard',
      conversation_id UUID DEFAULT NULL,
      context_type TEXT DEFAULT 'global',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
    )
  `);

  await testQuery(`
    CREATE INDEX idx_test_ghost_logs_conversation ON ${TEST_SCHEMA}.ghost_logs(conversation_id, created_at DESC)
    WHERE conversation_id IS NOT NULL
  `);

  await testQuery(`
    CREATE INDEX idx_test_ghost_logs_expires ON ${TEST_SCHEMA}.ghost_logs(expires_at DESC)
  `);

  // Create meta_reflections table in test schema
  await testQuery(`
    CREATE TABLE ${TEST_SCHEMA}.meta_reflections (
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

  // Create indexes for meta_reflections
  await testQuery(`
    CREATE INDEX idx_test_meta_reflections_type ON ${TEST_SCHEMA}.meta_reflections(reflection_type)
  `);

  await testQuery(`
    CREATE INDEX idx_test_meta_reflections_conversation_id ON ${TEST_SCHEMA}.meta_reflections(conversation_id)
    WHERE conversation_id IS NOT NULL
  `);

  console.log(`✅ Test schema '${TEST_SCHEMA}' created`);
}

/**
 * Teardown test schema
 */
async function teardownTestSchema() {
  await testQuery(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  console.log(`✅ Test schema '${TEST_SCHEMA}' dropped`);
}

/**
 * Clear all test data but keep schema
 */
async function clearTestData() {
  await testQuery(`TRUNCATE TABLE ${TEST_SCHEMA}.memories RESTART IDENTITY CASCADE`);
}

/**
 * Insert test memory
 */
async function insertTestMemory({
  content,
  contentHash,
  embedding,
  resonancePhi = 0.0,
  isCatalyst = false,
  metadata = null,
  category = null,
  tags = [],
  source = null,
}) {
  const result = await testQuery(
    `INSERT INTO ${TEST_SCHEMA}.memories
      (content, content_hash, embedding, resonance_phi, is_catalyst, metadata, category, tags, source)
     VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      content,
      contentHash,
      JSON.stringify(embedding),
      resonancePhi,
      isCatalyst,
      metadata ? JSON.stringify(metadata) : null,
      category,
      tags,
      source,
    ]
  );

  return result.rows[0];
}

/**
 * Find memory by ID
 */
async function findTestMemoryById(id) {
  const result = await testQuery(
    `SELECT * FROM ${TEST_SCHEMA}.memories WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

/**
 * Get all test memories
 */
async function getAllTestMemories() {
  const result = await testQuery(
    `SELECT * FROM ${TEST_SCHEMA}.memories WHERE deleted_at IS NULL ORDER BY created_at DESC`
  );
  return result.rows;
}

/**
 * Count test memories
 */
async function countTestMemories() {
  const result = await testQuery(
    `SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.memories WHERE deleted_at IS NULL`
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Close test pool
 */
async function closeTestPool() {
  await testPool.end();
}

/**
 * Get test schema name (for use in service calls)
 */
function getTestSchema() {
  return TEST_SCHEMA;
}

export {
  testQuery,
  setupTestSchema,
  teardownTestSchema,
  clearTestData,
  insertTestMemory,
  findTestMemoryById,
  getAllTestMemories,
  countTestMemories,
  closeTestPool,
  getTestSchema,
};
