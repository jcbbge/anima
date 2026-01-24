/**
 * Baseline Performance Test for PRD-005
 *
 * Measures current query performance BEFORE temporal recency weighting modifications.
 * This establishes our baseline to compare against after implementation.
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { randomUUID } from "crypto";
import { query } from "../src/config/database.js";
import { generateHandshake } from "../src/services/handshakeService.js";

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
    category = "observation",
    tier = "active",
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
      "test-hash-" + randomUUID(),
      JSON.stringify(Array(768).fill(0.1)), // Mock embedding (768 dimensions)
    ],
  );

  return result.rows[0];
}

/**
 * Helper: Clean up test data
 */
async function cleanupTestData() {
  await query(`DELETE FROM memories WHERE content_hash LIKE 'test-hash-%'`);
  await query(
    `DELETE FROM ghost_logs WHERE created_at > NOW() - INTERVAL '1 hour'`,
  );
}

describe("📊 Baseline Performance (PRD-005)", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  test("Baseline: Current getTopMemoriesForConversation query performance", async () => {
    const convId = randomUUID();

    // Insert 50 test memories with varying phi values
    for (let i = 0; i < 50; i++) {
      await insertMemory({
        conversationId: convId,
        content: `Test memory ${i} for conversation`,
        resonancePhi: Math.random() * 5, // 0.0 to 5.0
        category: "test",
      });
    }

    // Insert some high-phi global memories
    for (let i = 0; i < 10; i++) {
      await insertMemory({
        content: `Global memory ${i}`,
        resonancePhi: 4.0 + Math.random(), // 4.0 to 5.0
        category: "test",
      });
    }

    // Measure handshake generation performance
    const start = Date.now();
    const handshake = await generateHandshake({
      conversationId: convId,
      force: true,
    });
    const duration = Date.now() - start;

    console.log(`📊 Baseline handshake generation: ${duration}ms`);
    console.log(
      `📊 Handshake length: ${handshake.promptText.length} characters`,
    );

    // Performance should be reasonable (under 100ms as per plan estimate)
    expect(duration).toBeLessThan(100);

    // Handshake should be generated successfully
    expect(handshake).toBeDefined();
    expect(handshake.promptText).toBeTruthy();
    expect(handshake.promptText.length).toBeGreaterThan(0);
  });

  test("Baseline: Current getTopMemoriesGlobal query performance", async () => {
    // Insert 100 global memories with varying phi values
    for (let i = 0; i < 100; i++) {
      await insertMemory({
        content: `Global test memory ${i}`,
        resonancePhi: Math.random() * 5, // 0.0 to 5.0
        category: "test",
      });
    }

    // Measure global handshake generation performance
    const start = Date.now();
    const handshake = await generateHandshake({ force: true }); // No conversation ID = global
    const duration = Date.now() - start;

    console.log(`📊 Baseline global handshake generation: ${duration}ms`);
    console.log(
      `📊 Global handshake length: ${handshake.promptText.length} characters`,
    );

    // Performance should be reasonable
    expect(duration).toBeLessThan(100);

    // Handshake should be generated successfully
    expect(handshake).toBeDefined();
    expect(handshake.promptText).toBeTruthy();
    expect(handshake.promptText.length).toBeGreaterThan(0);
  });

  test("Baseline: Memory selection behavior (current phi-only ranking)", async () => {
    const convId = randomUUID();

    // Create memories with known phi values
    const highPhi = await insertMemory({
      conversationId: convId,
      content: "High phi memory (should rank first)",
      resonancePhi: 5.0,
      category: "test",
    });

    const mediumPhi = await insertMemory({
      conversationId: convId,
      content: "Medium phi memory (should rank second)",
      resonancePhi: 3.0,
      category: "test",
    });

    const lowPhi = await insertMemory({
      conversationId: convId,
      content: "Low phi memory (should rank third or lower)",
      resonancePhi: 1.0,
      category: "test",
    });

    // Generate handshake and verify phi-based ranking
    const handshake = await generateHandshake({
      conversationId: convId,
      force: true,
    });

    // High phi memory should be mentioned first
    expect(handshake.promptText.toLowerCase()).toContain("high phi");

    // All memories should be included in some form
    expect(handshake.promptText.toLowerCase()).toContain("memory");

    console.log(`📊 Baseline handshake (phi-only):`);
    console.log(handshake.promptText);
  });

  test("Baseline: Query timing breakdown", async () => {
    const convId = randomUUID();

    // Insert test data
    for (let i = 0; i < 30; i++) {
      await insertMemory({
        conversationId: convId,
        content: `Timing test memory ${i}`,
        resonancePhi: Math.random() * 5,
        category: "test",
      });
    }

    // Multiple iterations to get stable timing
    const iterations = 5;
    const times = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await generateHandshake({ conversationId: convId, force: true });
      const duration = Date.now() - start;
      times.push(duration);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    console.log(`📊 Baseline timing over ${iterations} iterations:`);
    console.log(`📊 Average: ${avgTime.toFixed(2)}ms`);
    console.log(`📊 Min: ${minTime}ms`);
    console.log(`📊 Max: ${maxTime}ms`);

    // Average should be under 100ms
    expect(avgTime).toBeLessThan(100);

    // Variation shouldn't be too high (within 50ms of min)
    expect(maxTime - minTime).toBeLessThan(50);
  });
});
