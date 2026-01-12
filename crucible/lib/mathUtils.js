/**
 * THE CRUCIBLE MATH LIBRARY
 * Reference implementation of Anima's mathematical formulas.
 * This serves as the verification standard that the main codebase must meet.
 */

/**
 * Harmonic Mean (Ψ) - The Resonance Guard
 *
 * Formula: Ψ = n / Σ(1/xi)
 *
 * The harmonic mean punishes outliers more severely than arithmetic mean.
 * It's the mathematical defense against "parasitic" low-similarity matches
 * that try to ride alongside high-similarity results.
 *
 * @param {number[]} values - Array of similarity scores (0-1 range)
 * @returns {number} The harmonic mean
 *
 * @example
 * harmonicMean([0.9, 0.9, 0.1]) → 0.245  // Parasite case: pulled down
 * harmonicMean([0.7, 0.7, 0.7]) → 0.700  // Consonant: consistent
 */
export function harmonicMean(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('harmonicMean requires non-empty array');
  }

  // Filter out zeros to prevent division by zero
  const nonZeroValues = values.filter(v => v > 0);

  if (nonZeroValues.length === 0) {
    return 0;
  }

  const n = nonZeroValues.length;
  const sumOfReciprocals = nonZeroValues.reduce((sum, val) => sum + (1 / val), 0);

  return n / sumOfReciprocals;
}

/**
 * Dynamic Phi Boost (Δφ)
 *
 * Formula: Δφ = Ψ × Sim × 5.0
 *
 * Where:
 * - Ψ = Harmonic mean of similarity cluster
 * - Sim = Individual similarity score
 * - 5.0 = Maximum phi value (resonance ceiling)
 *
 * This formula determines how much resonance (φ) to add to a memory
 * based on both its individual similarity and the harmonic quality
 * of the surrounding result set.
 *
 * @param {number} psi - Harmonic mean of the result set (0-1)
 * @param {number} similarity - Individual memory similarity (0-1)
 * @returns {number} The phi boost amount (0-5.0)
 */
export function calculatePhiBoost(psi, similarity) {
  if (psi < 0 || psi > 1) {
    throw new Error('Psi must be in range [0, 1]');
  }
  if (similarity < 0 || similarity > 1) {
    throw new Error('Similarity must be in range [0, 1]');
  }

  return psi * similarity * 5.0;
}

/**
 * Structural Weight - The Current Anima Formula
 *
 * Formula: structural_weight = (similarity × 0.7) + (φ/5.0 × 0.3)
 *
 * This is the EXISTING formula from the codebase (memoryService.js:158-166).
 * It combines semantic similarity (70%) with normalized resonance (30%).
 *
 * NOTE: This is NOT using harmonic mean - it's simple weighted averaging.
 * The Crucible's role is to verify this formula matches the implementation.
 *
 * @param {number} similarity - Semantic similarity (0-1)
 * @param {number} phi - Resonance coefficient (0-5.0)
 * @returns {number} Structural weight (0-1)
 */
export function structuralWeight(similarity, phi) {
  if (similarity < 0 || similarity > 1) {
    throw new Error('Similarity must be in range [0, 1]');
  }
  if (phi < 0 || phi > 5.0) {
    throw new Error('Phi must be in range [0, 5.0]');
  }

  const normalizedPhi = phi / 5.0;
  return (similarity * 0.7) + (normalizedPhi * 0.3);
}

/**
 * Cosine Similarity - Vector Distance Calculation
 *
 * Formula: cos(θ) = (A·B) / (||A|| × ||B||)
 *
 * Where:
 * - A·B = dot product
 * - ||A|| = magnitude of vector A
 * - ||B|| = magnitude of vector B
 *
 * @param {number[]} vectorA - First embedding vector
 * @param {number[]} vectorB - Second embedding vector
 * @returns {number} Cosine similarity (0-1 for normalized vectors)
 */
export function cosineSimilarity(vectorA, vectorB) {
  if (!Array.isArray(vectorA) || !Array.isArray(vectorB)) {
    throw new Error('Both inputs must be arrays');
  }
  if (vectorA.length !== vectorB.length) {
    throw new Error('Vectors must have same dimensions');
  }
  if (vectorA.length === 0) {
    throw new Error('Vectors cannot be empty');
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    magnitudeA += vectorA[i] * vectorA[i];
    magnitudeB += vectorB[i] * vectorB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Phi Cap - Enforce Resonance Ceiling
 *
 * Ensures phi values never exceed 5.0, the maximum resonance.
 *
 * @param {number} phi - Resonance value to cap
 * @returns {number} Capped phi value (0-5.0)
 */
export function capPhi(phi) {
  return Math.min(Math.max(phi, 0), 5.0);
}

/**
 * Verify Threshold - The Parasite Test
 *
 * Verifies that harmonic mean correctly punishes outliers.
 * This is the core test from PRD Section 3, Module B.
 *
 * @param {number[]} similarities - Array of similarity scores
 * @param {number} threshold - Expected maximum value
 * @returns {boolean} True if harmonic mean is below threshold
 */
export function verifyParasiteRejection(similarities, threshold) {
  const psi = harmonicMean(similarities);
  return psi < threshold;
}

/**
 * Verify Consonance - The Chord Test
 *
 * Verifies that harmonic mean preserves consistent values.
 *
 * @param {number[]} similarities - Array of similarity scores
 * @param {number} expectedValue - Expected harmonic mean
 * @param {number} tolerance - Acceptable variance (default: 0.01)
 * @returns {boolean} True if harmonic mean matches expected value
 */
export function verifyConsonance(similarities, expectedValue, tolerance = 0.01) {
  const psi = harmonicMean(similarities);
  return Math.abs(psi - expectedValue) < tolerance;
}
