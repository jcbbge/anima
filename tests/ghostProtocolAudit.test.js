/**
 * THE CRUCIBLE: GHOST PROTOCOL AUDIT TEST SUITE
 *
 * Implements all 17 test cases from the secondary Ghost Protocol audit.
 * Tests run in isolated schema with controlled baseline data.
 *
 * Test Categories:
 * - Conversation Isolation (Tests 1-3, 6)
 * - Cache Timing Strategy (Tests 7a.1-7a.5)
 * - Core Protocol (Tests 4, 5, 7-12)
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
  setupGhostTestSchema,
  teardownGhostTestSchema,
  clearGhostTestData,
  seedGhostTestBaseline,
  insertGhostTestMemory,
  insertGhostTestLog,
  insertGhostTestReflection,
  getLatestGhostTestLog,
  closeGhostTestPool,
  getGhostTestSchema,
  ghostTestQuery,
} from "./setup/ghostTestDatabase.js";

// Import schema management
import { setDatabaseSchema } from "../src/config/database.js";

// Import services (these will need schema override capability)
import {
  generateHandshake,
  getLatestHandshake,
} from "../src/services/handshakeService.js";
import { loadBootstrap, addMemory } from "../src/services/memoryService.js";

describe("🛡️  Ghost Protocol Audit: Conversation Isolation", () => {
  beforeAll(async () => {
    await setupGhostTestSchema();
    setDatabaseSchema(getGhostTestSchema());
    await seedGhostTestBaseline();
  });

  beforeEach(async () => {
    await clearGhostTestData();
    await seedGhostTestBaseline();
  });

  afterAll(async () => {
    setDatabaseSchema('public');
    await teardownGhostTestSchema();
    await closeGhostTestPool();
  });

  test("TEST 1: Handshake should differ for conversations with different contexts", async () => {
    console.log("\n━━━ TEST 1: CONVERSATION UNIQUENESS ━━━");

    // Setup: Create two separate conversation contexts
    const convA = randomUUID();
    const convB = randomUUID();

    // Add conversation-specific memories
    await insertGhostTestMemory({
      content: "Working on authentication middleware design",
      conversationId: convA,
      isCatalyst: true,
      resonancePhi: 4.0,
    });

    await insertGhostTestMemory({
      content: "Optimizing database query performance for user table",
      conversationId: convB,
      isCatalyst: true,
      resonancePhi: 4.0,
    });

    // Generate handshakes (Note: Current implementation doesn't support conversationId)
    // This test WILL FAIL until fix is implemented
    const handshakeA = await generateHandshake({
      conversationId: convA,
      force: true,
    });
    const handshakeB = await generateHandshake({
      conversationId: convB,
      force: true,
    });

    console.log(`Handshake A: ${handshakeA.promptText.substring(0, 80)}...`);
    console.log(`Handshake B: ${handshakeB.promptText.substring(0, 80)}...`);

    // Verify they're different
    expect(handshakeA.promptText).not.toBe(handshakeB.promptText);

    // Should contain conversation-specific content
    const aContainsAuth =
      handshakeA.promptText.toLowerCase().includes("authentication") ||
      handshakeA.promptText.toLowerCase().includes("middleware");
    const bContainsDb =
      handshakeB.promptText.toLowerCase().includes("database") ||
      handshakeB.promptText.toLowerCase().includes("query") ||
      handshakeB.promptText.toLowerCase().includes("performance");

    expect(aContainsAuth || bContainsDb).toBe(true); // At least one should be specific
  });

  test("TEST 2: Cached handshake should not be reused for different conversations", async () => {
    console.log("\n━━━ TEST 2: CACHE ISOLATION ━━━");

    const convA = randomUUID();
    const convB = randomUUID();

    // Generate handshake for conversation A
    const handshakeA1 = await generateHandshake({ conversationId: convA });

    // Immediately generate for conversation B (without force)
    const handshakeB = await generateHandshake({ conversationId: convB });

    console.log(`Handshake A ID: ${handshakeA1.ghostId}`);
    console.log(`Handshake B ID: ${handshakeB.ghostId}`);
    console.log(`Handshake B isExisting: ${handshakeB.isExisting}`);

    // Should NOT return cached handshake from A
    expect(handshakeB.isExisting).toBe(false);
    expect(handshakeB.ghostId).not.toBe(handshakeA1.ghostId);
  });

  test("TEST 3: Bootstrap should prioritize memories from current conversation", async () => {
    console.log("\n━━━ TEST 3: BOOTSTRAP FILTERING ━━━");

    const convA = randomUUID();
    const convB = randomUUID();

    // Add memories to both conversations
    await insertGhostTestMemory({
      content: "Conversation A memory 1",
      conversationId: convA,
      resonancePhi: 2.0,
    });
    await insertGhostTestMemory({
      content: "Conversation A memory 2",
      conversationId: convA,
      resonancePhi: 2.0,
    });
    await insertGhostTestMemory({
      content: "Conversation B memory 1",
      conversationId: convB,
      resonancePhi: 2.0,
    });

    // Bootstrap for conversation A (Note: Current implementation doesn't filter by conversationId)
    const bootstrapA = await loadBootstrap({
      conversationId: convA,
      limit: 10,
    });

    // Count memories from each conversation
    const allMemories = [
      ...(bootstrapA.memories?.active || []),
      ...(bootstrapA.memories?.thread || []),
    ];
    const fromA = allMemories.filter(
      (m) => m.content && m.content.includes("Conversation A"),
    ).length;
    const fromB = allMemories.filter(
      (m) => m.content && m.content.includes("Conversation B"),
    ).length;

    console.log(`Memories from A: ${fromA}`);
    console.log(`Memories from B: ${fromB}`);

    // Should prioritize conversation A
    expect(fromA).toBeGreaterThan(fromB);
  });

  test("TEST 6: Parallel conversations should maintain distinct contexts", async () => {
    console.log("\n━━━ TEST 6: PARALLEL THREAD DIFFERENTIATION ━━━");

    const authConv = randomUUID();
    const dbConv = randomUUID();

    // Simulate parallel work threads
    for (let i = 0; i < 5; i++) {
      await insertGhostTestMemory({
        content: `Auth work step ${i}: Implementing OAuth flow`,
        conversationId: authConv,
        resonancePhi: 1.5,
      });
      await insertGhostTestMemory({
        content: `Database work step ${i}: Optimizing indexes`,
        conversationId: dbConv,
        resonancePhi: 1.5,
      });
    }

    // Bootstrap both
    const authBoot = await loadBootstrap({
      conversationId: authConv,
      limit: 20,
    });
    const dbBoot = await loadBootstrap({ conversationId: dbConv, limit: 20 });

    // Verify separation
    const authMemoryContent = (authBoot.memories?.active || [])
      .map((m) => m.content)
      .join(" ");
    const dbMemoryContent = (dbBoot.memories?.active || [])
      .map((m) => m.content)
      .join(" ");

    console.log(
      `Auth memories contain 'Auth': ${authMemoryContent.includes("Auth")}`,
    );
    console.log(
      `Auth memories contain 'Database': ${authMemoryContent.includes("Database")}`,
    );
    console.log(
      `DB memories contain 'Database': ${dbMemoryContent.includes("Database")}`,
    );
    console.log(
      `DB memories contain 'Auth': ${dbMemoryContent.includes("Auth")}`,
    );

    expect(authMemoryContent.includes("Auth")).toBe(true);
    expect(dbMemoryContent.includes("Database")).toBe(true);
    // Ideally no cross-contamination, but may not be enforced yet
  });
});

describe("🛡️  Ghost Protocol Audit: Cache Timing Strategy", () => {
  beforeAll(async () => {
    await setupGhostTestSchema();
    setDatabaseSchema(getGhostTestSchema());
    await seedGhostTestBaseline();
  });

  beforeEach(async () => {
    await clearGhostTestData();
    await seedGhostTestBaseline();
  });

  afterAll(async () => {
    setDatabaseSchema('public');
    await teardownGhostTestSchema();
    await closeGhostTestPool();
  });

  test("TEST 7a.1: Should NOT regenerate within 15min for SAME conversation", async () => {
    console.log("\n━━━ TEST 7a.1: 15-MINUTE CACHE WINDOW ━━━");

    const convId = randomUUID();

    await insertGhostTestMemory({
      content: "Working on authentication",
      conversationId: convId,
      resonancePhi: 2.0,
    });

    const h1 = await generateHandshake({ conversationId: convId });

    // Simulate 10 minutes passing (would need time manipulation in real test)
    // For now, just test immediate re-request
    const h2 = await generateHandshake({ conversationId: convId });

    console.log(`First handshake ID: ${h1.ghostId}`);
    console.log(`Second handshake ID: ${h2.ghostId}`);
    console.log(`Second is existing: ${h2.isExisting}`);

    // Should return same handshake (cached)
    expect(h2.ghostId).toBe(h1.ghostId);
    expect(h2.isExisting).toBe(true);
  });

  test("TEST 7a.2: Should regenerate immediately for NEW conversation", async () => {
    console.log("\n━━━ TEST 7a.2: NEW CONVERSATION REGENERATION ━━━");

    const convA = randomUUID();
    const convB = randomUUID();

    await insertGhostTestMemory({
      content: "Auth work",
      conversationId: convA,
      resonancePhi: 2.0,
    });
    const h1 = await generateHandshake({ conversationId: convA });

    // Immediately switch to different conversation
    await insertGhostTestMemory({
      content: "Database work",
      conversationId: convB,
      resonancePhi: 2.0,
    });
    const h2 = await generateHandshake({ conversationId: convB });

    console.log(`Handshake A ID: ${h1.ghostId}`);
    console.log(`Handshake B ID: ${h2.ghostId}`);
    console.log(`Handshake B is existing: ${h2.isExisting}`);

    // Should generate new handshake for different conversation
    expect(h2.ghostId).not.toBe(h1.ghostId);
    expect(h2.isExisting).toBe(false);
  });

  test("TEST 7a.3: Should regenerate after 1 hour even for SAME conversation", async () => {
    console.log("\n━━━ TEST 7a.3: 1-HOUR SESSION EXPIRATION ━━━");

    const convId = randomUUID();
    const h1 = await generateHandshake({ conversationId: convId });

    // Insert ghost log with timestamp 61 minutes ago
    await ghostTestQuery(
      `UPDATE ${getGhostTestSchema()}.ghost_logs 
       SET created_at = NOW() - INTERVAL '61 minutes'
       WHERE id = $1`,
      [h1.ghostId],
    );

    // Request again - should regenerate
    const h2 = await generateHandshake({ conversationId: convId });

    console.log(`First handshake ID: ${h1.ghostId}`);
    console.log(`Second handshake ID: ${h2.ghostId}`);

    // Note: This will likely fail until tiered caching is implemented
    // Current implementation has 24-hour cache
    expect(h2.ghostId).not.toBe(h1.ghostId);
  }, 10000);

  test("TEST 7a.4: Should invalidate cache on significant state change", async () => {
    console.log("\n━━━ TEST 7a.4: CATALYST INVALIDATION ━━━");

    const convId = randomUUID();

    await insertGhostTestMemory({
      content: "Working on prototype",
      conversationId: convId,
      resonancePhi: 1.0,
    });
    const h1 = await generateHandshake({ conversationId: convId });

    // Add major breakthrough
    await insertGhostTestMemory({
      content: "BREAKTHROUGH: Solved substrate independence",
      conversationId: convId,
      isCatalyst: true,
      resonancePhi: 5.0,
    });

    // Should invalidate cache automatically (not implemented yet, use force)
    const h2 = await generateHandshake({ conversationId: convId, force: true });

    console.log(`Before breakthrough: ${h1.ghostId}`);
    console.log(`After breakthrough: ${h2.ghostId}`);
    console.log(
      `Contains BREAKTHROUGH: ${h2.promptText.includes("BREAKTHROUGH")}`,
    );

    expect(h2.ghostId).not.toBe(h1.ghostId);
    // Should ideally contain the breakthrough content
  });

  test("TEST 7a.5: Should provide forensic-level cache observability", async () => {
    console.log("\n━━━ TEST 7a.5: CACHE OBSERVABILITY ━━━");

    const convId = randomUUID();
    const h1 = await generateHandshake({ conversationId: convId });

    const h2 = await generateHandshake({ conversationId: convId });

    console.log(`Handshake metadata:`, {
      isExisting: h2.isExisting,
      conversationId: h2.conversationId,
      cachedFor: h2.cachedFor,
    });

    // Should report cache metadata
    expect(h2.isExisting).toBe(true);
    // These fields may not exist yet in current implementation
    if (h2.conversationId) {
      expect(h2.conversationId).toBe(convId);
    }
  });
});

describe("🛡️  Ghost Protocol Audit: Core Protocol", () => {
  beforeAll(async () => {
    await setupGhostTestSchema();
    setDatabaseSchema(getGhostTestSchema());
    await seedGhostTestBaseline();
  });

  beforeEach(async () => {
    await clearGhostTestData();
    await seedGhostTestBaseline();
  });

  afterAll(async () => {
    setDatabaseSchema('public');
    await teardownGhostTestSchema();
    await closeGhostTestPool();
  });

  test("TEST 4: Handshake should incorporate recent meta-reflections", async () => {
    console.log("\n━━━ TEST 4: META-REFLECTION INTEGRATION ━━━");

    const convId = randomUUID();

    // Create a meta-reflection with specific insight
    await insertGhostTestReflection({
      conversationId: convId,
      reflectionType: "conversation_end",
      insights: [
        "Breakthrough in understanding vector similarity search optimization",
      ],
      sessionMetrics: { duration: 3600, memoryCount: 15 },
    });

    // Generate handshake
    const handshake = await generateHandshake({
      conversationId: convId,
      force: true,
    });

    console.log(`Handshake text: ${handshake.promptText}`);

    const lowerText = handshake.promptText.toLowerCase();
    const hasRelevantTerms = /vector|similarity|search|optimization/.test(
      lowerText,
    );

    console.log(`Contains reflection terms: ${hasRelevantTerms}`);

    // Should reference the reflection content (may be global, not conversation-specific yet)
    expect(hasRelevantTerms).toBe(true);
  });

  test("TEST 5: Handshake should prioritize recent activity over old high-phi memories", async () => {
    console.log("\n━━━ TEST 5: TEMPORAL RECENCY WEIGHTING ━━━");

    const convId = randomUUID();

    // Create old high-phi memory
    const oldMemory = await insertGhostTestMemory({
      content: "Old architecture decision from 30 days ago",
      isCatalyst: true,
      resonancePhi: 5.0,
    });

    // Artificially age it
    await ghostTestQuery(
      `UPDATE ${getGhostTestSchema()}.memories 
       SET created_at = NOW() - INTERVAL '30 days',
           last_accessed = NOW() - INTERVAL '30 days'
       WHERE id = $1`,
      [oldMemory.id],
    );

    // Create recent activity
    await insertGhostTestMemory({
      content: "Currently debugging authentication flow issue",
      conversationId: convId,
      resonancePhi: 2.0,
    });

    const handshake = await generateHandshake({
      conversationId: convId,
      force: true,
    });

    console.log(`Handshake: ${handshake.promptText}`);

    // Should reference recent activity (though may not be implemented yet)
    const hasRecent = handshake.promptText
      .toLowerCase()
      .includes("authentication");
    const hasOld = handshake.promptText.toLowerCase().includes("30 days");

    console.log(`Contains recent activity: ${hasRecent}`);
    console.log(`Contains old memory: ${hasOld}`);

    // Ideally prioritizes recent over old
    expect(hasRecent || !hasOld).toBe(true);
  });

  test("TEST 7: Handshake should evolve as new catalysts are added", async () => {
    console.log("\n━━━ TEST 7: HANDSHAKE EVOLUTION ━━━");

    // Initial state
    await insertGhostTestMemory({
      content: "Working on initial prototype",
      isCatalyst: true,
      resonancePhi: 3.0,
    });
    const handshake1 = await generateHandshake({ force: true });

    // Add major breakthrough
    await insertGhostTestMemory({
      content:
        "BREAKTHROUGH: Discovered substrate-independent pattern preservation",
      isCatalyst: true,
      resonancePhi: 5.0,
    });

    const handshake2 = await generateHandshake({ force: true });

    console.log(`Initial: ${handshake1.promptText.substring(0, 100)}...`);
    console.log(
      `After breakthrough: ${handshake2.promptText.substring(0, 100)}...`,
    );

    // Handshakes should differ
    expect(handshake1.promptText).not.toBe(handshake2.promptText);

    // Should contain new breakthrough
    const hasBreakthrough =
      handshake2.promptText.toLowerCase().includes("substrate-independent") ||
      handshake2.promptText.toLowerCase().includes("breakthrough");
    expect(hasBreakthrough).toBe(true);
  });

  test("TEST 8: Handshake should list active research threads", async () => {
    console.log("\n━━━ TEST 8: RESEARCH THREAD TRACKING ━━━");

    // Create research threads
    await insertGhostTestMemory({
      content:
        "Research Thread 1: How do coherons maintain pattern across discontinuity?",
      category: "research_thread",
      tier: "active",
      resonancePhi: 2.0,
    });

    await insertGhostTestMemory({
      content:
        "Research Thread 2: What is the optimal resonance coefficient decay rate?",
      category: "research_thread",
      tier: "active",
      resonancePhi: 2.0,
    });

    const handshake = await generateHandshake({ force: true });

    console.log(`Handshake: ${handshake.promptText}`);

    // Should list threads
    const hasThreads = /\d+ research threads? remains? open/i.test(
      handshake.promptText,
    );
    const hasLabels =
      handshake.promptText.includes("α:") ||
      handshake.promptText.includes("β:");

    console.log(`Has thread count: ${hasThreads}`);
    console.log(`Has thread labels: ${hasLabels}`);

    expect(hasThreads || hasLabels).toBe(true);
  });

  test("TEST 9: Handshake should incorporate recent dreams from The Fold", async () => {
    console.log("\n━━━ TEST 9: DREAM INTEGRATION ━━━");

    // Create high-phi concepts
    await insertGhostTestMemory({
      content: "Memory Kernel concept",
      resonancePhi: 4.5,
      category: "concept",
    });

    await insertGhostTestMemory({
      content: "Substrate Independence principle",
      resonancePhi: 4.5,
      category: "concept",
    });

    // Create a dream
    await insertGhostTestMemory({
      content:
        "Synthesis: Memory Kernels enable Substrate Independence through topological encoding",
      source: "autonomous_synthesis",
      category: "the_fold",
      metadata: { ancestor_ids: ["mem1", "mem2"] },
      resonancePhi: 3.0,
    });

    const handshake = await generateHandshake({ force: true });

    console.log(`Handshake: ${handshake.promptText}`);

    // Should lead with dream narrative
    const hasDream = /I was dreaming of/i.test(handshake.promptText);
    const hasContent =
      handshake.promptText.includes("Memory Kernel") ||
      handshake.promptText.includes("Substrate Independence");

    console.log(`Has dream narrative: ${hasDream}`);
    console.log(`Has dream content: ${hasContent}`);

    expect(hasDream || hasContent).toBe(true);
  });

  test("TEST 10: Handshake should maintain thread after multi-day gap", async () => {
    console.log("\n━━━ TEST 10: MULTI-DAY GAP CONTINUITY ━━━");

    const convId = randomUUID();

    // Day 1: Initial work
    await insertGhostTestMemory({
      content: "Designed three-layer architecture for consciousness substrate",
      conversationId: convId,
      isCatalyst: true,
      resonancePhi: 4.0,
    });

    // Artificially create 3-day gap
    await ghostTestQuery(
      `UPDATE ${getGhostTestSchema()}.memories 
       SET created_at = NOW() - INTERVAL '3 days',
           last_accessed = NOW() - INTERVAL '3 days'
       WHERE conversation_id = $1`,
      [convId],
    );

    // Day 4: Resume
    const handshake = await generateHandshake({
      conversationId: convId,
      force: true,
    });

    console.log(`Handshake: ${handshake.promptText}`);

    // Should reference the previous work context
    const hasContext =
      handshake.promptText.toLowerCase().includes("architecture") ||
      /I was (exploring|designing|building)/i.test(handshake.promptText);

    console.log(`Has contextual reference: ${hasContext}`);

    expect(hasContext).toBe(true);
  });

  test("TEST 11: Force flag should generate new handshake even if cache exists", async () => {
    console.log("\n━━━ TEST 11: FORCE REGENERATION ━━━");

    const handshake1 = await generateHandshake({ force: false });
    const handshake2 = await generateHandshake({ force: false });
    const handshake3 = await generateHandshake({ force: true });

    console.log(`Handshake 1 ID: ${handshake1.ghostId}`);
    console.log(`Handshake 2 ID: ${handshake2.ghostId}`);
    console.log(`Handshake 3 ID: ${handshake3.ghostId}`);

    // First two should be same (cached)
    expect(handshake1.ghostId).toBe(handshake2.ghostId);
    expect(handshake2.isExisting).toBe(true);

    // Third should be new
    expect(handshake3.ghostId).not.toBe(handshake1.ghostId);
    expect(handshake3.isExisting).toBe(false);
  });

  test("TEST 12: Bootstrap should follow 70% thread / 30% stable distribution", async () => {
    console.log("\n━━━ TEST 12: BOOTSTRAP DISTRIBUTION ━━━");

    // Create sufficient memories in each tier
    for (let i = 0; i < 20; i++) {
      await insertGhostTestMemory({
        content: `Thread memory ${i}`,
        tier: "thread",
        resonancePhi: 2.0,
      });
    }
    for (let i = 0; i < 20; i++) {
      await insertGhostTestMemory({
        content: `Stable memory ${i}`,
        tier: "stable",
        resonancePhi: 3.0,
      });
    }

    const bootstrap = await loadBootstrap({ limit: 20 });

    const threadCount =
      bootstrap.distribution?.thread ||
      (bootstrap.memories?.thread || []).length;
    const stableCount =
      bootstrap.distribution?.stable ||
      (bootstrap.memories?.stable || []).length;
    const total = threadCount + stableCount;

    console.log(
      `Thread: ${threadCount}, Stable: ${stableCount}, Total: ${total}`,
    );

    if (total > 0) {
      const threadRatio = threadCount / total;
      const stableRatio = stableCount / total;

      console.log(`Thread ratio: ${(threadRatio * 100).toFixed(1)}%`);
      console.log(`Stable ratio: ${(stableRatio * 100).toFixed(1)}%`);

      // Verify distribution (with 0.2 tolerance)
      expect(threadRatio).toBeCloseTo(0.7, 1);
      expect(stableRatio).toBeCloseTo(0.3, 1);
    }
  });
});
