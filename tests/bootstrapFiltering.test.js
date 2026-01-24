import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { loadBootstrap } from '../src/services/memoryService.js';
import { query } from '../src/config/database.js';

/**
 * Helper: Insert test memory with all required fields
 */
async function insertMemory(data) {
  const {
    content,
    conversationId = null,
    resonancePhi = 1.0,
    isCatalyst = false,
    category = 'observation',
    tier = 'active',
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
      'test-hash-' + randomUUID(),
      JSON.stringify(Array(768).fill(0.1)), // Mock embedding
    ]
  );

  return result.rows[0];
}

/**
 * Helper: Cleanup test memories
 */
async function cleanup(conversationId) {
  if (conversationId) {
    await query('DELETE FROM memories WHERE conversation_id = $1', [conversationId]);
    await query('DELETE FROM ghost_logs WHERE conversation_id = $1', [conversationId]);
  }
}

describe('Bootstrap Conversation Filtering', () => {
  let testConversationIds = [];

  beforeAll(async () => {
    // Clean up any existing test data
    await query('DELETE FROM memories WHERE content LIKE \'%Test%\'');
    await query('DELETE FROM memories WHERE content LIKE \'%Conv%\'');
    await query('DELETE FROM memories WHERE content LIKE \'%Global%\'');
  });

  afterAll(async () => {
    // Clean up all test data
    for (const convId of testConversationIds) {
      await cleanup(convId);
    }
    await query('DELETE FROM memories WHERE content LIKE \'%Test%\'');
    await query('DELETE FROM memories WHERE content LIKE \'%Conv%\'');
    await query('DELETE FROM memories WHERE content LIKE \'%Global%\'');
  });

  beforeEach(async () => {
    // Generate fresh conversation IDs for each test
    const convId = randomUUID();
    testConversationIds.push(convId);
  });

  test('Bootstrap should prioritize conversation memories', async () => {
    const convA = randomUUID();
    const convB = randomUUID();
    testConversationIds.push(convA, convB);

    await insertMemory({
      content: 'Conversation A memory 1',
      conversationId: convA,
      tier: 'active',
      resonancePhi: 2.0,
    });

    await insertMemory({
      content: 'Conversation A memory 2',
      conversationId: convA,
      tier: 'thread',
      resonancePhi: 2.0,
    });

    await insertMemory({
      content: 'Conversation B memory 1',
      conversationId: convB,
      tier: 'active',
      resonancePhi: 2.0,
    });

    const bootstrap = await loadBootstrap({ conversationId: convA, limit: 10 });

    const allMemories = [
      ...bootstrap.memories.active,
      ...bootstrap.memories.thread,
    ];

    const fromA = allMemories.filter(m => m.content.includes('Conversation A')).length;
    const fromB = allMemories.filter(m => m.content.includes('Conversation B')).length;

    expect(fromA).toBeGreaterThan(fromB);
    expect(fromB).toBe(0);
  });

  test('Parallel conversations should not share memories', async () => {
    const authConv = randomUUID();
    const dbConv = randomUUID();
    testConversationIds.push(authConv, dbConv);

    for (let i = 0; i < 5; i++) {
      await insertMemory({
        content: `Auth step ${i}`,
        conversationId: authConv,
        tier: 'active',
        resonancePhi: 2.0,
      });

      await insertMemory({
        content: `Database step ${i}`,
        conversationId: dbConv,
        tier: 'active',
        resonancePhi: 2.0,
      });
    }

    const authBoot = await loadBootstrap({ conversationId: authConv, limit: 20 });
    const dbBoot = await loadBootstrap({ conversationId: dbConv, limit: 20 });

    const authContent = authBoot.memories.active.map(m => m.content).join(' ');
    const dbContent = dbBoot.memories.active.map(m => m.content).join(' ');

    expect(authContent).toContain('Auth');
    expect(authContent).not.toContain('Database');
    expect(dbContent).toContain('Database');
    expect(dbContent).not.toContain('Auth');
  });

  test('High-phi global memories should be included', async () => {
    const convId = randomUUID();
    testConversationIds.push(convId);

    await insertMemory({
      content: 'Critical global insight',
      conversationId: null,
      resonancePhi: 5.0,
      tier: 'stable',
    });

    await insertMemory({
      content: 'Conversation specific',
      conversationId: convId,
      resonancePhi: 2.0,
      tier: 'active',
    });

    const bootstrap = await loadBootstrap({ conversationId: convId, limit: 10 });

    const allMemories = [
      ...bootstrap.memories.active,
      ...bootstrap.memories.thread,
      ...bootstrap.memories.stable,
    ];

    const hasCritical = allMemories.some(m => m.content === 'Critical global insight');
    expect(hasCritical).toBe(true);
  });

  test('Conversation memories should get 2x boost', async () => {
    const convId = randomUUID();
    testConversationIds.push(convId);

    await insertMemory({
      content: 'Global memory',
      conversationId: null,
      resonancePhi: 3.0,
      tier: 'thread',
    });

    await insertMemory({
      content: 'Conversation memory',
      conversationId: convId,
      resonancePhi: 2.0,
      tier: 'thread',
    });

    const bootstrap = await loadBootstrap({ conversationId: convId, limit: 10 });

    const convMem = bootstrap.memories.thread.find(m => m.content === 'Conversation memory');
    const globalMem = bootstrap.memories.thread.find(m => m.content === 'Global memory');

    const convIdx = bootstrap.memories.thread.indexOf(convMem);
    const globalIdx = bootstrap.memories.thread.indexOf(globalMem);

    expect(convIdx).toBeLessThan(globalIdx);
  });

  test('Different conversations should get different bootstrap results', async () => {
    const convA = randomUUID();
    const convB = randomUUID();
    testConversationIds.push(convA, convB);

    await insertMemory({
      content: 'Conv A memory',
      conversationId: convA,
      tier: 'thread',
      resonancePhi: 2.5,
    });

    await insertMemory({
      content: 'Conv B memory',
      conversationId: convB,
      tier: 'thread',
      resonancePhi: 2.5,
    });

    const bootstrapA = await loadBootstrap({ conversationId: convA, limit: 10 });
    const bootstrapB = await loadBootstrap({ conversationId: convB, limit: 10 });

    expect(bootstrapA.conversationId).toBe(convA);
    expect(bootstrapB.conversationId).toBe(convB);

    const hasAinA = bootstrapA.memories.thread.some(m => m.content === 'Conv A memory');
    const hasBinB = bootstrapB.memories.thread.some(m => m.content === 'Conv B memory');
    const hasBinA = bootstrapA.memories.thread.some(m => m.content === 'Conv B memory');
    const hasAinB = bootstrapB.memories.thread.some(m => m.content === 'Conv A memory');

    expect(hasAinA).toBe(true);
    expect(hasBinB).toBe(true);
    expect(hasBinA).toBe(false);
    expect(hasAinB).toBe(false);
  });

  test('Bootstrap should include filtering metadata', async () => {
    const convId = randomUUID();
    testConversationIds.push(convId);

    const bootstrap = await loadBootstrap({ conversationId: convId, limit: 10 });

    expect(bootstrap.conversationId).toBe(convId);
    expect(bootstrap.filtering).toBeDefined();
    expect(bootstrap.filtering.conversationSpecific).toBe(true);
    expect(bootstrap.filtering.boostFactor).toBe(2.0);
    expect(bootstrap.filtering.includeGlobalHighPhi).toBe(true);
    expect(bootstrap.filtering.minGlobalPhi).toBe(3.0);
  });

  test('Distribution should match filtered memory counts', async () => {
    const convId = randomUUID();
    testConversationIds.push(convId);

    for (let i = 0; i < 3; i++) {
      await insertMemory({
        content: `Active ${i}`,
        conversationId: convId,
        tier: 'active',
      });
    }

    for (let i = 0; i < 5; i++) {
      await insertMemory({
        content: `Thread ${i}`,
        conversationId: convId,
        tier: 'thread',
      });
    }

    const bootstrap = await loadBootstrap({ conversationId: convId, limit: 20 });

    expect(bootstrap.distribution.active).toBe(bootstrap.memories.active.length);
    expect(bootstrap.distribution.thread).toBe(bootstrap.memories.thread.length);
    expect(bootstrap.distribution.stable).toBe(bootstrap.memories.stable.length);
  });

  test('Bootstrap with conversation filtering should be fast', async () => {
    const convId = randomUUID();
    testConversationIds.push(convId);

    for (let i = 0; i < 50; i++) {
      await insertMemory({
        content: `Test ${i}`,
        conversationId: convId,
        tier: i % 3 === 0 ? 'active' : i % 3 === 1 ? 'thread' : 'stable',
        resonancePhi: Math.random() * 5,
      });
    }

    const start = Date.now();
    await loadBootstrap({ conversationId: convId, limit: 20 });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(150);
  });

  test('Bootstrap should maintain 70/30 tier distribution', async () => {
    const convId = randomUUID();
    testConversationIds.push(convId);

    for (let i = 0; i < 20; i++) {
      await insertMemory({
        content: `Thread ${i}`,
        conversationId: convId,
        tier: 'thread',
        resonancePhi: 2.0,
      });
    }

    for (let i = 0; i < 20; i++) {
      await insertMemory({
        content: `Stable ${i}`,
        conversationId: convId,
        tier: 'stable',
        resonancePhi: 3.0,
      });
    }

    const bootstrap = await loadBootstrap({ conversationId: convId, limit: 20 });

    const threadCount = bootstrap.distribution.thread;
    const stableCount = bootstrap.distribution.stable;
    const total = threadCount + stableCount;

    if (total > 0) {
      expect(threadCount / total).toBeCloseTo(0.7, 1);
    }
  });

  test('GET /bootstrap should return conversation-filtered memories', async () => {
    const convId = randomUUID();
    testConversationIds.push(convId);

    await insertMemory({
      content: 'Conversation specific',
      conversationId: convId,
      tier: 'active',
    });

    const response = await fetch(
      `http://localhost:7100/api/v1/memories/bootstrap?conversationId=${convId}&limit=10`
    );

    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(json.data.conversationId).toBe(convId);
    expect(json.data.filtering).toBeDefined();
    expect(json.data.filtering.conversationSpecific).toBe(true);
    expect(json.data.memories).toBeDefined();
    expect(json.data.distribution).toBeDefined();
    expect(json.data.ghostHandshake).toBeDefined();
  });
});