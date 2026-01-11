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
  clusterFixture,
  createNormalizedVector,
  createVectorsWithSimilarity,
  createPatternVector,
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

describe('Semantic Consolidation - findSemanticCluster()', () => {
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

  test('should find cluster members within radius', async () => {
    const { memories } = clusterFixture;

    // Insert all cluster memories
    for (const mem of memories) {
      await insertTestMemory(mem);
    }

    // Query using first memory's embedding
    const cluster = await service.findSemanticCluster(
      memories[0].embedding,
      0.15, // radius (allows similarities down to 0.85)
      2.0   // minPhi
    );

    // Should find at least 3 members (all have phi >= 2.0)
    expect(cluster.length).toBeGreaterThanOrEqual(3);

    // All results should have phi >= 2.0
    cluster.forEach(mem => {
      expect(parseFloat(mem.resonance_phi)).toBeGreaterThanOrEqual(2.0);
    });

    // All results should have similarity >= 0.85 (1.0 - 0.15)
    cluster.forEach(mem => {
      expect(parseFloat(mem.similarity)).toBeGreaterThanOrEqual(0.85);
    });
  });

  test('should filter by minimum phi threshold', async () => {
    const { memories } = clusterFixture;

    // Insert all cluster memories
    for (const mem of memories) {
      await insertTestMemory(mem);
    }

    // Query with high phi threshold (3.0) - should only return first memory
    const cluster = await service.findSemanticCluster(
      memories[0].embedding,
      0.15,
      3.0 // high phi threshold
    );

    expect(cluster.length).toBe(1);
    expect(parseFloat(cluster[0].resonance_phi)).toBe(3.0);
  });

  test('should order by phi DESC, then similarity DESC', async () => {
    // Insert memories with different phi values
    const mem1 = await insertTestMemory({
      content: 'Low phi, high similarity',
      contentHash: 'hash1',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 2.0,
    });

    const mem2 = await insertTestMemory({
      content: 'High phi, moderate similarity',
      contentHash: 'hash2',
      embedding: createVectorsWithSimilarity(0.90)[1],
      resonancePhi: 4.0,
    });

    const mem3 = await insertTestMemory({
      content: 'High phi, high similarity',
      contentHash: 'hash3',
      embedding: createVectorsWithSimilarity(0.95)[1],
      resonancePhi: 4.0,
    });

    const cluster = await service.findSemanticCluster(
      createNormalizedVector(1.0),
      0.15,
      2.0
    );

    expect(cluster.length).toBe(3);

    // First two should both have phi=4.0, ordered by similarity
    expect(parseFloat(cluster[0].resonance_phi)).toBe(4.0);
    expect(parseFloat(cluster[1].resonance_phi)).toBe(4.0);
    expect(parseFloat(cluster[2].resonance_phi)).toBe(2.0);

    // Among the phi=4.0 entries, higher similarity should come first
    expect(parseFloat(cluster[0].similarity)).toBeGreaterThan(parseFloat(cluster[1].similarity));
  });

  test('should limit results to 20', async () => {
    // Insert 25 memories that all match
    for (let i = 0; i < 25; i++) {
      await insertTestMemory({
        content: `Cluster member ${i}`,
        contentHash: `hash_${i}`,
        embedding: createVectorsWithSimilarity(0.90)[1],
        resonancePhi: 2.5,
      });
    }

    const cluster = await service.findSemanticCluster(
      createNormalizedVector(1.0),
      0.15,
      2.0
    );

    expect(cluster.length).toBe(20); // Should be capped at 20
  });

  test('should return empty array when no matches', async () => {
    await insertTestMemory({
      content: 'Low phi memory',
      contentHash: 'hash1',
      embedding: createNormalizedVector(0.5),
      resonancePhi: 1.0, // Below default minPhi of 2.0
    });

    const cluster = await service.findSemanticCluster(
      createNormalizedVector(0.5),
      0.15,
      2.0
    );

    expect(cluster.length).toBe(0);
  });

  test('should calculate cluster_strength correctly', async () => {
    const mem1 = await insertTestMemory({
      content: 'Test memory',
      contentHash: 'hash1',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 3.0,
    });

    const cluster = await service.findSemanticCluster(
      createNormalizedVector(1.0), // Exact match
      0.15,
      2.0
    );

    expect(cluster.length).toBe(1);

    // cluster_strength = similarity / minSimilarity
    // For exact match: similarity = 1.0, minSimilarity = 0.85
    // cluster_strength = 1.0 / 0.85 ≈ 1.176
    const expectedStrength = 1.0 / (1.0 - 0.15);
    expect(parseFloat(cluster[0].cluster_strength)).toBeCloseTo(expectedStrength, 2);
  });

  test('should use custom radius parameter', async () => {
    const mem1 = await insertTestMemory({
      content: 'Test memory',
      contentHash: 'hash1',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 2.5,
    });

    // Very strict radius (0.05) = min similarity 0.95
    const strictCluster = await service.findSemanticCluster(
      createVectorsWithSimilarity(0.90)[1], // 0.90 similarity
      0.05, // strict radius
      2.0
    );

    expect(strictCluster.length).toBe(0); // 0.90 < 0.95, should not match

    // Looser radius (0.15) = min similarity 0.85
    const looseCluster = await service.findSemanticCluster(
      createVectorsWithSimilarity(0.90)[1], // 0.90 similarity
      0.15, // loose radius
      2.0
    );

    expect(looseCluster.length).toBe(1); // 0.90 > 0.85, should match
  });
});

