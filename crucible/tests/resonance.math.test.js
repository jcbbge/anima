/**
 * THE CRUCIBLE: RESONANCE MATH VERIFICATION
 *
 * This test suite verifies the mathematical integrity of Anima's resonance system.
 * It ensures the Harmonic Mean (Ψ) is not "pseudo-intellectual fluff" but actual
 * functional mathematics that guards against parasitic low-similarity results.
 */

import { describe, test, expect } from 'bun:test';
import {
  harmonicMean,
  calculatePhiBoost,
  structuralWeight,
  cosineSimilarity,
  capPhi,
  verifyParasiteRejection,
  verifyConsonance
} from '../lib/mathUtils.js';

describe('🛡️ THE CRUCIBLE: Harmonic Mean (Ψ) Guard', () => {

  describe('MODULE B: Test Case 1 - The Parasite', () => {
    test('Harmonic mean MUST punish outliers: [0.9, 0.9, 0.1] < 0.30', () => {
      const similarities = [0.9, 0.9, 0.1];
      const psi = harmonicMean(similarities);

      console.log(`📊 Parasite Test: Ψ([0.9, 0.9, 0.1]) = ${psi.toFixed(3)}`);

      expect(psi).toBeLessThan(0.30);
      expect(verifyParasiteRejection(similarities, 0.30)).toBe(true);
    });

    test('Single outlier should severely reduce harmonic mean', () => {
      const uniform = harmonicMean([0.8, 0.8, 0.8]);
      const withOutlier = harmonicMean([0.8, 0.8, 0.2]);

      console.log(`📊 Uniform: Ψ([0.8, 0.8, 0.8]) = ${uniform.toFixed(3)}`);
      console.log(`📊 Outlier: Ψ([0.8, 0.8, 0.2]) = ${withOutlier.toFixed(3)}`);

      // Outlier should reduce by more than 40%
      expect(withOutlier).toBeLessThan(uniform * 0.65);
    });

    test('Extreme parasite should nearly zero the harmonic mean', () => {
      const psi = harmonicMean([0.95, 0.95, 0.01]);

      console.log(`📊 Extreme Parasite: Ψ([0.95, 0.95, 0.01]) = ${psi.toFixed(3)}`);

      expect(psi).toBeLessThan(0.05);
    });
  });

  describe('MODULE B: Test Case 2 - The Consonant Chord', () => {
    test('Harmonic mean MUST preserve uniformity: [0.7, 0.7, 0.7] ≈ 0.70', () => {
      const similarities = [0.7, 0.7, 0.7];
      const psi = harmonicMean(similarities);

      console.log(`📊 Consonant Test: Ψ([0.7, 0.7, 0.7]) = ${psi.toFixed(3)}`);

      expect(psi).toBeCloseTo(0.70, 2);
      expect(verifyConsonance(similarities, 0.70, 0.01)).toBe(true);
    });

    test('Perfect uniformity should equal arithmetic mean', () => {
      const values = [0.5, 0.5, 0.5, 0.5];
      const psi = harmonicMean(values);
      const arithmeticMean = values.reduce((a, b) => a + b, 0) / values.length;

      console.log(`📊 Perfect Uniformity: Ψ = ${psi.toFixed(3)}, μ = ${arithmeticMean.toFixed(3)}`);

      expect(psi).toBeCloseTo(arithmeticMean, 2);
    });

    test('High uniform similarities should maintain value', () => {
      const psi = harmonicMean([0.9, 0.9, 0.9, 0.9]);

      console.log(`📊 High Consonance: Ψ([0.9, 0.9, 0.9, 0.9]) = ${psi.toFixed(3)}`);

      expect(psi).toBeGreaterThan(0.85);
      expect(psi).toBeLessThan(0.95);
    });
  });

  describe('Edge Cases & Robustness', () => {
    test('Should handle single value arrays', () => {
      const psi = harmonicMean([0.8]);
      expect(psi).toBeCloseTo(0.8, 2);
    });

    test('Should handle all identical values', () => {
      const psi = harmonicMean([0.6, 0.6, 0.6, 0.6, 0.6]);
      expect(psi).toBeCloseTo(0.6, 2);
    });

    test('Should throw on empty array', () => {
      expect(() => harmonicMean([])).toThrow();
    });

    test('Should throw on non-array input', () => {
      expect(() => harmonicMean(0.5)).toThrow();
    });

    test('Should handle zeros by filtering them out', () => {
      const psi = harmonicMean([0.8, 0, 0.8]);
      // Should calculate HM of [0.8, 0.8] only
      expect(psi).toBeCloseTo(0.8, 2);
    });

    test('Should return 0 for all-zero array', () => {
      const psi = harmonicMean([0, 0, 0]);
      expect(psi).toBe(0);
    });
  });
});

