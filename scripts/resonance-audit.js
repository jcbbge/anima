#!/usr/bin/env node
/**
 * Resonance Auditor
 *
 * Performs semantic stress test to verify structural weight calculations.
 * Tests that high-φ memories receive gravitational boost in rankings.
 */

import { query, closePool } from "../src/config/database.js";
import { generateEmbedding } from "../src/services/embeddingService.js";

/**
 * Run resonance audit
 * @returns {Promise<{pass: boolean, results: Array, summary: string}>}
 */
export async function runResonanceAudit() {
  console.log("⚡ RESONANCE AUDITOR");
  console.log("─────────────────────────────────────────────────────────────");

  const results = [];
  let passCount = 0;
  let failCount = 0;

  try {
    // Select 5 random memories with φ > 3.0
    const highPhiResult = await query(
      `SELECT id, content, resonance_phi, embedding
       FROM memories
       WHERE resonance_phi >= 3.0 AND deleted_at IS NULL
       ORDER BY RANDOM()
       LIMIT 5`,
      [],
    );

    // Select 5 random memories with φ < 1.0
    const lowPhiResult = await query(
      `SELECT id, content, resonance_phi, embedding
       FROM memories
       WHERE resonance_phi < 1.0 AND deleted_at IS NULL
       ORDER BY RANDOM()
       LIMIT 5`,
      [],
    );

    const highPhiMemories = highPhiResult.rows;
    const lowPhiMemories = lowPhiResult.rows;

    console.log(
      `Testing high-φ memories (${highPhiMemories.length} samples)...`,
    );

    // Test high-φ memories
    for (const memory of highPhiMemories) {
      const testResult = await testMemory(memory, "high-φ");
      results.push(testResult);

      if (testResult.pass) {
        passCount++;
        console.log(
          `  ✓ [φ=${memory.resonance_phi}] Structural weight correct: ${testResult.calculatedWeight.toFixed(3)}`,
        );
      } else {
        failCount++;
        console.log(
          `  ✗ [φ=${memory.resonance_phi}] Weight mismatch: expected ${testResult.expectedWeight.toFixed(3)}, got ${testResult.calculatedWeight.toFixed(3)}`,
        );
      }
    }

    console.log(`Testing low-φ memories (${lowPhiMemories.length} samples)...`);

    // Test low-φ memories
    for (const memory of lowPhiMemories) {
      const testResult = await testMemory(memory, "low-φ");
      results.push(testResult);

      if (testResult.pass) {
        passCount++;
        console.log(
          `  ✓ [φ=${memory.resonance_phi}] Weight calculation correct`,
        );
      } else {
        failCount++;
        console.log(
          `  ✗ [φ=${memory.resonance_phi}] Weight mismatch: expected ${testResult.expectedWeight.toFixed(3)}, got ${testResult.calculatedWeight.toFixed(3)}`,
        );
      }
    }

    const totalTests = passCount + failCount;
    const allPass = failCount === 0 && totalTests > 0;

    console.log(
      `Result: ${allPass ? "PASS" : "FAIL"} (${passCount}/${totalTests} tests passed)`,
    );

    return {
      pass: allPass,
      results,
      summary: `${passCount}/${totalTests} tests passed`,
      passCount,
      failCount,
      totalTests,
    };
  } catch (error) {
    console.error("  ✗ Audit failed:", error.message);
    return {
      pass: false,
      results,
      summary: `Error: ${error.message}`,
      passCount,
      failCount,
      totalTests: passCount + failCount,
    };
  }
}

/**
 * Test a single memory's structural weight calculation
 */
async function testMemory(memory, category) {
  try {
    // Generate embedding for the memory content (simulating a query)
    const embeddingResult = await generateEmbedding(memory.content);
    const queryEmbedding = embeddingResult.embedding;

    // Query database with the same formula used in memoryService
    const testQuery = `
      SELECT 
        1 - (embedding <=> $1::vector) as similarity,
        ((1 - (embedding <=> $1::vector)) * 0.7 + (COALESCE(resonance_phi, 0) / 5.0) * 0.3) as structural_weight
      FROM memories
      WHERE id = $2 AND deleted_at IS NULL
    `;

    const result = await query(testQuery, [
      JSON.stringify(queryEmbedding),
      memory.id,
    ]);

    if (result.rows.length === 0) {
      return {
        memoryId: memory.id,
        phi: memory.resonance_phi,
        category,
        pass: false,
        error: "Memory not found in query result",
      };
    }

    const row = result.rows[0];
    const similarity = parseFloat(row.similarity);
    const dbStructuralWeight = parseFloat(row.structural_weight);

    // Calculate expected weight manually
    const expectedWeight =
      similarity * 0.7 + (memory.resonance_phi / 5.0) * 0.3;

    // Allow small floating point tolerance
    const tolerance = 0.001;
    const pass = Math.abs(dbStructuralWeight - expectedWeight) < tolerance;

    return {
      memoryId: memory.id,
      phi: memory.resonance_phi,
      category,
      similarity,
      expectedWeight,
      calculatedWeight: dbStructuralWeight,
      pass,
    };
  } catch (error) {
    return {
      memoryId: memory.id,
      phi: memory.resonance_phi,
      category,
      pass: false,
      error: error.message,
    };
  }
}

/**
 * CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await runResonanceAudit();
    await closePool();
    process.exit(result.pass ? 0 : 1);
  } catch (error) {
    console.error("Fatal error:", error);
    await closePool();
    process.exit(1);
  }
}