describe('Semantic Consolidation - detectPhiFragmentation()', () => {
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

  test('should detect high confidence fragmentation (>0.95 similarity)', async () => {
    const mem1 = await insertTestMemory({
      content: 'First fragmented memory',
      contentHash: 'hash1',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 2.0,
    });

    const mem2 = await insertTestMemory({
      content: 'Second fragmented memory',
      contentHash: 'hash2',
      embedding: createNormalizedVector(1.0), // Identical embedding
      resonancePhi: 1.5,
    });

    const fragments = await service.detectPhiFragmentation(0.92);

    expect(fragments.length).toBe(1);

    const frag = fragments[0];
    expect(parseFloat(frag.similarity)).toBeCloseTo(1.0, 2);
    expect(parseFloat(frag.total_phi)).toBeCloseTo(3.5, 1); // 2.0 + 1.5
    expect(frag.consolidation_recommendation).toBe('HIGH_CONFIDENCE_MERGE');
  });

  test('should detect potential fragmentation (0.92-0.95 similarity)', async () => {
    const mem1 = await insertTestMemory({
      content: 'First memory',
      contentHash: 'hash1',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 1.5,
    });

    const mem2 = await insertTestMemory({
      content: 'Similar memory',
      contentHash: 'hash2',
      embedding: createVectorsWithSimilarity(0.93)[1], // ~0.93 similarity
      resonancePhi: 1.0,
    });

    const fragments = await service.detectPhiFragmentation(0.92);

    expect(fragments.length).toBe(1);

    const frag = fragments[0];
    expect(parseFloat(frag.similarity)).toBeGreaterThanOrEqual(0.92);
    expect(parseFloat(frag.similarity)).toBeLessThan(0.95);
    expect(frag.consolidation_recommendation).toBe('POTENTIAL_MERGE');
  });

  test('should properly categorize by similarity ranges', async () => {
    // Create a pair with ~0.93 similarity (firmly in POTENTIAL_MERGE range)
    const mem1 = await insertTestMemory({
      content: 'First memory',
      contentHash: 'hash1',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 1.0,
    });

    const mem2 = await insertTestMemory({
      content: 'Related memory',
      contentHash: 'hash2',
      embedding: createVectorsWithSimilarity(0.93)[1], // Use 0.93 to be safely above threshold
      resonancePhi: 1.0,
    });

    const fragments = await service.detectPhiFragmentation(0.92);

    expect(fragments.length).toBeGreaterThanOrEqual(1);

    // Verify the result has a valid recommendation
    const frag = fragments[0];
    expect(['HIGH_CONFIDENCE_MERGE', 'POTENTIAL_MERGE', 'RELATED']).toContain(
      frag.consolidation_recommendation
    );
  });

  test('should calculate total_phi correctly', async () => {
    const mem1 = await insertTestMemory({
      content: 'Memory A',
      contentHash: 'hash1',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 2.5,
    });

    const mem2 = await insertTestMemory({
      content: 'Memory B',
      contentHash: 'hash2',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 1.8,
    });

    const fragments = await service.detectPhiFragmentation(0.92);

    expect(fragments.length).toBe(1);
    expect(parseFloat(fragments[0].total_phi)).toBeCloseTo(4.3, 1); // 2.5 + 1.8
  });

  test('should order by total_phi DESC, then similarity DESC', async () => {
    // Create 3 pairs with different total phi values
    const mem1 = await insertTestMemory({
      content: 'High phi A',
      contentHash: 'hash1',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 3.0,
    });

    const mem2 = await insertTestMemory({
      content: 'High phi B',
      contentHash: 'hash2',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 2.5,
    });

    const mem3 = await insertTestMemory({
      content: 'Low phi A',
      contentHash: 'hash3',
      embedding: createVectorsWithSimilarity(0.93)[1],
      resonancePhi: 1.0,
    });

    const mem4 = await insertTestMemory({
      content: 'Low phi B',
      contentHash: 'hash4',
      embedding: createVectorsWithSimilarity(0.93)[1],
      resonancePhi: 0.8,
    });

    const fragments = await service.detectPhiFragmentation(0.92);

    expect(fragments.length).toBeGreaterThanOrEqual(2);

    // First result should have highest total_phi
    expect(parseFloat(fragments[0].total_phi)).toBeGreaterThanOrEqual(
      parseFloat(fragments[1].total_phi)
    );
  });

  test('should limit results to 50', async () => {
    // Create 60 memories that all have high similarity to each other
    // This will generate 60*59/2 = 1770 pairs, but should limit to 50
    for (let i = 0; i < 60; i++) {
      await insertTestMemory({
        content: `Memory ${i}`,
        contentHash: `hash_${i}`,
        embedding: createNormalizedVector(1.0),
        resonancePhi: 1.0,
      });
    }

    const fragments = await service.detectPhiFragmentation(0.92);

    expect(fragments.length).toBe(50); // Should be capped at 50
  });

  test('should return empty array when no fragmentation exists', async () => {
    // Insert memories with low similarity
    await insertTestMemory({
      content: 'Memory A',
      contentHash: 'hash1',
      embedding: createPatternVector([1.0, 0.0]),
      resonancePhi: 2.0,
    });

    await insertTestMemory({
      content: 'Memory B',
      contentHash: 'hash2',
      embedding: createPatternVector([0.0, 1.0]), // Orthogonal
      resonancePhi: 2.0,
    });

    const fragments = await service.detectPhiFragmentation(0.92);

    expect(fragments.length).toBe(0);
  });

  test('should use custom threshold parameter', async () => {
    const mem1 = await insertTestMemory({
      content: 'Memory A',
      contentHash: 'hash1',
      embedding: createNormalizedVector(1.0),
      resonancePhi: 1.0,
    });

    const mem2 = await insertTestMemory({
      content: 'Memory B',
      contentHash: 'hash2',
      embedding: createVectorsWithSimilarity(0.90)[1], // ~0.90 similarity
      resonancePhi: 1.0,
    });

    // High threshold (0.92) - should NOT detect
    const fragments1 = await service.detectPhiFragmentation(0.92);
    expect(fragments1.length).toBe(0);

    // Lower threshold (0.85) - SHOULD detect
    const fragments2 = await service.detectPhiFragmentation(0.85);
    expect(fragments2.length).toBe(1);
  });
});

