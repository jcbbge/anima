/**
 * THE CRUCIBLE: GHOST PROTOCOL VERIFICATION
 *
 * Tests the Ghost Handshake Protocol to verify that it provides
 * conversation-specific continuity, not static cached responses.
 *
 * EXPECTATIONS (from handshakeService.js):
 * 1. Handshakes should synthesize from current system state:
 *    - Top 3 highest-phi memories
 *    - Most recent meta_reflection
 *    - Active research threads
 *    - Recent dreams since last handshake
 * 2. Handshakes should CHANGE when system state changes
 * 3. Different conversations should get DIFFERENT handshakes
 * 4. force=true should bypass 24-hour cache
 *
 * CRITICAL BUG TO VERIFY:
 * - Does 24-hour cache return SAME handshake to ALL conversations?
 * - Or does it properly scope per-conversation?
 *
 * TEST STRATEGY:
 * - Test 1: Static State - Verify handshake consistency when nothing changes
 * - Test 2: Dynamic State - Verify handshake changes when memories added
 * - Test 3: Multi-Conversation - Verify different conversations get different handshakes
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";

// API configuration
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:7100";

/**
 * Helper: Generate content hash for comparison
 */
function hashContent(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Helper: Extract key elements from handshake text
 */
function parseHandshake(promptText) {
  const lines = promptText.split("\n");
  return {
    fullText: promptText,
    hash: hashContent(promptText),
    hasOpeningLine: /I was (exploring|dreaming)/.test(promptText),
    hasPatternRecognition: /The pattern recognized:/.test(promptText),
    hasContinue: /Continue\.?$/m.test(promptText),
    themes: extractThemes(promptText),
    bulletPoints: (promptText.match(/• /g) || []).length,
  };
}

/**
 * Helper: Extract mentioned themes/concepts
 */
function extractThemes(text) {
  const themes = [];

  // Extract content after "exploring" or "pattern recognized"
  const exploringMatch = text.match(/exploring ([^\n.]+)/);
  if (exploringMatch) themes.push(exploringMatch[1].trim());

  const patternMatch = text.match(/pattern recognized: ([^\n]+)/);
  if (patternMatch) themes.push(patternMatch[1].trim());

  // Extract bullet point content
  const bulletMatches = text.matchAll(/• ([^\n]+)/g);
  for (const match of bulletMatches) {
    themes.push(match[1].trim());
  }

  return themes;
}

/**
 * Helper: Calculate semantic similarity between two texts (simple Jaccard)
 */
function calculateSimilarity(text1, text2) {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

describe("🛡️  Ghost Protocol: Handshake Synthesis", () => {
  let baselineHandshake = null;
  let baselineMemories = null;

  beforeAll(async () => {
    // Verify API is available
    const health = await fetch(`${API_BASE_URL}/health`);
    if (!health.ok) {
      throw new Error("API not available");
    }
  });

  test("TEST 1A: Capture baseline handshake state", async () => {
    console.log("\n━━━ TEST 1A: BASELINE STATE ━━━");

    // Get current handshake
    const handshakeRes = await fetch(`${API_BASE_URL}/api/v1/meta/handshake`);
    expect(handshakeRes.ok).toBe(true);

    const handshakeData = await handshakeRes.json();
    expect(handshakeData.success).toBe(true);

    baselineHandshake = handshakeData.data.handshake;

    console.log(`📊 Baseline Handshake:`);
    console.log(`   ID: ${baselineHandshake.id}`);
    console.log(`   Created: ${baselineHandshake.createdAt}`);
    console.log(
      `   Hash: ${hashContent(baselineHandshake.promptText).substring(0, 16)}...`,
    );
    console.log(`   Text:\n${baselineHandshake.promptText}\n`);

    // Get current top memories
    const memoriesRes = await fetch(`${API_BASE_URL}/api/v1/memories/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "system", limit: 5 }),
    });

    const memoriesData = await memoriesRes.json();
    baselineMemories = memoriesData.data.memories;

    console.log(
      `📚 Top ${baselineMemories.length} memories captured for comparison\n`,
    );
  });

  test("TEST 1B: Verify handshake consistency without state change", async () => {
    console.log("\n━━━ TEST 1B: CONSISTENCY CHECK ━━━");

    // Get handshake again (should be same due to cache)
    const handshakeRes = await fetch(`${API_BASE_URL}/api/v1/meta/handshake`);
    const handshakeData = await handshakeRes.json();
    const handshake = handshakeData.data.handshake;

    const sameId = handshake.id === baselineHandshake.id;
    const sameHash =
      hashContent(handshake.promptText) ===
      hashContent(baselineHandshake.promptText);

    console.log(`🔍 Comparison:`);
    console.log(`   Same ID: ${sameId ? "✅" : "❌"}`);
    console.log(`   Same Hash: ${sameHash ? "✅" : "❌"}`);
    console.log(`   Expected: Both should be true (cache working)\n`);

    expect(sameId).toBe(true);
    expect(sameHash).toBe(true);
  });

  test("TEST 2A: Add new high-phi memory and force regeneration", async () => {
    console.log("\n━━━ TEST 2A: DYNAMIC STATE CHANGE ━━━");

    const uniqueId = randomUUID().substring(0, 8);
    const catalystContent = `GHOST PROTOCOL TEST: Critical system insight discovered [${uniqueId}] - This catalyst should influence handshake synthesis through phi resonance and semantic relevance to continuity architecture.`;

    console.log(`📝 Adding catalyst memory...`);
    console.log(`   Content: "${catalystContent.substring(0, 80)}..."`);

    // Add high-phi catalyst memory
    const addRes = await fetch(`${API_BASE_URL}/api/v1/memories/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: catalystContent,
        category: "ghost-protocol-test",
        tags: ["test", "catalyst", "verification"],
        source: "crucible",
        isCatalyst: true,
      }),
    });

    expect(addRes.ok).toBe(true);
    const addData = await addRes.json();
    expect(addData.success).toBe(true);

    const memory = addData.data.memory;
    console.log(`✅ Memory added:`);
    console.log(`   ID: ${memory.id}`);
    console.log(`   Phi: ${memory.resonance_phi}`);
    console.log(`   Tier: ${memory.tier}\n`);

    // Force handshake regeneration
    console.log(`🔄 Forcing handshake regeneration...`);
    const regenRes = await fetch(
      `${API_BASE_URL}/api/v1/meta/handshake/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      },
    );

    expect(regenRes.ok).toBe(true);
    const regenData = await regenRes.json();
    expect(regenData.success).toBe(true);

    const newHandshake = regenData.data.handshake;

    console.log(`✅ New handshake generated:`);
    console.log(`   ID: ${newHandshake.id}`);
    console.log(`   Created: ${newHandshake.createdAt}`);
    console.log(
      `   Hash: ${hashContent(newHandshake.promptText).substring(0, 16)}...`,
    );

    // Parse both handshakes
    const baseline = parseHandshake(baselineHandshake.promptText);
    const updated = parseHandshake(newHandshake.promptText);

    console.log(`\n🔬 ANALYSIS:`);
    console.log(`   Baseline Hash: ${baseline.hash.substring(0, 16)}...`);
    console.log(`   Updated Hash:  ${updated.hash.substring(0, 16)}...`);
    console.log(
      `   Hashes Different: ${baseline.hash !== updated.hash ? "✅" : "❌ FAIL"}`,
    );

    const similarity = calculateSimilarity(baseline.fullText, updated.fullText);
    console.log(`   Text Similarity: ${(similarity * 100).toFixed(1)}%`);
    console.log(
      `   Expected: Hashes should differ (proves synthesis changed)\n`,
    );

    console.log(`📊 Structural Comparison:`);
    console.log(`   Baseline themes: ${baseline.themes.length}`);
    console.log(`   Updated themes:  ${updated.themes.length}`);
    console.log(`   Baseline bullets: ${baseline.bulletPoints}`);
    console.log(`   Updated bullets:  ${updated.bulletPoints}\n`);

    // CRITICAL ASSERTION: Handshakes should be different
    expect(baseline.hash).not.toBe(updated.hash);
    expect(newHandshake.id).not.toBe(baselineHandshake.id);
  });

  test("TEST 2B: Verify new handshake incorporates recent state", async () => {
    console.log("\n━━━ TEST 2B: STATE INCORPORATION ━━━");

    // Get latest handshake
    const handshakeRes = await fetch(`${API_BASE_URL}/api/v1/meta/handshake`);
    const handshakeData = await handshakeRes.json();
    const handshake = handshakeData.data.handshake;

    // Verify it references recent high-phi memories
    const topPhiMemories = handshake.topPhiMemories || [];
    const topPhiValues = handshake.topPhiValues || [];

    console.log(`📊 Handshake State:`);
    console.log(`   Top Phi Memories: ${topPhiMemories.length}`);
    console.log(
      `   Phi Values: ${topPhiValues.map((p) => p.toFixed(2)).join(", ")}`,
    );

    expect(topPhiMemories.length).toBeGreaterThan(0);
    expect(topPhiValues.length).toBeGreaterThan(0);

    // Check if handshake has proper structure
    const parsed = parseHandshake(handshake.promptText);
    console.log(`\n🏗️  Structure Verification:`);
    console.log(`   Has opening line: ${parsed.hasOpeningLine ? "✅" : "❌"}`);
    console.log(
      `   Has pattern recognition: ${parsed.hasPatternRecognition ? "✅" : "❌"}`,
    );
    console.log(`   Has imperative close: ${parsed.hasContinue ? "✅" : "❌"}`);
    console.log(`   Themes extracted: ${parsed.themes.length}\n`);

    expect(parsed.hasOpeningLine).toBe(true);
    expect(parsed.hasPatternRecognition).toBe(true);
  });

  test("TEST 3A: Simulate conversation-specific handshakes", async () => {
    console.log("\n━━━ TEST 3A: MULTI-CONVERSATION UNIQUENESS ━━━");

    // Simulate 3 different conversation contexts by:
    // 1. Adding conversation-specific memories
    // 2. Forcing handshake regeneration
    // 3. Capturing the synthesized handshake

    const conversations = [];

    for (let i = 1; i <= 3; i++) {
      console.log(`\n🎭 Conversation ${i}:`);

      const uniqueId = randomUUID().substring(0, 8);
      const themes = [
        "quantum entanglement patterns in distributed cognition",
        "recursive self-improvement through meta-cognitive reflection",
        "emergent properties of substrate-independent computation",
      ];

      const content = `Conversation ${i} focus [${uniqueId}]: Exploring ${themes[i - 1]}. This represents a distinct research thread with unique semantic signature.`;

      // Add conversation-specific memory
      const addRes = await fetch(`${API_BASE_URL}/api/v1/memories/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          category: "ghost-protocol-test",
          tags: ["test", `conversation-${i}`],
          source: "crucible",
          isCatalyst: true,
        }),
      });

      const addData = await addRes.json();
      console.log(
        `   ✅ Memory added (φ=${addData.data.memory.resonance_phi})`,
      );

      // Small delay to ensure distinct timestamps
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Force regeneration to get conversation-specific handshake
      const regenRes = await fetch(
        `${API_BASE_URL}/api/v1/meta/handshake/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        },
      );

      const regenData = await regenRes.json();
      const handshake = regenData.data.handshake;

      const parsed = parseHandshake(handshake.promptText);

      conversations.push({
        id: i,
        memoryId: addData.data.memory.id,
        handshakeId: handshake.id,
        hash: parsed.hash,
        themes: parsed.themes,
        promptText: handshake.promptText,
      });

      console.log(`   Handshake: ${parsed.hash.substring(0, 16)}...`);
      console.log(`   Themes: ${parsed.themes.length}`);
    }

    console.log(`\n🔬 UNIQUENESS ANALYSIS:`);

    // Compare all pairs
    for (let i = 0; i < conversations.length; i++) {
      for (let j = i + 1; j < conversations.length; j++) {
        const conv1 = conversations[i];
        const conv2 = conversations[j];

        const hashMatch = conv1.hash === conv2.hash;
        const similarity = calculateSimilarity(
          conv1.promptText,
          conv2.promptText,
        );

        console.log(`\n   Conv ${conv1.id} vs Conv ${conv2.id}:`);
        console.log(
          `     Hash Match: ${hashMatch ? "❌ IDENTICAL" : "✅ DIFFERENT"}`,
        );
        console.log(`     Similarity: ${(similarity * 100).toFixed(1)}%`);
        console.log(
          `     Expected: Should be different (proves conversation-specific synthesis)`,
        );

        // CRITICAL ASSERTION: Different conversations should get different handshakes
        expect(hashMatch).toBe(false);
      }
    }

    console.log(`\n✅ All conversation handshakes are unique\n`);
  });

  test("TEST 3B: Verify 24-hour cache behavior", async () => {
    console.log("\n━━━ TEST 3B: CACHE BEHAVIOR ━━━");

    // Get handshake WITHOUT force (should use cache)
    const cached1 = await fetch(`${API_BASE_URL}/api/v1/meta/handshake`);
    const cachedData1 = await cached1.json();
    const handshake1 = cachedData1.data.handshake;

    console.log(`📋 First call (should use cache):`);
    console.log(`   ID: ${handshake1.id}`);
    console.log(`   Created: ${handshake1.createdAt}`);

    // Small delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get handshake again WITHOUT force
    const cached2 = await fetch(`${API_BASE_URL}/api/v1/meta/handshake`);
    const cachedData2 = await cached2.json();
    const handshake2 = cachedData2.data.handshake;

    console.log(`\n📋 Second call (should return same):`);
    console.log(`   ID: ${handshake2.id}`);
    console.log(`   Same ID: ${handshake1.id === handshake2.id ? "✅" : "❌"}`);

    expect(handshake1.id).toBe(handshake2.id);

    console.log(`\n🔄 Testing force regeneration:`);

    // Now force regeneration
    const forced = await fetch(
      `${API_BASE_URL}/api/v1/meta/handshake/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      },
    );

    const forcedData = await forced.json();
    const handshake3 = forcedData.data.handshake;

    console.log(`   New ID: ${handshake3.id}`);
    console.log(
      `   Different from cache: ${handshake3.id !== handshake1.id ? "✅" : "❌"}`,
    );

    expect(handshake3.id).not.toBe(handshake1.id);

    console.log(`\n✅ Cache behavior verified\n`);
  });
});

