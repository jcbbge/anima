/**
 * Test Fixtures for Semantic Consolidation
 *
 * Pre-defined memory data with known embeddings and similarity scores
 * for predictable testing.
 */

import crypto from 'crypto';

/**
 * Generate a hash for content
 */
function generateHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Create a normalized vector (all dimensions same value)
 * Useful for creating vectors with known similarity
 */
function createNormalizedVector(value, dimensions = 768) {
  return Array(dimensions).fill(value);
}

/**
 * Create a vector with specific pattern
 */
function createPatternVector(pattern, dimensions = 768) {
  const vector = [];
  for (let i = 0; i < dimensions; i++) {
    vector.push(pattern[i % pattern.length]);
  }
  return vector;
}

/**
 * Create two vectors with exact cosine similarity
 *
 * @param {number} targetSimilarity - Target cosine similarity (0-1)
 * @param {number} dimensions - Vector dimensions
 * @returns {Array} [vector1, vector2]
 */
function createVectorsWithSimilarity(targetSimilarity, dimensions = 768) {
  // Vector 1: all 1.0
  const vec1 = Array(dimensions).fill(1.0);

  // Vector 2: mix of 1.0 and 0.0 to achieve target similarity
  // Cosine similarity formula: dot(A,B) / (norm(A) * norm(B))
  // If A is all 1.0 and B has k ones and (n-k) zeros:
  // similarity = k / sqrt(n * k) = sqrt(k/n)
  // Therefore: k = similarity^2 * n

  const onesCount = Math.round(targetSimilarity * targetSimilarity * dimensions);
  const vec2 = [
    ...Array(onesCount).fill(1.0),
    ...Array(dimensions - onesCount).fill(0.0)
  ];

  return [vec1, vec2];
}

/**
 * Fixture: Exact duplicate (similarity 1.0)
 */
export const exactDuplicateFixture = {
  memory1: {
    content: 'The quick brown fox jumps over the lazy dog',
    contentHash: generateHash('The quick brown fox jumps over the lazy dog'),
    embedding: createNormalizedVector(0.5),
    resonancePhi: 1.0,
    isCatalyst: false,
  },
  memory2: {
    content: 'The quick brown fox jumps over the lazy dog (duplicate)',
    contentHash: generateHash('The quick brown fox jumps over the lazy dog (duplicate)'),
    embedding: createNormalizedVector(0.5), // Identical embedding
    resonancePhi: 0.0,
    isCatalyst: false,
  },
  expectedSimilarity: 1.0,
};

/**
 * Fixture: Very high similarity (0.98)
 */
export const veryHighSimilarityFixture = (() => {
  const [vec1, vec2] = createVectorsWithSimilarity(0.98);
  return {
    memory1: {
      content: 'Machine learning models require large datasets',
      contentHash: generateHash('Machine learning models require large datasets'),
      embedding: vec1,
      resonancePhi: 1.5,
      isCatalyst: false,
    },
    memory2: {
      content: 'Machine learning models need big datasets',
      contentHash: generateHash('Machine learning models need big datasets'),
      embedding: vec2,
      resonancePhi: 0.0,
      isCatalyst: false,
    },
    expectedSimilarity: 0.98,
  };
})();

/**
 * Fixture: High similarity at threshold (0.95)
 */
export const thresholdSimilarityFixture = (() => {
  const [vec1, vec2] = createVectorsWithSimilarity(0.95);
  return {
    memory1: {
      content: 'PostgreSQL is a powerful relational database',
      contentHash: generateHash('PostgreSQL is a powerful relational database'),
      embedding: vec1,
      resonancePhi: 2.0,
      isCatalyst: true,
    },
    memory2: {
      content: 'PostgreSQL is a robust relational database system',
      contentHash: generateHash('PostgreSQL is a robust relational database system'),
      embedding: vec2,
      resonancePhi: 0.0,
      isCatalyst: false,
    },
    expectedSimilarity: 0.95,
  };
})();

/**
 * Fixture: Just below threshold (0.94)
 */
export const belowThresholdFixture = (() => {
  const [vec1, vec2] = createVectorsWithSimilarity(0.94);
  return {
    memory1: {
      content: 'Neural networks can learn complex patterns',
      contentHash: generateHash('Neural networks can learn complex patterns'),
      embedding: vec1,
      resonancePhi: 1.0,
      isCatalyst: false,
    },
    memory2: {
      content: 'Deep learning identifies intricate patterns',
      contentHash: generateHash('Deep learning identifies intricate patterns'),
      embedding: vec2,
      resonancePhi: 0.0,
      isCatalyst: false,
    },
    expectedSimilarity: 0.94,
  };
})();

/**
 * Fixture: Low similarity (0.50)
 */
export const lowSimilarityFixture = (() => {
  const [vec1, vec2] = createVectorsWithSimilarity(0.50);
  return {
    memory1: {
      content: 'JavaScript is a dynamic programming language',
      contentHash: generateHash('JavaScript is a dynamic programming language'),
      embedding: vec1,
      resonancePhi: 0.5,
      isCatalyst: false,
    },
    memory2: {
      content: 'Elephants are large mammals',
      contentHash: generateHash('Elephants are large mammals'),
      embedding: vec2,
      resonancePhi: 0.0,
      isCatalyst: false,
    },
    expectedSimilarity: 0.50,
  };
})();

