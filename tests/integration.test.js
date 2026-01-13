/**
 * Integration Tests - Memory Service with Semantic Consolidation
 *
 * Tests the full integration of semantic consolidation with memoryService.js
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import {
  setupTestSchema,
  teardownTestSchema,
  clearTestData,
  findTestMemoryById,
  getAllTestMemories,
  countTestMemories,
  testQuery,
  getTestSchema,
  closeTestPool,
} from './setup/testDatabase.js';
import {
  veryHighSimilarityFixture,
  thresholdSimilarityFixture,
  belowThresholdFixture,
} from './fixtures/memoryFixtures.js';
import { createSemanticConsolidationService } from '../src/services/semanticConsolidationService.js';

// Mock memoryService addMemory function with semantic consolidation
async function addMemoryWithSemanticConsolidation(memoryData, options = {}) {
  const { content, category, tags, source, isCatalyst = false } = memoryData;
  const semanticConsolidationEnabled = options.semanticConsolidationEnabled !== false;

  const service = createSemanticConsolidationService({
    queryFn: testQuery,
    schema: getTestSchema(),
  });

  // Generate hash
  const crypto = await import('crypto');
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');

  // Generate embedding (mocked - use fixture embedding)
  const embedding = memoryData.embedding || options.embedding;

  if (!embedding) {
    throw new Error('Test requires embedding to be provided');
  }

  // Step 1: Semantic deduplication (if enabled)
  if (semanticConsolidationEnabled) {
    try {
      const semanticMatch = await service.findSemanticDuplicate(embedding);

      if (semanticMatch) {
        const consolidationResult = await service.mergeIntoSemanticCentroid(
          semanticMatch.id,
          content,
          isCatalyst,
          semanticMatch.similarity
        );

        return {
          ...consolidationResult,
          embeddingProvider: 'test',
        };
      }
    } catch (error) {
      console.error('Semantic consolidation failed:', error.message);
    }
  }

  // Step 2: Hash-based deduplication
  const schema = getTestSchema();
  const existingResult = await testQuery(
    `SELECT id, content, content_hash, tier, access_count, resonance_phi, created_at, updated_at
     FROM ${schema}.memories
     WHERE content_hash = $1 AND deleted_at IS NULL`,
    [contentHash]
  );

  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0];

    await testQuery(
      `UPDATE ${schema}.memories
       SET access_count = access_count + 1,
           last_accessed = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [existing.id]
    );

    return {
      memory: {
        ...existing,
        access_count: existing.access_count + 1,
      },
      isDuplicate: true,
      exactMatch: true,
      embeddingProvider: 'test',
    };
  }

  // Step 3: Create new memory
  const initialPhi = isCatalyst ? 1.0 : 0.0;

  const insertResult = await testQuery(
    `INSERT INTO ${schema}.memories (
      content,
      content_hash,
      embedding,
      category,
      tags,
      source,
      tier,
      resonance_phi,
      is_catalyst
    ) VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      content,
      contentHash,
      JSON.stringify(embedding),
      category || null,
      tags || null,
      source || null,
      'active',
      initialPhi,
      isCatalyst,
    ]
  );

  return {
    memory: insertResult.rows[0],
    isDuplicate: false,
    embeddingProvider: 'test',
    isCatalyst,
  };
}

// Setup
beforeAll(async () => {
  await setupTestSchema();
});

afterAll(async () => {
  await teardownTestSchema();
});

describe('Integration - addMemory with Semantic Consolidation', () => {
  beforeEach(async () => {
    await clearTestData();
  });

  test('should consolidate semantic duplicate when feature enabled', async () => {
    // Add first memory
    const result1 = await addMemoryWithSemanticConsolidation({
      content: veryHighSimilarityFixture.memory1.content,
      embedding: veryHighSimilarityFixture.memory1.embedding,
      resonancePhi: veryHighSimilarityFixture.memory1.resonancePhi,
      isCatalyst: veryHighSimilarityFixture.memory1.isCatalyst,
    }, { semanticConsolidationEnabled: true });

    expect(result1.isDuplicate).toBe(false);
    const initialPhi = parseFloat(result1.memory.resonance_phi);

    // Add semantic duplicate
    const result2 = await addMemoryWithSemanticConsolidation({
      content: veryHighSimilarityFixture.memory2.content,
      embedding: veryHighSimilarityFixture.memory2.embedding,
      isCatalyst: false,
    }, { semanticConsolidationEnabled: true });

    // Should have merged
    expect(result2.wasMerged).toBe(true);
    expect(result2.semanticConsolidation).toBe(true);
    expect(result2.memory.id).toBe(result1.memory.id);

    // φ should have increased
    const finalPhi = parseFloat(result2.memory.resonance_phi);
    expect(finalPhi).toBeGreaterThan(initialPhi);

    // Should only have 1 memory in database
    const count = await countTestMemories();
    expect(count).toBe(1);

    // Check metadata has semantic_variants
    const memory = await findTestMemoryById(result1.memory.id);
    expect(memory.metadata).not.toBeNull();
    expect(memory.metadata.semantic_variants).toBeDefined();
    expect(memory.metadata.semantic_variants.length).toBe(1);
  });

  test('should NOT consolidate when below similarity threshold', async () => {
    // Add first memory
    const result1 = await addMemoryWithSemanticConsolidation({
      content: belowThresholdFixture.memory1.content,
      embedding: belowThresholdFixture.memory1.embedding,
      resonancePhi: belowThresholdFixture.memory1.resonancePhi,
    }, { semanticConsolidationEnabled: true });

    // Add memory with low similarity
    const result2 = await addMemoryWithSemanticConsolidation({
      content: belowThresholdFixture.memory2.content,
      embedding: belowThresholdFixture.memory2.embedding,
      isCatalyst: false,
    }, { semanticConsolidationEnabled: true });

    // Should NOT have merged
    expect(result2.isDuplicate).toBe(false);
    expect(result2.wasMerged).toBeUndefined();

    // Should have 2 separate memories
    const count = await countTestMemories();
    expect(count).toBe(2);
  });

  test('should create separate memories when feature disabled', async () => {
    // Add first memory
    const result1 = await addMemoryWithSemanticConsolidation({
      content: veryHighSimilarityFixture.memory1.content,
      embedding: veryHighSimilarityFixture.memory1.embedding,
      resonancePhi: veryHighSimilarityFixture.memory1.resonancePhi,
    }, { semanticConsolidationEnabled: false });

    // Add semantic duplicate (feature disabled)
    const result2 = await addMemoryWithSemanticConsolidation({
      content: veryHighSimilarityFixture.memory2.content,
      embedding: veryHighSimilarityFixture.memory2.embedding,
      isCatalyst: false,
    }, { semanticConsolidationEnabled: false });

    // Should NOT have merged
    expect(result2.isDuplicate).toBe(false);
    expect(result2.wasMerged).toBeUndefined();

    // Should have 2 separate memories
    const count = await countTestMemories();
    expect(count).toBe(2);
  });

  test('should still handle exact hash duplicates correctly', async () => {
    // Test hash-based dedup by disabling semantic consolidation
    // Add first memory
    const result1 = await addMemoryWithSemanticConsolidation({
      content: 'Exact same content',
      embedding: veryHighSimilarityFixture.memory1.embedding,
      resonancePhi: 1.0,
    }, { semanticConsolidationEnabled: false });

    // Add exact duplicate (same content, same hash)
    const result2 = await addMemoryWithSemanticConsolidation({
      content: 'Exact same content', // Same content = same hash
      embedding: veryHighSimilarityFixture.memory1.embedding,
      resonancePhi: 1.0,
    }, { semanticConsolidationEnabled: false });

    // Should be marked as duplicate
    expect(result2.isDuplicate).toBe(true);
    expect(result2.exactMatch).toBe(true);

    // Should have incremented access count
    expect(result2.memory.access_count).toBeGreaterThan(result1.memory.access_count);

    // Should only have 1 memory
    const count = await countTestMemories();
    expect(count).toBe(1);
  });

  test('should consolidate catalyst memory correctly', async () => {
    // Add normal memory (use veryHighSimilarity to ensure match)
    const result1 = await addMemoryWithSemanticConsolidation({
      content: veryHighSimilarityFixture.memory1.content,
      embedding: veryHighSimilarityFixture.memory1.embedding,
      resonancePhi: 2.0,
      isCatalyst: false,
    }, { semanticConsolidationEnabled: true });

    const initialPhi = parseFloat(result1.memory.resonance_phi);
    expect(result1.memory.is_catalyst).toBe(false);

    // Add catalyst semantic duplicate
    const result2 = await addMemoryWithSemanticConsolidation({
      content: veryHighSimilarityFixture.memory2.content,
      embedding: veryHighSimilarityFixture.memory2.embedding,
      isCatalyst: true, // Catalyst!
    }, { semanticConsolidationEnabled: true });

    // Should have merged and increased φ by ~1.0
    expect(result2.wasMerged).toBe(true);
    const finalPhi = parseFloat(result2.memory.resonance_phi);
    expect(finalPhi).toBeGreaterThan(initialPhi + 0.5); // Should add ~0.9-1.0

    // is_catalyst should be upgraded to true
    expect(result2.memory.is_catalyst).toBe(true);

    // Check phiContributed
    expect(result2.phiContributed).toBeGreaterThan(0.5);
  });

  test('should preserve existing memory data during consolidation', async () => {
    // Add memory with specific category and tags
    const result1 = await addMemoryWithSemanticConsolidation({
      content: veryHighSimilarityFixture.memory1.content,
      embedding: veryHighSimilarityFixture.memory1.embedding,
      category: 'test-category',
      tags: ['tag1', 'tag2'],
      source: 'test-source',
      resonancePhi: 1.0,
    }, { semanticConsolidationEnabled: true });

    // Add semantic duplicate
    const result2 = await addMemoryWithSemanticConsolidation({
      content: veryHighSimilarityFixture.memory2.content,
      embedding: veryHighSimilarityFixture.memory2.embedding,
    }, { semanticConsolidationEnabled: true });

    // Original data should be preserved
    expect(result2.memory.category).toBe('test-category');
    expect(result2.memory.tags).toEqual(['tag1', 'tag2']);
    expect(result2.memory.source).toBe('test-source');
  });

  test('should track multiple semantic consolidations', async () => {
    // Add first memory
    const result1 = await addMemoryWithSemanticConsolidation({
      content: 'First variant',
      embedding: veryHighSimilarityFixture.memory1.embedding,
      resonancePhi: 1.0,
    }, { semanticConsolidationEnabled: true });

    // Add second variant
    const result2 = await addMemoryWithSemanticConsolidation({
      content: 'Second variant',
      embedding: veryHighSimilarityFixture.memory2.embedding,
    }, { semanticConsolidationEnabled: true });

    // Add third variant
    const result3 = await addMemoryWithSemanticConsolidation({
      content: 'Third variant',
      embedding: veryHighSimilarityFixture.memory2.embedding,
    }, { semanticConsolidationEnabled: true });

    expect(result2.wasMerged).toBe(true);
    expect(result3.wasMerged).toBe(true);

    // Check all variants are tracked
    const memory = await findTestMemoryById(result1.memory.id);
    expect(memory.metadata.semantic_variants.length).toBe(2);

    // Should still only be 1 memory
    const count = await countTestMemories();
    expect(count).toBe(1);
  });
});