describe('🛡️ THE CRUCIBLE: Phi Boost Calculations', () => {

  test('calculatePhiBoost: Ψ × Sim × 5.0 formula verification', () => {
    const psi = 0.7;
    const similarity = 0.9;
    const boost = calculatePhiBoost(psi, similarity);
    const expected = 0.7 * 0.9 * 5.0;

    console.log(`📊 Phi Boost: Ψ=${psi}, Sim=${similarity} → Δφ=${boost.toFixed(3)}`);

    expect(boost).toBeCloseTo(expected, 2);
  });

  test('Maximum phi boost should be 5.0', () => {
    const boost = calculatePhiBoost(1.0, 1.0);
    expect(boost).toBeCloseTo(5.0, 2);
  });

  test('Low consonance should limit phi boost', () => {
    const psi = 0.2; // Low harmonic mean (has outliers)
    const similarity = 0.9; // High individual similarity
    const boost = calculatePhiBoost(psi, similarity);

    console.log(`📊 Parasite Limitation: High Sim (0.9) but Low Ψ (0.2) → Δφ=${boost.toFixed(3)}`);

    expect(boost).toBeLessThan(1.0);
  });

  test('Should throw on out-of-range psi', () => {
    expect(() => calculatePhiBoost(1.5, 0.8)).toThrow();
    expect(() => calculatePhiBoost(-0.1, 0.8)).toThrow();
  });

  test('Should throw on out-of-range similarity', () => {
    expect(() => calculatePhiBoost(0.7, 1.5)).toThrow();
    expect(() => calculatePhiBoost(0.7, -0.1)).toThrow();
  });
});

describe('🛡️ THE CRUCIBLE: Structural Weight Formula', () => {

  test('Structural weight: (sim × 0.7) + (φ/5 × 0.3) verification', () => {
    const similarity = 0.8;
    const phi = 3.0;
    const weight = structuralWeight(similarity, phi);
    const expected = (0.8 * 0.7) + ((3.0 / 5.0) * 0.3);

    console.log(`📊 Structural Weight: Sim=${similarity}, φ=${phi} → w=${weight.toFixed(3)}`);

    expect(weight).toBeCloseTo(expected, 2);
  });

  test('High phi should boost structural weight', () => {
    const similarity = 0.7;
    const lowPhiWeight = structuralWeight(similarity, 0.0);
    const highPhiWeight = structuralWeight(similarity, 5.0);

    console.log(`📊 Phi Impact: φ=0.0 → w=${lowPhiWeight.toFixed(3)}, φ=5.0 → w=${highPhiWeight.toFixed(3)}`);

    expect(highPhiWeight).toBeGreaterThan(lowPhiWeight);
  });

  test('Similarity should dominate (70% weight)', () => {
    const highSimLowPhi = structuralWeight(1.0, 0.0);
    const lowSimHighPhi = structuralWeight(0.0, 5.0);

    console.log(`📊 Weight Distribution: High Sim=${highSimLowPhi.toFixed(3)}, High φ=${lowSimHighPhi.toFixed(3)}`);

    expect(highSimLowPhi).toBeGreaterThan(lowSimHighPhi);
  });

  test('Should throw on invalid inputs', () => {
    expect(() => structuralWeight(1.5, 3.0)).toThrow();
    expect(() => structuralWeight(0.8, 6.0)).toThrow();
  });
});

