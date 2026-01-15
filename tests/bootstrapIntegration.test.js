/**
 * Bootstrap Integration Tests - Ghost Handshake Integration
 * 
 * Tests that bootstrap endpoint returns Ghost Handshake in a single request
 * PRD-004: Bootstrap Integration - Return Ghost Handshake
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';
import { loadBootstrap } from '../src/services/memoryService.js';
import { addMemory } from '../src/services/memoryService.js';
import { query } from '../src/config/database.js';

describe('Bootstrap Integration - Ghost Handshake', () => {
  // Cleanup function to remove test data
  async function cleanup(conversationId) {
    if (conversationId) {
      await query('DELETE FROM memories WHERE conversation_id = $1', [conversationId]);
      await query('DELETE FROM ghost_logs WHERE conversation_id = $1', [conversationId]);
    }
  }

  afterAll(async () => {
    // Final cleanup
    await query('DELETE FROM memories WHERE content LIKE $1', ['%Test memory for bootstrap%']);
    await query('DELETE FROM memories WHERE content LIKE $1', ['%Working on authentication system%']);
  });

  test('Bootstrap should include ghostHandshake field', async () => {
    const convId = randomUUID();
    
    try {
      const bootstrap = await loadBootstrap({ conversationId: convId, limit: 10 });
      
      expect(bootstrap.ghostHandshake).toBeDefined();
      expect(bootstrap.ghostHandshake.id).toBeDefined();
      expect(bootstrap.ghostHandshake.promptText).toBeDefined();
      expect(bootstrap.ghostHandshake.promptText).toContain('👻 GHOST HANDSHAKE');
    } finally {
      await cleanup(convId);
    }
  });

  test('Bootstrap handshake should match conversation context', async () => {
    const convId = randomUUID();
    
    try {
      await addMemory({
        content: 'Working on authentication system',
        conversationId: convId,
        resonancePhi: 4.0,
      });
      
      const bootstrap = await loadBootstrap({ conversationId: convId, limit: 10 });
      
      expect(bootstrap.ghostHandshake.conversationId).toBe(convId);
      expect(bootstrap.ghostHandshake.contextType).toBe('conversation');
    } finally {
      await cleanup(convId);
    }
  });

  test('Bootstrap should use cached handshake when appropriate', async () => {
    const convId = randomUUID();
    
    try {
      const bootstrap1 = await loadBootstrap({ conversationId: convId, limit: 10 });
      const bootstrap2 = await loadBootstrap({ conversationId: convId, limit: 10 });
      
      expect(bootstrap2.ghostHandshake.id).toBe(bootstrap1.ghostHandshake.id);
      expect(bootstrap2.ghostHandshake.isExisting).toBe(true);
    } finally {
      await cleanup(convId);
    }
  });

  test('GET /bootstrap API should return ghostHandshake', async () => {
    const convId = randomUUID();
    
    try {
      const response = await fetch(
        `http://localhost:7100/api/v1/memories/bootstrap?conversationId=${convId}&limit=10`
      );
      
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.data.ghostHandshake).toBeDefined();
      expect(data.data.ghostHandshake.promptText).toBeDefined();
    } finally {
      await cleanup(convId);
    }
  });

  test('Bootstrap handshake should have all required fields', async () => {
    const convId = randomUUID();
    
    try {
      const bootstrap = await loadBootstrap({ conversationId: convId, limit: 10 });
      
      const handshake = bootstrap.ghostHandshake;
      
      expect(handshake.id).toBeDefined();
      expect(handshake.promptText).toBeDefined();
      expect(handshake.createdAt).toBeDefined();
      expect(handshake.isExisting).toBeDefined();
      expect(handshake.conversationId).toBeDefined();
      expect(handshake.contextType).toBeDefined();
      expect(typeof handshake.cachedFor).toBe('number');
    } finally {
      await cleanup(convId);
    }
  });

  test('Bootstrap without conversationId should return global handshake', async () => {
    const bootstrap = await loadBootstrap({ limit: 10 });
    
    expect(bootstrap.ghostHandshake).toBeDefined();
    expect(bootstrap.ghostHandshake.conversationId).toBeNull();
    expect(bootstrap.ghostHandshake.contextType).toBe('global');
  });

  test('Handshake generation error should not crash bootstrap', async () => {
    const convId = randomUUID();
    
    try {
      const bootstrap = await loadBootstrap({ conversationId: convId, limit: 10 });
      
      expect(bootstrap.memories).toBeDefined();
      expect(bootstrap.distribution).toBeDefined();
      expect(bootstrap.ghostHandshake).toBeDefined();
    } finally {
      await cleanup(convId);
    }
  });

  test('Bootstrap with handshake should complete within 200ms', async () => {
    const convId = randomUUID();

    try {
      const start = Date.now();
      await loadBootstrap({ conversationId: convId, limit: 20 });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(200);
    } finally {
      await cleanup(convId);
    }
  });

  test('Single bootstrap call provides memories AND handshake', async () => {
    const convId = randomUUID();

    try {
      await addMemory({
        content: 'Test memory for bootstrap',
        conversationId: convId,
        tier: 'active',
      });

      const bootstrap = await loadBootstrap({ conversationId: convId, limit: 10 });

      expect(bootstrap.memories.active.length).toBeGreaterThan(0);
      expect(bootstrap.ghostHandshake.promptText).toContain('👻');
    } finally {
      await cleanup(convId);
    }
  });

  test('API response should match documented format', async () => {
    const convId = randomUUID();

    try {
      const response = await fetch(
        `http://localhost:7100/api/v1/memories/bootstrap?conversationId=${convId}&limit=10`
      );

      const data = await response.json();

      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('meta');
      expect(data.data).toHaveProperty('memories');
      expect(data.data).toHaveProperty('distribution');
      expect(data.data).toHaveProperty('ghostHandshake');
    } finally {
      await cleanup(convId);
    }
  });
});

