/**
 * Meta Routes Integration Tests
 *
 * Tests for meta-cognitive reflection endpoints
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import metaRoutes from '../src/routes/meta.js';
import {
  setupTestSchema,
  teardownTestSchema,
  clearTestData,
  closeTestPool,
  testQuery,
  getTestSchema,
} from './setup/testDatabase.js';
import { randomUUID } from 'crypto';

// Create test app
const app = new Hono();
app.route('/meta', metaRoutes);

// Setup
beforeAll(async () => {
  await setupTestSchema();
});

afterAll(async () => {
  await teardownTestSchema();
  await closeTestPool();
});

describe('POST /meta/conversation-end', () => {
  beforeEach(async () => {
    await clearTestData();
  });

  test('should create meta-reflection with valid conversationId', async () => {
    const conversationId = randomUUID();

    const response = await app.request('/meta/conversation-end', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversationId,
      }),
    });

    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.reflection).toBeDefined();
    expect(result.data.reflection.id).toBeDefined();
    expect(result.data.reflection.reflection_type).toBe('conversation_end');
    expect(result.data.reflection.conversation_id).toBe(conversationId);
  });

  test('should create meta-reflection with sessionMetrics', async () => {
    const conversationId = randomUUID();
    const sessionMetrics = {
      memories_loaded: 10,
      memories_accessed: 5,
      context_load_time_ms: 150,
      queries_executed: 3,
      total_results_returned: 25,
      total_relevance_score: 8.5,
      relevant_results: 20,
    };

    const response = await app.request('/meta/conversation-end', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversationId,
        sessionMetrics,
      }),
    });

    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data.reflection).toBeDefined();
    expect(result.data.reflection.session_metrics).toEqual(sessionMetrics);
  });

  test('should reject invalid conversationId format', async () => {
    const response = await app.request('/meta/conversation-end', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversationId: 'not-a-uuid',
      }),
    });

    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject missing conversationId', async () => {
    const response = await app.request('/meta/conversation-end', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  test('should store reflection in database', async () => {
    const conversationId = randomUUID();

    const response = await app.request('/meta/conversation-end', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversationId,
      }),
    });

    const result = await response.json();
    expect(result.success).toBe(true);

    const reflectionId = result.data.reflection.id;

    // Query database to verify reflection was stored
    const schema = getTestSchema();
    const dbResult = await testQuery(
      `SELECT * FROM ${schema}.reflections WHERE id = $1`,
      [reflectionId]
    );

    expect(dbResult.rows.length).toBe(1);
    expect(dbResult.rows[0].conversation_id).toBe(conversationId);
    expect(dbResult.rows[0].reflection_type).toBe('conversation_end');
  });
});

describe('POST /meta/handshake/generate', () => {
  test('should generate handshake with force flag', async () => {
    const response = await app.request('/meta/handshake/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        force: true,
      }),
    });

    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.handshake).toBeDefined();
    expect(result.data.handshake.id).toBeDefined();
    expect(result.data.handshake.promptText).toBeDefined();
  });
});

describe('GET /meta/handshake', () => {
  test('should retrieve latest handshake', async () => {
    const response = await app.request('/meta/handshake', {
      method: 'GET',
    });

    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.handshake).toBeDefined();
  });
});
