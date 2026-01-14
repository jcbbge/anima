/**
 * Tiered Caching Strategy Tests (PRD-003)
 *
 * Tests the three-tier caching strategy:
 * - 15 minutes: Per-conversation cache
 * - 1 hour: Session cache
 * - 24 hours: Global cache
 *
 * Also tests catalyst-triggered cache invalidation.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { randomUUID } from 'crypto';
import {
  setupTestSchema,
  teardownTestSchema,
  clearTestData,
  testQuery,
  closeTestPool,
  getTestSchema,
} from './setup/testDatabase.js';

// NOTE: We need to use the production database for handshake tests
// because handshakeService is not yet schema-injectable.
// The test schema is used for memories/ghost_logs setup, but generateHandshake
// queries the public schema. This is a known limitation.
import { query } from '../src/config/database.js';
import { generateHandshake } from '../src/services/handshakeService.js';

// Cache window constants (must match handshakeService.js)
const CACHE_WINDOWS = {
  PER_CONVERSATION: 15 * 60 * 1000,    // 15 minutes
  PER_SESSION: 60 * 60 * 1000,          // 1 hour
  GLOBAL: 24 * 60 * 60 * 1000,          // 24 hours
};

/**
 * Helper: Insert a test memory into production database
 * (handshakeService is not schema-injectable yet)
 */
async function insertMemory(data) {
  const {
    content,
    conversationId = null,
    resonancePhi = 1.0,
    isCatalyst = false,
    category = 'observation',
    tier = 'active',
  } = data;

  const result = await query(
    `INSERT INTO memories (
       content,
       conversation_id,
       resonance_phi,
       is_catalyst,
       category,
       tier,
       content_hash,
       embedding
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, created_at`,
    [
      content,
      conversationId,
      resonancePhi,
      isCatalyst,
      category,
      tier,
      'test-hash-' + randomUUID(),
      JSON.stringify(Array(768).fill(0.1)), // Mock embedding (768 dimensions)
    ]
  );

  return result.rows[0];
}

/**
 * Helper: Detect significant state change (mirrors private function)
 */
async function detectSignificantStateChange(conversationId, sinceTimestamp) {
  if (!conversationId) {
    return false;
  }

  const result = await query(
    `SELECT COUNT(*) as count
     FROM memories
     WHERE conversation_id = $1
       AND created_at > $2
       AND (
         is_catalyst = true
         OR resonance_phi >= 4.0
       )
       AND deleted_at IS NULL`,
    [conversationId, sinceTimestamp]
  );

  return parseInt(result.rows[0].count) > 0;
}

/**
 * Helper: Clean up test data from production database
 */
async function cleanupTestData() {
  // Delete test memories (identified by test-hash prefix)
  await query(`DELETE FROM memories WHERE content_hash LIKE 'test-hash-%'`);
  // Delete test ghost logs (created during tests)
  await query(`DELETE FROM ghost_logs WHERE created_at > NOW() - INTERVAL '1 hour'`);
}

