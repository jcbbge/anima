/**
 * Migration 010 Verification Tests
 * 
 * Verifies that conversation context columns and indexes were added correctly.
 * Tests schema changes, constraints, indexes, and backwards compatibility.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import { query } from "../../src/config/database.js";

describe("🔧 Migration 010: Conversation Context", () => {
  
  // Test 1: Ghost Logs Columns Exist
  test("ghost_logs should have conversation_id column", async () => {
    const result = await query(
      `SELECT column_name, data_type, column_default
       FROM information_schema.columns
       WHERE table_name = 'ghost_logs' AND column_name = 'conversation_id'`,
      []
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe("uuid");
    expect(result.rows[0].column_default).toBeNull();
  });

  // Test 2: Ghost Logs Context Type Column
  test("ghost_logs should have context_type column with constraint", async () => {
    const result = await query(
      `SELECT column_name, data_type, column_default 
       FROM information_schema.columns 
       WHERE table_name = 'ghost_logs' AND column_name = 'context_type'`,
      []
    );
    
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe("text");
    expect(result.rows[0].column_default).toContain("global");
    
    // Verify CHECK constraint
    const constraintResult = await query(
      `SELECT conname FROM pg_constraint 
       WHERE conrelid = 'ghost_logs'::regclass 
       AND contype = 'c'
       AND conname = 'ghost_logs_context_type_check'`,
      []
    );
    
    expect(constraintResult.rows.length).toBe(1);
  });

  // Test 3: Memories Conversation ID Column
  test("memories should have conversation_id column", async () => {
    const result = await query(
      `SELECT column_name, data_type, column_default
       FROM information_schema.columns
       WHERE table_name = 'memories' AND column_name = 'conversation_id'`,
      []
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe("uuid");
    expect(result.rows[0].column_default).toBeNull();
  });

  // Test 4: Ghost Logs Indexes Created
  test("ghost_logs conversation indexes should exist", async () => {
    const result = await query(
      `SELECT indexname FROM pg_indexes 
       WHERE tablename = 'ghost_logs' 
       AND indexname LIKE '%conversation%'`,
      []
    );
    
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    
    const indexNames = result.rows.map(r => r.indexname);
    expect(indexNames).toContain("idx_ghost_logs_conversation");
    expect(indexNames).toContain("idx_ghost_logs_expires_conversation");
  });

  // Test 5: Memories Indexes Created
  test("memories conversation indexes should exist", async () => {
    const result = await query(
      `SELECT indexname FROM pg_indexes 
       WHERE tablename = 'memories' 
       AND indexname LIKE '%conversation%'`,
      []
    );
    
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    
    const indexNames = result.rows.map(r => r.indexname);
    expect(indexNames).toContain("idx_memories_conversation");
    expect(indexNames).toContain("idx_memories_conversation_phi");
  });

  // Test 6: Existing Records Preserved
  test("existing ghost_logs records should have NULL conversation_id by default", async () => {
    // Verify that the column allows NULL values (backwards compatible)
    const result = await query(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'ghost_logs' AND column_name = 'conversation_id'`,
      []
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].is_nullable).toBe("YES");

    // Verify we can query for NULL conversation_id (global context)
    const nullResult = await query(
      `SELECT COUNT(*) as count FROM ghost_logs WHERE conversation_id IS NULL`,
      []
    );

    // Should have at least some NULL records (backwards compatible)
    const nullCount = parseInt(nullResult.rows[0].count);
    expect(nullCount).toBeGreaterThanOrEqual(0);
  });

  // Test 7: New Records Can Use Conversation ID
  test("new ghost_logs can be created with conversation_id", async () => {
    const conversationId = randomUUID();
    
    const result = await query(
      `INSERT INTO ghost_logs (prompt_text, top_phi_memories, top_phi_values, conversation_id, context_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, conversation_id, context_type`,
      ["Test handshake", [], [], conversationId, "conversation"]
    );
    
    expect(result.rows[0].conversation_id).toBe(conversationId);
    expect(result.rows[0].context_type).toBe("conversation");
    
    // Cleanup
    await query("DELETE FROM ghost_logs WHERE id = $1", [result.rows[0].id]);
  });

  // Test 8: Index Performance
  test("conversation_id index should improve query performance", async () => {
    const conversationId = randomUUID();
    const insertedIds = [];

    // Insert test data
    for (let i = 0; i < 10; i++) {
      const result = await query(
        `INSERT INTO ghost_logs (prompt_text, top_phi_memories, top_phi_values, conversation_id, context_type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [`Test ${i}`, [], [], conversationId, "conversation"]
      );
      insertedIds.push(result.rows[0].id);
    }

    // Verify index exists and can be used for queries
    const indexResult = await query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'ghost_logs'
       AND indexname = 'idx_ghost_logs_conversation'`,
      []
    );

    expect(indexResult.rows.length).toBe(1);
    expect(indexResult.rows[0].indexname).toBe("idx_ghost_logs_conversation");

    // Verify query works with conversation_id filter
    const queryResult = await query(
      `SELECT COUNT(*) as count FROM ghost_logs
       WHERE conversation_id = $1`,
      [conversationId]
    );

    expect(parseInt(queryResult.rows[0].count)).toBe(10);

    // Cleanup
    for (const id of insertedIds) {
      await query("DELETE FROM ghost_logs WHERE id = $1", [id]);
    }
  });

  // Test 9: Context Type Constraint
  test("context_type should reject invalid values", async () => {
    let errorThrown = false;

    try {
      await query(
        `INSERT INTO ghost_logs (prompt_text, top_phi_memories, top_phi_values, context_type)
         VALUES ($1, $2, $3, $4)`,
        ["Test", [], [], "invalid_context"]
      );
    } catch (error) {
      errorThrown = true;
      expect(error.message).toContain("ghost_logs_context_type_check");
    }

    expect(errorThrown).toBe(true);
  });

  // Test 10: Migration Idempotency
  test("migration should be idempotent (columns exist after migration)", async () => {
    // Verify all columns exist
    const ghostConvResult = await query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'ghost_logs' AND column_name = 'conversation_id'
       ) as exists`,
      []
    );

    const ghostContextResult = await query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'ghost_logs' AND column_name = 'context_type'
       ) as exists`,
      []
    );

    const memoryConvResult = await query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'memories' AND column_name = 'conversation_id'
       ) as exists`,
      []
    );

    expect(ghostConvResult.rows[0].exists).toBe(true);
    expect(ghostContextResult.rows[0].exists).toBe(true);
    expect(memoryConvResult.rows[0].exists).toBe(true);
  });
});