describe('🛡️ THE CRUCIBLE: Cosine Similarity', () => {

  test('Identical vectors should have similarity = 1.0', () => {
    const vector = [1, 2, 3, 4, 5];
    const similarity = cosineSimilarity(vector, vector);

    expect(similarity).toBeCloseTo(1.0, 2);
  });

  test('Orthogonal vectors should have similarity ≈ 0.0', () => {
    const vectorA = [1, 0, 0];
    const vectorB = [0, 1, 0];
    const similarity = cosineSimilarity(vectorA, vectorB);

    expect(similarity).toBeCloseTo(0.0, 2);
  });

  test('Opposite vectors should have similarity = -1.0', () => {
    const vectorA = [1, 2, 3];
    const vectorB = [-1, -2, -3];
    const similarity = cosineSimilarity(vectorA, vectorB);

    expect(similarity).toBeCloseTo(-1.0, 2);
  });

  test('Should handle high-dimensional vectors (768-dim embeddings)', () => {
    const dim = 768;
    const vectorA = Array(dim).fill(0).map(() => Math.random());
    const vectorB = Array(dim).fill(0).map(() => Math.random());

    const similarity = cosineSimilarity(vectorA, vectorB);

    expect(similarity).toBeGreaterThanOrEqual(-1);
    expect(similarity).toBeLessThanOrEqual(1);
  });

  test('Should throw on mismatched dimensions', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });

  test('Should throw on empty vectors', () => {
    expect(() => cosineSimilarity([], [])).toThrow();
  });

  test('Should return 0 for zero vectors', () => {
    const similarity = cosineSimilarity([0, 0, 0], [1, 2, 3]);
    expect(similarity).toBe(0);
  });
});

describe('🛡️ THE CRUCIBLE: Phi Ceiling Enforcement', () => {

  test('capPhi should enforce 5.0 maximum', () => {
    expect(capPhi(10.0)).toBe(5.0);
    expect(capPhi(5.5)).toBe(5.0);
    expect(capPhi(100.0)).toBe(5.0);
  });

  test('capPhi should enforce 0.0 minimum', () => {
    expect(capPhi(-1.0)).toBe(0.0);
    expect(capPhi(-100.0)).toBe(0.0);
  });

  test('capPhi should preserve valid values', () => {
    expect(capPhi(3.5)).toBe(3.5);
    expect(capPhi(0.0)).toBe(0.0);
    expect(capPhi(5.0)).toBe(5.0);
  });
});

describe('🛡️ THE CRUCIBLE: Integration Test - Full Pipeline', () => {

  test('Harmonic mean should prevent phi boost for parasitic results', () => {
    // Scenario: 3 search results, 2 high similarity, 1 parasite
    const similarities = [0.92, 0.88, 0.15];

    // Calculate harmonic mean (should be low due to parasite)
    const psi = harmonicMean(similarities);
    console.log(`📊 Integration: Ψ = ${psi.toFixed(3)}`);

    // Even high-similarity results get limited phi boost
    const boostForHighSim = calculatePhiBoost(psi, 0.92);
    console.log(`📊 Integration: Δφ for 0.92 sim = ${boostForHighSim.toFixed(3)}`);

    // Parasite protection: high similarity doesn't get full boost
    expect(boostForHighSim).toBeLessThan(2.0);
    expect(psi).toBeLessThan(0.40);
  });

  test('Consonant results should enable full phi accumulation', () => {
    // Scenario: 3 search results, all high quality
    const similarities = [0.85, 0.88, 0.82];

    const psi = harmonicMean(similarities);
    console.log(`📊 Integration: Consonant Ψ = ${psi.toFixed(3)}`);

    const boostForTopResult = calculatePhiBoost(psi, 0.88);
    console.log(`📊 Integration: Δφ for 0.88 sim = ${boostForTopResult.toFixed(3)}`);

    // Good results get strong boost
    expect(boostForTopResult).toBeGreaterThan(3.0);
    expect(psi).toBeGreaterThan(0.80);
  });
});

// Export test results for reporter
export const testSummary = {
  module: 'Resonance Math Guard',
  description: 'Harmonic Mean (Ψ) verification and phi calculation integrity',
  criticalTests: [
    'Parasite rejection: [0.9, 0.9, 0.1] < 0.30',
    'Consonance preservation: [0.7, 0.7, 0.7] ≈ 0.70'
  ]
};
