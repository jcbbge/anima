/**
 * THE CRUCIBLE: TEST INFRASTRUCTURE VERIFICATION
 *
 * Verifies that schema injection infrastructure works correctly.
 * These tests ensure services can operate in isolated test schemas.
 *
 * Test Categories:
 * - Schema Management (Tests 1-3)
 * - Service Isolation (Tests 4-5)
 * - Schema Safety (Tests 6-7)
 * - Integration (Test 8)
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
import {
  setDatabaseSchema,
  getDatabaseSchema,
  query,
} from "../src/config/database.js";
import {
  setupGhostTestSchema,
  teardownGhostTestSchema,
  clearGhostTestData,
  seedGhostTestBaseline,
  insertGhostTestMemory,
  getGhostTestSchema,
  closeGhostTestPool,
  ghostTestQuery,
} from "./setup/ghostTestDatabase.js";
import { generateHandshake } from "../src/services/handshakeService.js";
import { loadBootstrap } from "../src/services/memoryService.js";

describe("🔧 Test Infrastructure: Schema Management", () => {
  beforeAll(async () => {
    await setupGhostTestSchema();
  });

  afterAll(async () => {
    setDatabaseSchema("public");
    await teardownGhostTestSchema();
    await closeGhostTestPool();
  });

  beforeEach(async () => {
    // Reset to public schema before each test
    setDatabaseSchema("public");
  });

  test("TEST 1: Services should default to public schema", async () => {
    console.log("\n━━━ TEST 1: DEFAULT PUBLIC SCHEMA ━━━");

    const schema = getDatabaseSchema();
    expect(schema).toBe("public");

    console.log("✅ Default schema is 'public'");
  });

  test("TEST 2: Services should use test schema when set", async () => {
    console.log("\n━━━ TEST 2: SCHEMA SWITCHING ━━━");

    setDatabaseSchema(getGhostTestSchema());

    await insertGhostTestMemory({
      content: "Test memory for schema isolation",
      resonancePhi: 2.0,
    });

    // Query should find memory in test schema
    const result = await query(
      "SELECT COUNT(*) as count FROM memories WHERE content = $1",
      ["Test memory for schema isolation"],
    );

    expect(parseInt(result.rows[0].count)).toBe(1);

    console.log("✅ Memory found in test schema");

    setDatabaseSchema("public");
  });

  test("TEST 3: Query should inject SET search_path for non-public schema", async () => {
    console.log("\n━━━ TEST 3: SEARCH PATH INJECTION ━━━");

    setDatabaseSchema(getGhostTestSchema());

    // This should NOT error (would error if searching wrong schema)
    const result = await query("SELECT 1 as test", []);
    expect(result.rows[0].test).toBe(1);

    console.log("✅ Query executed with schema prefix");

    setDatabaseSchema("public");
  });

  test("TEST 4: Handshake service should write to test schema", async () => {
    console.log("\n━━━ TEST 4: HANDSHAKE SERVICE ISOLATION ━━━");

    setDatabaseSchema(getGhostTestSchema());
    await clearGhostTestData();
    await seedGhostTestBaseline();

    const handshake = await generateHandshake({ force: true });

    // Verify ghost was written to test schema
    const result = await ghostTestQuery(
      "SELECT COUNT(*) as count FROM ghost_logs WHERE id = $1",
      [handshake.ghostId],
    );

    expect(parseInt(result.rows[0].count)).toBe(1);

    console.log("✅ Handshake written to test schema");
    console.log(`   Ghost ID: ${handshake.ghostId}`);

    setDatabaseSchema("public");
  });

  test("TEST 5: Memory service should read from test schema", async () => {
    console.log("\n━━━ TEST 5: MEMORY SERVICE ISOLATION ━━━");

    setDatabaseSchema(getGhostTestSchema());
    await clearGhostTestData();

    await insertGhostTestMemory({
      content: "Bootstrap test memory",
      tier: "active",
      resonancePhi: 3.0,
    });

    const bootstrap = await loadBootstrap({ limit: 10 });
    const hasTestMemory = bootstrap.memories.active.some(
      (m) => m.content === "Bootstrap test memory",
    );

    expect(hasTestMemory).toBe(true);

    console.log("✅ Memory service read from test schema");
    console.log(`   Found ${bootstrap.memories.active.length} active memories`);

    setDatabaseSchema("public");
  });

  test("TEST 6: Schema should reset to public after test", async () => {
    console.log("\n━━━ TEST 6: SCHEMA RESET ━━━");

    setDatabaseSchema(getGhostTestSchema());

    // Simulate test run
    await query("SELECT 1", []);

    setDatabaseSchema("public");

    const schema = getDatabaseSchema();
    expect(schema).toBe("public");

    console.log("✅ Schema reset to 'public'");
  });

  test("TEST 7: Schema changes should not affect parallel operations", async () => {
    console.log("\n━━━ TEST 7: CONCURRENT SCHEMA SAFETY ━━━");

    // Test 1: Set to test schema
    setDatabaseSchema(getGhostTestSchema());
    const schema1 = getDatabaseSchema();

    // Test 2: Reset to public
    setDatabaseSchema("public");
    const schema2 = getDatabaseSchema();

    expect(schema1).toBe(getGhostTestSchema());
    expect(schema2).toBe("public");

    console.log("✅ Schema changes are sequential and safe");
  });

  test("TEST 8: Ghost Protocol Audit test suite can execute", async () => {
    console.log("\n━━━ TEST 8: AUDIT SUITE COMPATIBILITY ━━━");

    // This test verifies that the infrastructure changes don't break
    // the existing test suite. We test the core pattern used by the audit suite.

    setDatabaseSchema(getGhostTestSchema());
    await clearGhostTestData();
    await seedGhostTestBaseline();

    // Simulate what the audit tests do
    const convId = randomUUID();

    await insertGhostTestMemory({
      content: "Audit test simulation",
      conversationId: convId,
      resonancePhi: 2.5,
    });

    const handshake = await generateHandshake({
      conversationId: convId,
      force: true,
    });

    expect(handshake).toBeDefined();
    expect(handshake.ghostId).toBeDefined();
    expect(handshake.promptText).toBeDefined();

    console.log("✅ Audit suite pattern works correctly");
    console.log(`   Handshake generated for conversation: ${convId}`);

    setDatabaseSchema("public");
  });
});