/**
 * Fixture: No similarity (0.0)
 */
export const noSimilarityFixture = {
  memory1: {
    content: 'Vector embeddings capture semantic meaning',
    contentHash: generateHash('Vector embeddings capture semantic meaning'),
    embedding: createPatternVector([1.0, 0.0]),
    resonancePhi: 1.0,
    isCatalyst: false,
  },
  memory2: {
    content: 'Orthogonal vectors have zero dot product',
    contentHash: generateHash('Orthogonal vectors have zero dot product'),
    embedding: createPatternVector([0.0, 1.0]),
    resonancePhi: 0.0,
    isCatalyst: false,
  },
  expectedSimilarity: 0.0,
};

/**
 * Fixture: Catalyst memory that should consolidate φ = +1.0
 */
export const catalystFixture = (() => {
  const [vec1, vec2] = createVectorsWithSimilarity(0.98);
  return {
    memory1: {
      content: 'Rapid memory access indicates catalyst',
      contentHash: generateHash('Rapid memory access indicates catalyst'),
      embedding: vec1,
      resonancePhi: 2.0,
      isCatalyst: false,
    },
    memory2: {
      content: 'Rapid memory access suggests catalyst behavior',
      contentHash: generateHash('Rapid memory access suggests catalyst behavior'),
      embedding: vec2,
      resonancePhi: 0.0,
      isCatalyst: true, // This one is a catalyst
    },
    expectedSimilarity: 0.98,
    expectedPhiIncrease: 1.0, // Catalyst should add +1.0 φ
  };
})();

/**
 * Fixture: Normal memory that should consolidate φ = +0.1
 */
export const normalConsolidationFixture = (() => {
  const [vec1, vec2] = createVectorsWithSimilarity(0.97);
  return {
    memory1: {
      content: 'Context windows enable long conversations',
      contentHash: generateHash('Context windows enable long conversations'),
      embedding: vec1,
      resonancePhi: 1.5,
      isCatalyst: false,
    },
    memory2: {
      content: 'Context windows allow extended dialogues',
      contentHash: generateHash('Context windows allow extended dialogues'),
      embedding: vec2,
      resonancePhi: 0.0,
      isCatalyst: false, // Normal memory
    },
    expectedSimilarity: 0.97,
    expectedPhiIncrease: 0.1, // Normal should add +0.1 φ
  };
})();

/**
 * Fixture: Memory at φ cap (should not exceed 5.0)
 */
export const phiCapFixture = (() => {
  const [vec1, vec2] = createVectorsWithSimilarity(0.98);
  return {
    memory1: {
      content: 'This memory is already at phi cap',
      contentHash: generateHash('This memory is already at phi cap'),
      embedding: vec1,
      resonancePhi: 4.95, // Very close to cap
      isCatalyst: false,
    },
    memory2: {
      content: 'This memory would push over the cap',
      contentHash: generateHash('This memory would push over the cap'),
      embedding: vec2,
      resonancePhi: 0.0,
      isCatalyst: true, // Catalyst would add +1.0
    },
    expectedSimilarity: 0.98,
    expectedFinalPhi: 5.0, // Should be capped at 5.0
  };
})();

/**
 * Fixture: Cluster of related memories (for cluster detection)
 */
export const clusterFixture = (() => {
  const baseVec = createNormalizedVector(1.0);
  const [vec2,] = createVectorsWithSimilarity(0.90);
  const [vec3,] = createVectorsWithSimilarity(0.88);
  const [vec4,] = createVectorsWithSimilarity(0.92);

  return {
    memories: [
      {
        content: 'Semantic clustering groups similar concepts',
        contentHash: generateHash('Semantic clustering groups similar concepts'),
        embedding: baseVec,
        resonancePhi: 3.0,
        isCatalyst: false,
      },
      {
        content: 'Semantic grouping organizes related ideas',
        contentHash: generateHash('Semantic grouping organizes related ideas'),
        embedding: vec2,
        resonancePhi: 2.5,
        isCatalyst: false,
      },
      {
        content: 'Concept clustering identifies patterns',
        contentHash: generateHash('Concept clustering identifies patterns'),
        embedding: vec3,
        resonancePhi: 2.0,
        isCatalyst: false,
      },
      {
        content: 'Semantic analysis finds relationships',
        contentHash: generateHash('Semantic analysis finds relationships'),
        embedding: vec4,
        resonancePhi: 2.8,
        isCatalyst: true,
      },
    ],
    expectedClusterSize: 4,
    minSimilarity: 0.85,
  };
})();

// Export helper functions
export {
  generateHash,
  createNormalizedVector,
  createPatternVector,
  createVectorsWithSimilarity,
};

export default {
  exactDuplicateFixture,
  veryHighSimilarityFixture,
  thresholdSimilarityFixture,
  belowThresholdFixture,
  lowSimilarityFixture,
  noSimilarityFixture,
  catalystFixture,
  normalConsolidationFixture,
  phiCapFixture,
  clusterFixture,
};
