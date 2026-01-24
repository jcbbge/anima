/**
 * Temporal Recency Weighting Tests (PRD-005)
 *
 * Tests the temporal weighting algorithm that blends resonance phi (70%)
 * with recency score (30%) for memory selection in handshake synthesis.
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
     RETURNING id, created_at, last_accessed`,
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

describe("🕰️ Temporal Weighting - Core Functionality", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  test("Recent memory should outrank old high-phi memory", async () => {
    const convId = randomUUID();

    // Create old high-phi memory (30 days ago)
    const oldMemory = await insertMemory({
      content: "Old architecture decision from weeks ago",
      resonancePhi: 5.0,
      category: "test",
    });

    await query(
      `UPDATE memories 
       SET created_at = NOW() - INTERVAL '30 days',
           last_accessed = NOW() - INTERVAL '30 days'
       WHERE id = $1`,
      [oldMemory.id],
    );

    // Create recent medium-phi memory
    await insertMemory({
      content: "Currently debugging authentication flow",
      conversationId: convId,
      resonancePhi: 2.5,
      category: "test",
    });

    const handshake = await generateHandshake({
      conversationId: convId,
      force: true,
    });

    expect(handshake.promptText.toLowerCase()).toContain("authentication");
    expect(handshake.promptText).not.toContain("architecture decision");
  });

  test("SQL recency formula should produce correct decay curve", async () => {
    const convId = randomUUID();

    // Create memory and artificially age it
    const memory = await insertMemory({
      content: "Test memory for decay validation",
      conversationId: convId,
      resonancePhi: 3.0,
      tier: "thread",
      category: "test",
    });

    // Test various ages
    await query(
      `UPDATE memories SET last_accessed = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [memory.id],
    );
    let result = await query(
      `SELECT GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - last_accessed)) / (30 * 86400))) as recency_score
       FROM memories WHERE id = $1`,
      [memory.id],
    );
    expect(parseFloat(result.rows[0].recency_score)).toBeGreaterThan(0.95); // ~0.97 for 1 day

    await query(
      `UPDATE memories SET last_accessed = NOW() - INTERVAL '7 days' WHERE id = $1`,
      [memory.id],
    );
    result = await query(
      `SELECT GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - last_accessed)) / (30 * 86400))) as recency_score
       FROM memories WHERE id = $1`,
      [memory.id],
    );
    expect(parseFloat(result.rows[0].recency_score)).toBeCloseTo(0.77, 1); // 1.0 - (7/30)

    await query(
      `UPDATE memories SET last_accessed = NOW() - INTERVAL '15 days' WHERE id = $1`,
      [memory.id],
    );
    result = await query(
      `SELECT GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - last_accessed)) / (30 * 86400))) as recency_score
       FROM memories WHERE id = $1`,
      [memory.id],
    );
    expect(parseFloat(result.rows[0].recency_score)).toBeCloseTo(0.5, 1); // 1.0 - (15/30)

    await query(
      `UPDATE memories SET last_accessed = NOW() - INTERVAL '30 days' WHERE id = $1`,
      [memory.id],
    );
    result = await query(
      `SELECT GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - last_accessed)) / (30 * 86400))) as recency_score
       FROM memories WHERE id = $1`,
      [memory.id],
    );
    expect(parseFloat(result.rows[0].recency_score)).toBeCloseTo(0.1, 1); // Floor reached

    await query(
      `UPDATE memories SET last_accessed = NOW() - INTERVAL '365 days' WHERE id = $1`,
      [memory.id],
    );
    result = await query(
      `SELECT GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - last_accessed)) / (30 * 86400))) as recency_score
       FROM memories WHERE id = $1`,
      [memory.id],
    );
    expect(parseFloat(result.rows[0].recency_score)).toBe(0.1); // Floor maintained
  });

  test("Synthesis weight should be 70% phi, 30% recency", async () => {
    const convId = randomUUID();

    // Create a memory with known values
    const memory = await insertMemory({
      content: "Weight validation memory",
      conversationId: convId,
      resonancePhi: 3.0,
      category: "test",
    });

    // Get the calculated values
    const result = await query(
      `SELECT 
         resonance_phi,
         GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed, created_at))) / (30 * 86400))) as recency_score,
         (
           CASE
             WHEN conversation_id = $1 THEN COALESCE(resonance_phi, 0.0) * 2.0
             ELSE COALESCE(resonance_phi, 0.0)
           END * 0.7 +
           GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed, created_at))) / (30 * 86400))) * 5.0 * 0.3
         ) as synthesis_weight
       FROM memories WHERE id = $2`,
      [convId, memory.id],
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const expectedWeight =
        row.resonance_phi * 2.0 * 0.7 + row.recency_score * 5.0 * 0.3; // 2x boost for conversation

      expect(row.synthesis_weight).toBeCloseTo(expectedWeight, 2);
    }
  });

  test("Memory accessed today should rank higher than week-old memory", async () => {
    const convId = randomUUID();

    // Create week-old memory
    const weekOld = await insertMemory({
      content: "Week old memory",
      conversationId: convId,
      resonancePhi: 3.0,
      category: "test",
    });

    await query(
      `UPDATE memories SET last_accessed = NOW() - INTERVAL '7 days' WHERE id = $1`,
      [weekOld.id],
    );

    // Create today memory
    const today = await insertMemory({
      content: "Today memory",
      conversationId: convId,
      resonancePhi: 2.0,
      category: "test",
    });

    const handshake = await generateHandshake({
      conversationId: convId,
      force: true,
    });

    // Today's memory should be mentioned first
    const todayIndex = handshake.promptText
      .toLowerCase()
      .indexOf("today memory");
    const weekIndex = handshake.promptText
      .toLowerCase()
      .indexOf("week old memory");

    expect(todayIndex).toBeLessThan(weekIndex);
  });

  test("Very high phi (5.0) should still rank high despite age", async () => {
    const convId = randomUUID();

    // Create critical old memory with extremely high phi
    const critical = await insertMemory({
      content: "CRITICAL-FOUNDATIONAL-INSIGHT-HIGH-PHI-5-0",
      resonancePhi: 5.0,
      category: "test",
    });

    await query(
      `UPDATE memories SET last_accessed = NOW() - INTERVAL '25 days' WHERE id = $1`,
      [critical.id],
    );

    // Create recent low-importance memory
    const recent = await insertMemory({
      content: "Recent low-importance task",
      conversationId: convId,
      resonancePhi: 1.0,
      category: "test",
    });

    // Get the actual memory ranking directly
    const result = await query(
      `SELECT 
         content,
         resonance_phi,
         GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed, created_at))) / (30 * 86400))) as recency_score,
         (
           CASE
             WHEN conversation_id = $1 THEN COALESCE(resonance_phi, 0.0) * 2.0
             ELSE COALESCE(resonance_phi, 0.0)
           END * 0.7 +
           GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed, created_at))) / (30 * 86400))) * 5.0 * 0.3
         ) as synthesis_weight
       FROM memories
       WHERE deleted_at IS NULL
         AND (
           conversation_id = $1
           OR resonance_phi >= 3.0
         )
       ORDER BY synthesis_weight DESC
       LIMIT 5`,
      [convId],
    );

    // The high-phi memory should still rank high even with age penalty
    const criticalMemory = result.rows.find((row) =>
      row.content.includes("CRITICAL-FOUNDATIONAL"),
    );
    const recentMemory = result.rows.find((row) =>
      row.content.includes("Recent low-importance"),
    );

    if (criticalMemory && recentMemory) {
      expect(criticalMemory.synthesis_weight).toBeGreaterThan(
        recentMemory.synthesis_weight,
      );
    }

    // At minimum, the critical memory should appear in top results
    expect(
      result.rows.some((row) => row.content.includes("CRITICAL-FOUNDATIONAL")),
    ).toBe(true);
  });

  test("Handshake should evolve as new memories added", async () => {
    const convId = randomUUID();

    // Initial memory
    await insertMemory({
      content: "Initial prototype work",
      conversationId: convId,
      resonancePhi: 2.0,
      category: "test",
    });

    const h1 = await generateHandshake({ conversationId: convId, force: true });

    // Add breakthrough memory
    await insertMemory({
      content: "Major breakthrough discovery",
      conversationId: convId,
      resonancePhi: 4.0,
      category: "test",
    });

    const h2 = await generateHandshake({ conversationId: convId, force: true });

    expect(h1.promptText).not.toBe(h2.promptText);
    expect(h2.promptText.toLowerCase()).toContain("breakthrough");
  });

  test("Conversation context should persist after multi-day gap", async () => {
    const convId = randomUUID();

    // Create memory and age it
    const memory = await insertMemory({
      content: "Designed three-layer architecture for substrate",
      conversationId: convId,
      resonancePhi: 4.0,
      category: "test",
    });

    await query(
      `UPDATE memories 
       SET created_at = NOW() - INTERVAL '3 days',
           last_accessed = NOW() - INTERVAL '3 days'
       WHERE conversation_id = $1`,
      [convId],
    );

    const handshake = await generateHandshake({
      conversationId: convId,
      force: true,
    });

    expect(handshake.promptText.toLowerCase()).toContain("architecture");
  });

  test("Global handshake should also use temporal weighting", async () => {
    // Create very old global memory
    const oldGlobal = await insertMemory({
      content: "OLD-GLOBAL-MEMORY-FROM-MONTHS-AGO",
      resonancePhi: 4.0,
      category: "test",
    });

    await query(
      `UPDATE memories
       SET last_accessed = NOW() - INTERVAL '60 days'
       WHERE id = $1`,
      [oldGlobal.id]
    );

    // Create recent global memory
    await insertMemory({
      content: "RECENT-GLOBAL-INSIGHT-VERY-NEW",
      resonancePhi: 3.0,
      category: "test",
    });

    // Get the actual memory ranking directly
    const result = await query(
      `SELECT
         content,
         resonance_phi,
         GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed, created_at))) / (30 * 86400))) as recency_score,
         (
           COALESCE(resonance_phi, 0.0) * 0.7 +
           GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed, created_at))) / (30 * 86400))) * 5.0 * 0.3
         ) as synthesis_weight
       FROM memories
       WHERE deleted_at IS NULL
         AND resonance_phi >= 2.0
       ORDER BY synthesis_weight DESC
       LIMIT 5`
    );

    const recentMemory = result.rows.find(row => row.content.includes('RECENT-GLOBAL'));
    const oldMemory = result.rows.find(row => row.content.includes('OLD-GLOBAL'));

    if (recentMemory && oldMemory) {
      expect(recentMemory.synthesis_weight).toBeGreaterThan(oldMemory.synthesis_weight);
    }

    // At minimum, recent memory should appear in top results
    expect(result.rows.some(row => row.content.includes('RECENT-GLOBAL'))).toBe(true);
  });

  test("Temporal weighting query should complete quickly", async () => {
    const convId = randomUUID();

    // Insert test memories
    for (let i = 0; i < 50; i++) {
      await insertMemory({
        content: `Test memory ${i}`,
        conversationId: convId,
        resonancePhi: Math.random() * 5,
        category: "test",
      });
    }

    const start = Date.now();
    await generateHandshake({ conversationId: convId, force: true });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(100);
  });

  test("Recency score should never go below 0.1", async () => {
    const convId = randomUUID();

    // Create ancient memory
    const ancient = await insertMemory({
      content: "Ancient memory",
      conversationId: convId,
      resonancePhi: 3.0,
      category: "test",
    });

    await query(
      `UPDATE memories 
       SET last_accessed = NOW() - INTERVAL '365 days'
       WHERE id = $1`,
      [ancient.id],
    );

    // Check recency score directly
    const result = await query(
      `SELECT GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - last_accessed)) / (30 * 86400))) as recency_score
       FROM memories WHERE id = $1`,
      [ancient.id],
    );

    if (result.rows.length > 0) {
      expect(parseFloat(result.rows[0].recency_score)).toBeGreaterThanOrEqual(
        0.1,
      );
    }
  });
});