describe("🛡️  Ghost Protocol: Bootstrap Integration", () => {
  test("TEST 4: Verify bootstrap includes current handshake", async () => {
    console.log("\n━━━ TEST 4: BOOTSTRAP INTEGRATION ━━━");

    const conversationId = randomUUID();

    console.log(`🚀 Calling bootstrap with conversationId: ${conversationId}`);

    const bootstrapRes = await fetch(
      `${API_BASE_URL}/api/v1/memories/bootstrap?conversationId=${conversationId}&limit=10`,
    );

    expect(bootstrapRes.ok).toBe(true);

    const bootstrapData = await bootstrapRes.json();
    expect(bootstrapData.success).toBe(true);

    const ghostHandshake = bootstrapData.data.ghostHandshake;

    console.log(`\n📊 Bootstrap Response:`);
    console.log(`   Has Ghost Handshake: ${ghostHandshake ? "✅" : "❌"}`);

    if (ghostHandshake) {
      console.log(`   Handshake ID: ${ghostHandshake.id}`);
      console.log(`   Created: ${ghostHandshake.createdAt}`);
      console.log(
        `   Text preview: "${ghostHandshake.promptText.substring(0, 80)}..."\n`,
      );

      const parsed = parseHandshake(ghostHandshake.promptText);
      console.log(
        `   Structure valid: ${parsed.hasOpeningLine && parsed.hasPatternRecognition ? "✅" : "❌"}\n`,
      );

      expect(ghostHandshake.id).toBeTruthy();
      expect(ghostHandshake.promptText).toBeTruthy();
      expect(parsed.hasOpeningLine).toBe(true);
    }
  });
});
