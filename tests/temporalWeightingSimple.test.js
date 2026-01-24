/**
 * Temporal Recency Weighting Tests (PRD-005) - Simplified Version
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
      JSON.stringify(Array(768).fill(0.1)),
    ],
  );

  return result.rows[0];
}

async function cleanupTestData() {
  await query(`DELETE FROM memories WHERE content_hash LIKE 'test-hash-%'`);
  await query(
    `DELETE FROM ghost_logs WHERE created_at > NOW() - INTERVAL '1 hour'`,
  );
}

describe("🕰️ Temporal Weighting Tests", () => {
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

    // Create old high-phi memory
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
  });

  test("SQL recency formula should produce correct decay curve", async () => {
    const convId = randomUUID();
    const memory = await insertMemory({
      content: "Test memory for decay validation",
      conversationId: convId,
      resonancePhi: 3.0,
      tier: "thread",
      category: "test",
    });

    // Test 1 day old
    await query(
      `UPDATE memories SET last_accessed = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [memory.id],
    );
    let result = await query(
      `SELECT GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - last_accessed)) / (30 * 86400))) as recency_score
       FROM memories WHERE id = $1`,
      [memory.id],
    );
    expect(parseFloat(result.rows[0].recency_score)).toBeGreaterThan(0.95);

    // Test 30 days old
    await query(
      `UPDATE memories SET last_accessed = NOW() - INTERVAL '30 days' WHERE id = $1`,
      [memory.id],
    );
    result = await query(
      `SELECT GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - last_accessed)) / (30 * 86400))) as recency_score
       FROM memories WHERE id = $1`,
      [memory.id],
    );
    expect(parseFloat(result.rows[0].recency_score)).toBeCloseTo(0.1, 1);
  });

  test("Temporal weighting query should complete quickly", async () => {
    const convId = randomUUID();

    // Insert test memories
    for (let i = 0; i < 20; i++) {
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

  test("Synthesis weight calculation verification", async () => {
    const convId = randomUUID();

    const memory = await insertMemory({
      content: "Weight validation memory",
      conversationId: convId,
      resonancePhi: 3.0,
      category: "test",
    });

    // Get calculated values directly
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
      const phiPart = row.resonance_phi * 2.0 * 0.7; // 2x boost for conversation
      const recencyPart = parseFloat(row.recency_score) * 5.0 * 0.3;
      const expectedWeight = phiPart + recencyPart;

      expect(row.synthesis_weight).toBeCloseTo(expectedWeight, 2);
    }
  });
});
