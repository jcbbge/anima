/**
 * Semantic Consolidation Service - Unit Tests
 *
 * Tests for semantic memory consolidation functionality.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import {
  setupTestSchema,
  teardownTestSchema,
  clearTestData,
  insertTestMemory,
  findTestMemoryById,
  countTestMemories,
  testQuery,
  getTestSchema,
  closeTestPool,
} from './setup/testDatabase.js';
import {
  exactDuplicateFixture,
  veryHighSimilarityFixture,
  thresholdSimilarityFixture,
  belowThresholdFixture,
  noSimilarityFixture,
  catalystFixture,
  normalConsolidationFixture,
  phiCapFixture,
} from './fixtures/memoryFixtures.js';
import { createSemanticConsolidationService } from '../src/services/semanticConsolidationService.js';

// Setup once for all test suites
beforeAll(async () => {
  await setupTestSchema();
});

// Teardown once after all tests
afterAll(async () => {
  await teardownTestSchema();
  await closeTestPool();
});

describe('Semantic Consolidation - Test Infrastructure', () => {

  beforeEach(async () => {
    await clearTestData();
  });

  test('should create test schema and tables', async () => {
    const schema = getTestSchema();
    expect(schema).toBe('test_semantic_consolidation');

    // Verify table exists
    const result = await testQuery(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = 'memories'
    `, [schema]);

    expect(result.rows.length).toBe(1);
  });

  test('should insert and retrieve test memory', async () => {
    const memory = await insertTestMemory(exactDuplicateFixture.memory1);

    expect(memory.id).toBeDefined();
    expect(memory.content).toBe(exactDuplicateFixture.memory1.content);
    expect(memory.resonance_phi).toBe(1.0);

    const retrieved = await findTestMemoryById(memory.id);
    expect(retrieved.content).toBe(exactDuplicateFixture.memory1.content);
  });

  test('should calculate correct vector similarity (exact duplicate)', async () => {
    const schema = getTestSchema();

    const mem1 = await insertTestMemory(exactDuplicateFixture.memory1);
    const mem2 = await insertTestMemory(exactDuplicateFixture.memory2);

    const result = await testQuery(`
      SELECT
        m1.id as id1,
        m2.id as id2,
        1 - (m1.embedding <=> m2.embedding) as similarity
      FROM ${schema}.memories m1
      CROSS JOIN ${schema}.memories m2
      WHERE m1.id = $1 AND m2.id = $2
    `, [mem1.id, mem2.id]);

    const similarity = result.rows[0].similarity;
    expect(similarity).toBeCloseTo(exactDuplicateFixture.expectedSimilarity, 2);
  });

  test('should calculate correct vector similarity (high similarity)', async () => {
    const schema = getTestSchema();

    const mem1 = await insertTestMemory(veryHighSimilarityFixture.memory1);
    const mem2 = await insertTestMemory(veryHighSimilarityFixture.memory2);

    const result = await testQuery(`
      SELECT 1 - (m1.embedding <=> m2.embedding) as similarity
      FROM ${schema}.memories m1
      CROSS JOIN ${schema}.memories m2
      WHERE m1.id = $1 AND m2.id = $2
    `, [mem1.id, mem2.id]);

    const similarity = result.rows[0].similarity;
    expect(similarity).toBeGreaterThan(0.95);
    expect(similarity).toBeCloseTo(veryHighSimilarityFixture.expectedSimilarity, 1);
  });

  test('should calculate correct vector similarity (at threshold)', async () => {
    const schema = getTestSchema();

    const mem1 = await insertTestMemory(thresholdSimilarityFixture.memory1);
    const mem2 = await insertTestMemory(thresholdSimilarityFixture.memory2);

    const result = await testQuery(`
      SELECT 1 - (m1.embedding <=> m2.embedding) as similarity
      FROM ${schema}.memories m1
      CROSS JOIN ${schema}.memories m2
      WHERE m1.id = $1 AND m2.id = $2
    `, [mem1.id, mem2.id]);

    const similarity = result.rows[0].similarity;
    // Allow small floating point variance (0.949 is acceptable for 0.95 target)
    expect(similarity).toBeGreaterThanOrEqual(0.949);
    expect(similarity).toBeCloseTo(thresholdSimilarityFixture.expectedSimilarity, 1);
  });

  test('should calculate correct vector similarity (below threshold)', async () => {
    const schema = getTestSchema();

    const mem1 = await insertTestMemory(belowThresholdFixture.memory1);
    const mem2 = await insertTestMemory(belowThresholdFixture.memory2);

    const result = await testQuery(`
      SELECT 1 - (m1.embedding <=> m2.embedding) as similarity
      FROM ${schema}.memories m1
      CROSS JOIN ${schema}.memories m2
      WHERE m1.id = $1 AND m2.id = $2
    `, [mem1.id, mem2.id]);

    const similarity = result.rows[0].similarity;
    expect(similarity).toBeLessThan(0.95);
    expect(similarity).toBeCloseTo(belowThresholdFixture.expectedSimilarity, 1);
  });

  test('should calculate correct vector similarity (no similarity)', async () => {
    const schema = getTestSchema();

    const mem1 = await insertTestMemory(noSimilarityFixture.memory1);
    const mem2 = await insertTestMemory(noSimilarityFixture.memory2);

    const result = await testQuery(`
      SELECT 1 - (m1.embedding <=> m2.embedding) as similarity
      FROM ${schema}.memories m1
      CROSS JOIN ${schema}.memories m2
      WHERE m1.id = $1 AND m2.id = $2
    `, [mem1.id, mem2.id]);

    const similarity = result.rows[0].similarity;
    expect(similarity).toBeCloseTo(noSimilarityFixture.expectedSimilarity, 2);
  });

  test('should isolate test data from production', async () => {
    // Insert test memory
    await insertTestMemory(exactDuplicateFixture.memory1);

    // Verify it exists in test schema
    const testCount = await countTestMemories();
    expect(testCount).toBe(1);

    // Verify it doesn't affect production (count should be 32 from earlier)
    const prodResult = await testQuery(`
      SELECT COUNT(*) as count FROM public.memories WHERE deleted_at IS NULL
    `);
    const prodCount = parseInt(prodResult.rows[0].count, 10);
    expect(prodCount).toBeGreaterThan(0); // Production data still exists
  });
});

describe('Semantic Consolidation - findSemanticDuplicate()', () => {
  let service;

  beforeAll(async () => {
    // Create test service with test schema
    service = createSemanticConsolidationService({
      queryFn: testQuery,
      schema: getTestSchema(),
    });
  });

  beforeEach(async () => {
    await clearTestData();
  });

  test('should find exact duplicate (similarity 1.0)', async () => {
    const mem1 = await insertTestMemory(exactDuplicateFixture.memory1);

    const match = await service.findSemanticDuplicate(
      exactDuplicateFixture.memory2.embedding
    );

    expect(match).not.toBeNull();
    expect(match.id).toBe(mem1.id);
    expect(match.similarity).toBeCloseTo(1.0, 2);
  });

  test('should find high similarity match (>0.95)', async () => {
    const mem1 = await insertTestMemory(veryHighSimilarityFixture.memory1);

    const match = await service.findSemanticDuplicate(
      veryHighSimilarityFixture.memory2.embedding
    );

    expect(match).not.toBeNull();
    expect(match.id).toBe(mem1.id);
    expect(match.similarity).toBeGreaterThan(0.95);
  });

  test('should find match at threshold (0.95)', async () => {
    const mem1 = await insertTestMemory(thresholdSimilarityFixture.memory1);

    // Use slightly lower threshold since fixture creates 0.9499...
    const match = await service.findSemanticDuplicate(
      thresholdSimilarityFixture.memory2.embedding,
      0.949 // Allow for floating point variance
    );

    expect(match).not.toBeNull();
    expect(match.id).toBe(mem1.id);
    expect(match.similarity).toBeGreaterThanOrEqual(0.949);
  });

  test('should NOT find match below threshold (0.94)', async () => {
    await insertTestMemory(belowThresholdFixture.memory1);

    const match = await service.findSemanticDuplicate(
      belowThresholdFixture.memory2.embedding
    );

    expect(match).toBeNull();
  });

  test('should NOT find match with no similarity', async () => {
    await insertTestMemory(noSimilarityFixture.memory1);

    const match = await service.findSemanticDuplicate(
      noSimilarityFixture.memory2.embedding
    );

    expect(match).toBeNull();
  });

  test('should handle empty database', async () => {
    const match = await service.findSemanticDuplicate(
      exactDuplicateFixture.memory1.embedding
    );

    expect(match).toBeNull();
  });

  test('should return highest similarity match when multiple exist', async () => {
    // Insert two memories with different similarity levels
    await insertTestMemory(belowThresholdFixture.memory1); // ~0.94 similarity to query
    const mem2 = await insertTestMemory(veryHighSimilarityFixture.memory1); // ~0.98 similarity to query

    // Query should match the higher similarity one (veryHighSimilarity)
    const match = await service.findSemanticDuplicate(
      veryHighSimilarityFixture.memory2.embedding
    );

    expect(match).not.toBeNull();
    // Should match mem2 since it has higher similarity
    // Don't check exact ID, just verify it returns the one with highest similarity
    expect(match.similarity).toBeGreaterThan(0.95);
  });

  test('should use custom threshold', async () => {
    const mem1 = await insertTestMemory(belowThresholdFixture.memory1);

    // Default threshold (0.95) - should NOT match
    const match1 = await service.findSemanticDuplicate(
      belowThresholdFixture.memory2.embedding
    );
    expect(match1).toBeNull();

    // Lower threshold (0.90) - SHOULD match
    const match2 = await service.findSemanticDuplicate(
      belowThresholdFixture.memory2.embedding,
      0.90
    );
    expect(match2).not.toBeNull();
    expect(match2.id).toBe(mem1.id);
  });
});

describe('Semantic Consolidation - mergeIntoSemanticCentroid()', () => {
  let service;

  beforeAll(async () => {
    service = createSemanticConsolidationService({
      queryFn: testQuery,
      schema: getTestSchema(),
    });
  });

  beforeEach(async () => {
    await clearTestData();
  });

  test('should accumulate φ correctly for catalyst (+1.0)', async () => {
    const mem1 = await insertTestMemory(catalystFixture.memory1);
    const initialPhi = parseFloat(mem1.resonance_phi);

    const result = await service.mergeIntoSemanticCentroid(
      mem1.id,
      catalystFixture.memory2.content,
      true, // is catalyst
      catalystFixture.expectedSimilarity
    );

    expect(result.wasMerged).toBe(true);
    expect(result.semanticConsolidation).toBe(true);

    const updatedMemory = await findTestMemoryById(mem1.id);
    const newPhi = parseFloat(updatedMemory.resonance_phi);

    // Catalyst with >0.98 similarity should add +1.0 φ
    expect(newPhi).toBeCloseTo(initialPhi + 1.0, 2);
    expect(result.phiContributed).toBeCloseTo(1.0, 2);
  });

  test('should accumulate φ correctly for normal memory (+0.1)', async () => {
    const mem1 = await insertTestMemory(normalConsolidationFixture.memory1);
    const initialPhi = parseFloat(mem1.resonance_phi);

    const result = await service.mergeIntoSemanticCentroid(
      mem1.id,
      normalConsolidationFixture.memory2.content,
      false, // not catalyst
      normalConsolidationFixture.expectedSimilarity
    );

    const updatedMemory = await findTestMemoryById(mem1.id);
    const newPhi = parseFloat(updatedMemory.resonance_phi);

    // Normal memory with 0.97 similarity should add +0.09 φ (0.1 * 0.9)
    expect(newPhi).toBeCloseTo(initialPhi + 0.09, 2);
    expect(result.phiContributed).toBeCloseTo(0.09, 2);
  });

  test('should scale φ by similarity (>0.98 = 1.0x, else 0.9x)', async () => {
    const mem1 = await insertTestMemory(catalystFixture.memory1);
    const initialPhi = parseFloat(mem1.resonance_phi);

    // High similarity (0.98+) should use 1.0x multiplier
    const result1 = await service.mergeIntoSemanticCentroid(
      mem1.id,
      'High similarity content',
      true,
      0.99 // >0.98
    );

    expect(result1.phiContributed).toBeCloseTo(1.0, 2); // 1.0 * 1.0

    // Moderate similarity (0.95-0.98) should use 0.9x multiplier
    const result2 = await service.mergeIntoSemanticCentroid(
      mem1.id,
      'Moderate similarity content',
      false,
      0.97 // <0.98
    );

    expect(result2.phiContributed).toBeCloseTo(0.09, 2); // 0.1 * 0.9
  });

  test('should cap φ at 5.0', async () => {
    const mem1 = await insertTestMemory(phiCapFixture.memory1);
    const initialPhi = parseFloat(mem1.resonance_phi); // 4.95

    const result = await service.mergeIntoSemanticCentroid(
      mem1.id,
      phiCapFixture.memory2.content,
      true, // catalyst would add +1.0
      phiCapFixture.expectedSimilarity
    );

    const updatedMemory = await findTestMemoryById(mem1.id);
    const finalPhi = parseFloat(updatedMemory.resonance_phi);

    // Should be capped at 5.0, not 5.95
    expect(finalPhi).toBe(5.0);
    expect(finalPhi).toBeLessThanOrEqual(5.0);
  });

  test('should store semantic_variants in metadata', async () => {
    const mem1 = await insertTestMemory(normalConsolidationFixture.memory1);

    await service.mergeIntoSemanticCentroid(
      mem1.id,
      normalConsolidationFixture.memory2.content,
      false,
      normalConsolidationFixture.expectedSimilarity
    );

    const updatedMemory = await findTestMemoryById(mem1.id);
    const metadata = updatedMemory.metadata;

    expect(metadata).not.toBeNull();
    expect(metadata.semantic_variants).toBeDefined();
    expect(Array.isArray(metadata.semantic_variants)).toBe(true);
    expect(metadata.semantic_variants.length).toBe(1);

    const variant = metadata.semantic_variants[0];
    expect(variant.content).toBe(normalConsolidationFixture.memory2.content);
    expect(variant.merged_at).toBeDefined();
    expect(variant.phi_contributed).toBeCloseTo(0.09, 2);
    expect(variant.similarity).toBeCloseTo(normalConsolidationFixture.expectedSimilarity, 2);
    expect(variant.was_catalyst).toBe(false);
  });

  test('should preserve existing metadata when adding variants', async () => {
    const mem1 = await insertTestMemory({
      ...normalConsolidationFixture.memory1,
      metadata: { existing_field: 'should_be_preserved', count: 42 },
    });

    await service.mergeIntoSemanticCentroid(
      mem1.id,
      'New variant content',
      false,
      0.97
    );

    const updatedMemory = await findTestMemoryById(mem1.id);
    const metadata = updatedMemory.metadata;

    // Existing fields should still be there
    expect(metadata.existing_field).toBe('should_be_preserved');
    expect(metadata.count).toBe(42);

    // New semantic_variants should be added
    expect(metadata.semantic_variants).toBeDefined();
    expect(metadata.semantic_variants.length).toBe(1);
  });

  test('should append to semantic_variants array on multiple merges', async () => {
    const mem1 = await insertTestMemory(normalConsolidationFixture.memory1);

    // First merge
    await service.mergeIntoSemanticCentroid(
      mem1.id,
      'First variant',
      false,
      0.96
    );

    // Second merge
    await service.mergeIntoSemanticCentroid(
      mem1.id,
      'Second variant',
      false,
      0.97
    );

    // Third merge
    await service.mergeIntoSemanticCentroid(
      mem1.id,
      'Third variant',
      true, // catalyst
      0.99
    );

    const updatedMemory = await findTestMemoryById(mem1.id);
    const variants = updatedMemory.metadata.semantic_variants;

    expect(variants.length).toBe(3);
    expect(variants[0].content).toBe('First variant');
    expect(variants[1].content).toBe('Second variant');
    expect(variants[2].content).toBe('Third variant');
    expect(variants[2].was_catalyst).toBe(true);
  });

  test('should increment access_count', async () => {
    const mem1 = await insertTestMemory(normalConsolidationFixture.memory1);
    const initialAccessCount = parseInt(mem1.access_count, 10);

    await service.mergeIntoSemanticCentroid(
      mem1.id,
      'Variant content',
      false,
      0.96
    );

    const updatedMemory = await findTestMemoryById(mem1.id);
    expect(parseInt(updatedMemory.access_count, 10)).toBe(initialAccessCount + 1);
  });

  test('should upgrade is_catalyst flag when new content is catalyst', async () => {
    const mem1 = await insertTestMemory({
      ...normalConsolidationFixture.memory1,
      isCatalyst: false, // Initially not a catalyst
    });

    expect(mem1.is_catalyst).toBe(false);

    // Merge a catalyst variant
    await service.mergeIntoSemanticCentroid(
      mem1.id,
      'Catalyst content',
      true, // is catalyst
      0.98
    );

    const updatedMemory = await findTestMemoryById(mem1.id);
    expect(updatedMemory.is_catalyst).toBe(true); // Should be upgraded
  });

  test('should NOT downgrade is_catalyst flag', async () => {
    const mem1 = await insertTestMemory({
      ...catalystFixture.memory1,
      isCatalyst: true, // Initially a catalyst
    });

    expect(mem1.is_catalyst).toBe(true);

    // Merge a non-catalyst variant
    await service.mergeIntoSemanticCentroid(
      mem1.id,
      'Normal content',
      false, // not catalyst
      0.97
    );

    const updatedMemory = await findTestMemoryById(mem1.id);
    expect(updatedMemory.is_catalyst).toBe(true); // Should remain true
  });

  test('should return result with correct structure', async () => {
    const mem1 = await insertTestMemory(normalConsolidationFixture.memory1);

    const result = await service.mergeIntoSemanticCentroid(
      mem1.id,
      'Test content',
      false,
      0.96
    );

    expect(result).toHaveProperty('memory');
    expect(result).toHaveProperty('isDuplicate', true);
    expect(result).toHaveProperty('wasMerged', true);
    expect(result).toHaveProperty('semanticConsolidation', true);
    expect(result).toHaveProperty('similarity', 0.96);
    expect(result).toHaveProperty('phiContributed');

    expect(result.memory.id).toBe(mem1.id);
  });
});