describe('Tiered Caching Strategy (PRD-003)', () => {
  beforeAll(async () => {
    await setupTestSchema();
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await teardownTestSchema();
    await closeTestPool();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  test('Test 1: Should NOT regenerate within 15min for SAME conversation', async () => {
    const convId = randomUUID();
    
    await insertMemory({
      content: 'Working on authentication',
      conversationId: convId,
      resonancePhi: 2.0,
    });
    
    const h1 = await generateHandshake({ conversationId: convId });
    const h2 = await generateHandshake({ conversationId: convId });
    
    expect(h2.ghostId).toBe(h1.ghostId);
    expect(h2.isExisting).toBe(true);
    expect(h2.cacheReason).toBe('per_conversation');
    expect(h2.cachedFor).toBeLessThan(CACHE_WINDOWS.PER_CONVERSATION);
  });

  test('Test 2: Should regenerate immediately for NEW conversation', async () => {
    const convA = randomUUID();
    const convB = randomUUID();
    
    await insertMemory({ content: 'Auth work', conversationId: convA, resonancePhi: 2.0 });
    const h1 = await generateHandshake({ conversationId: convA });
    
    await insertMemory({ content: 'DB work', conversationId: convB, resonancePhi: 2.0 });
    const h2 = await generateHandshake({ conversationId: convB });
    
    expect(h2.ghostId).not.toBe(h1.ghostId);
    expect(h2.isExisting).toBe(false);
    expect(h2.conversationId).toBe(convB);
  });

  test('Test 3: Should regenerate after 15min for SAME conversation', async () => {
    const convId = randomUUID();

    await insertMemory({
      content: 'Initial memory',
      conversationId: convId,
      resonancePhi: 2.0,
    });

    const h1 = await generateHandshake({ conversationId: convId });

    // Manually age the ghost by updating its created_at timestamp
    await query(
      `UPDATE ghost_logs
       SET created_at = NOW() - INTERVAL '16 minutes'
       WHERE id = $1`,
      [h1.ghostId]
    );

    const h2 = await generateHandshake({ conversationId: convId });

    expect(h2.ghostId).not.toBe(h1.ghostId);
    expect(h2.isExisting).toBe(false);
  });

  test('Test 4: Should invalidate cache on catalyst addition', async () => {
    const convId = randomUUID();

    await insertMemory({
      content: 'Working on prototype',
      conversationId: convId,
      resonancePhi: 1.0,
    });

    const h1 = await generateHandshake({ conversationId: convId });

    // Wait a bit to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 100));

    // Add a catalyst memory
    await insertMemory({
      content: 'BREAKTHROUGH: Solved major problem',
      conversationId: convId,
      isCatalyst: true,
      resonancePhi: 5.0,
    });

    const h2 = await generateHandshake({ conversationId: convId });

    expect(h2.ghostId).not.toBe(h1.ghostId);
    expect(h2.isExisting).toBe(false);
    // The new ghost should include the catalyst memory content
    expect(h2.promptText).toContain('Solved major problem');
  });

  test('Test 5: Should invalidate cache on high-phi memory (>=4.0)', async () => {
    const convId = randomUUID();

    await insertMemory({
      content: 'Regular work',
      conversationId: convId,
      resonancePhi: 1.0,
    });

    const h1 = await generateHandshake({ conversationId: convId });

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    // Add high-phi memory
    await insertMemory({
      content: 'Critical discovery',
      conversationId: convId,
      resonancePhi: 4.5,
    });

    const h2 = await generateHandshake({ conversationId: convId });

    expect(h2.ghostId).not.toBe(h1.ghostId);
  });

  test('Test 6: Should provide forensic-level cache metadata', async () => {
    const convId = randomUUID();

    await insertMemory({
      content: 'Test memory',
      conversationId: convId,
      resonancePhi: 2.0,
    });

    const h1 = await generateHandshake({ conversationId: convId });

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    const h2 = await generateHandshake({ conversationId: convId });

    expect(h2.isExisting).toBe(true);
    expect(h2.cachedFor).toBeGreaterThan(0);
    expect(h2.cachedFor).toBeLessThan(CACHE_WINDOWS.PER_CONVERSATION);
    expect(h2.cacheReason).toBe('per_conversation');
    expect(h2.cacheWindow).toBe(CACHE_WINDOWS.PER_CONVERSATION);
    expect(h2.conversationId).toBe(convId);
  });

  test('Test 7: Global handshake should use 24h cache', async () => {
    await insertMemory({
      content: 'Global memory',
      conversationId: null,
      resonancePhi: 3.0,
    });

    const h1 = await generateHandshake({ force: false });
    const h2 = await generateHandshake({ force: false });

    expect(h2.ghostId).toBe(h1.ghostId);
    expect(h2.cacheReason).toBe('global_fallback');
    expect(h2.cacheWindow).toBe(CACHE_WINDOWS.GLOBAL);
  });

  test('Test 8: Force flag should bypass cache regardless of window', async () => {
    const convId = randomUUID();

    await insertMemory({
      content: 'Test memory',
      conversationId: convId,
      resonancePhi: 2.0,
    });

    const h1 = await generateHandshake({ conversationId: convId });
    const h2 = await generateHandshake({ conversationId: convId, force: true });

    expect(h2.ghostId).not.toBe(h1.ghostId);
    expect(h2.isExisting).toBe(false);
    expect(h2.cachedFor).toBe(0);
  });

  test('Test 9: detectSignificantStateChange() should identify catalysts', async () => {
    const convId = randomUUID();
    const timestamp = new Date();

    await insertMemory({
      content: 'Regular memory',
      conversationId: convId,
      resonancePhi: 1.0,
    });

    const hasChange1 = await detectSignificantStateChange(convId, timestamp);
    expect(hasChange1).toBe(false);

    // Wait to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 100));

    await insertMemory({
      content: 'Catalyst memory',
      conversationId: convId,
      isCatalyst: true,
      resonancePhi: 2.0,
    });

    const hasChange2 = await detectSignificantStateChange(convId, timestamp);
    expect(hasChange2).toBe(true);
  });

  test('Test 10: Console logs should provide cache decision reasoning', async () => {
    const convId = randomUUID();

    await insertMemory({
      content: 'Test memory',
      conversationId: convId,
      resonancePhi: 2.0,
    });

    // Capture console.log output
    const originalLog = console.log;
    const logs = [];
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };

    const h1 = await generateHandshake({ conversationId: convId });
    const h2 = await generateHandshake({ conversationId: convId });

    // Restore console.log
    console.log = originalLog;

    // Check that cache decision was logged
    const cacheLog = logs.find(log => log.includes('📋 Using cached ghost'));
    expect(cacheLog).toBeDefined();
    expect(cacheLog).toContain('per_conversation');
    expect(cacheLog).toContain(convId);
  });
});