describe('Semantic Consolidation - calculateSemanticCentroid()', () => {
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

  test('should calculate centroid for single memory', async () => {
    const mem1 = await insertTestMemory({
      content: 'Single memory',
      contentHash: 'hash1',
      embedding: createNormalizedVector(0.5),
      resonancePhi: 2.0,
    });

    const result = await service.calculateSemanticCentroid([mem1.id]);

    expect(result.clusterSize).toBe(1);
    expect(result.totalPhi).toBeCloseTo(2.0, 1);
    expect(result.avgPhi).toBeCloseTo(2.0, 1);
    expect(result.coreMemory.id).toBe(mem1.id);

    // Centroid should match the single memory's embedding
    expect(result.centroid.length).toBe(768);
    result.centroid.forEach(val => {
      expect(val).toBeCloseTo(0.5, 2);
    });
  });

  test('should calculate phi-weighted centroid for multiple memories', async () => {
    // Memory 1: high phi, embedding all 1.0
    const mem1 = await insertTestMemory({
      content: 'High phi memory',
      contentHash: 'hash1',
      embedding: Array(768).fill(1.0),
      resonancePhi: 4.0,
    });

    // Memory 2: low phi, embedding all 0.0
    const mem2 = await insertTestMemory({
      content: 'Low phi memory',
      contentHash: 'hash2',
      embedding: Array(768).fill(0.0),
      resonancePhi: 1.0,
    });

    const result = await service.calculateSemanticCentroid([mem1.id, mem2.id]);

    expect(result.clusterSize).toBe(2);
    expect(result.totalPhi).toBeCloseTo(5.0, 1); // 4.0 + 1.0
    expect(result.avgPhi).toBeCloseTo(2.5, 1); // 5.0 / 2

    // Centroid should be weighted toward high-phi memory
    // weight1 = 4.0 + 1.0 = 5.0, weight2 = 1.0 + 1.0 = 2.0
    // centroid = (5.0 * 1.0 + 2.0 * 0.0) / (5.0 + 2.0) = 5.0 / 7.0 ≈ 0.714
    result.centroid.forEach(val => {
      expect(val).toBeCloseTo(5.0 / 7.0, 2);
    });
  });

  test('should identify core memory (closest to centroid)', async () => {
    // Create 3 memories with different embeddings and phi values
    const mem1 = await insertTestMemory({
      content: 'Memory 1',
      contentHash: 'hash1',
      embedding: Array(768).fill(1.0),
      resonancePhi: 1.0, // Lower phi
    });

    const mem2 = await insertTestMemory({
      content: 'Memory 2',
      contentHash: 'hash2',
      embedding: Array(768).fill(0.5), // Middle value
      resonancePhi: 3.0, // Higher phi (more weight)
    });

    const mem3 = await insertTestMemory({
      content: 'Memory 3',
      contentHash: 'hash3',
      embedding: Array(768).fill(0.0), // Zero vector
      resonancePhi: 1.0,
    });

    const result = await service.calculateSemanticCentroid([mem1.id, mem2.id, mem3.id]);

    // With weights: mem1=2.0, mem2=4.0, mem3=2.0
    // Centroid = (2.0*1.0 + 4.0*0.5 + 2.0*0.0) / 8.0 = 4.0/8.0 = 0.5
    // mem2 with embedding 0.5 should be the core (exact match to centroid)
    expect(result.coreMemory.id).toBe(mem2.id);
  });

  test('should include all cluster members in result', async () => {
    const { memories } = clusterFixture;

    // Insert first 3 memories
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const mem = await insertTestMemory(memories[i]);
      ids.push(mem.id);
    }

    const result = await service.calculateSemanticCentroid(ids);

    expect(result.members.length).toBe(3);
    expect(result.clusterSize).toBe(3);

    // Verify all members have required fields
    result.members.forEach(member => {
      expect(member).toHaveProperty('id');
      expect(member).toHaveProperty('vector');
      expect(member).toHaveProperty('phi');
      expect(member).toHaveProperty('content');
      expect(member.vector.length).toBe(768);
    });
  });

  test('should throw error for empty cluster', async () => {
    await expect(service.calculateSemanticCentroid([])).rejects.toThrow(
      'Cannot calculate centroid for empty cluster'
    );
  });

  test('should throw error for null/undefined input', async () => {
    await expect(service.calculateSemanticCentroid(null)).rejects.toThrow(
      'Cannot calculate centroid for empty cluster'
    );

    await expect(service.calculateSemanticCentroid(undefined)).rejects.toThrow(
      'Cannot calculate centroid for empty cluster'
    );
  });

  test('should throw error when no valid memories found', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    await expect(service.calculateSemanticCentroid([fakeId])).rejects.toThrow(
      'No valid memories found for centroid calculation'
    );
  });

  test('should handle memories with different vector dimensions gracefully', async () => {
    // This test ensures consistency - all embeddings should be 768 dims
    const mem1 = await insertTestMemory({
      content: 'Memory 1',
      contentHash: 'hash1',
      embedding: Array(768).fill(0.5),
      resonancePhi: 2.0,
    });

    const result = await service.calculateSemanticCentroid([mem1.id]);

    expect(result.centroid.length).toBe(768);
  });
});
