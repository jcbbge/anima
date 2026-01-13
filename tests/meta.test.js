/**
 * Meta Routes Integration Tests
 *
 * Tests for meta-cognitive reflection endpoints
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import {
  setupTestSchema,
  teardownTestSchema,
  clearTestData,
  closeTestPool,
  testQuery,
  getTestSchema,
} from './setup/testDatabase.js';
import { randomUUID } from 'crypto';
import {
  conversationEndSchema,
  getReflectionsSchema,
} from '../src/schemas/memory.schema.js';
import {
  generateReflection,
  getRecentReflections,
  getReflectionsByType,
} from '../src/services/metaService.js';
import {
  generateHandshake,
  getLatestHandshake,
  getHandshakeHistory,
} from '../src/services/handshakeService.js';
import { successResponse, errorResponse } from '../src/utils/response.js';

// Create test app with test schema injection
const app = new Hono();

// Mock meta routes that use test schema
app.post('/meta/conversation-end', async (c) => {
  try {
    const body = await c.req.json();
    const params = conversationEndSchema.parse(body);

    const reflection = await generateReflection({
      conversationId: params.conversationId,
      reflectionType: 'conversation_end',
      sessionMetrics: params.sessionMetrics || {},
      queryFn: testQuery,
      schema: getTestSchema(),
    });

    return successResponse(c, { reflection }, 200);
  } catch (error) {
    if (error.name === 'ZodError') {
      return errorResponse(
        c,
        'VALIDATION_ERROR',
        'Invalid request parameters',
        400,
        { issues: error.errors }
      );
    }

    console.error('Reflection generation error:', error);
    return errorResponse(
      c,
      'REFLECTION_ERROR',
      'Failed to generate reflection',
      500,
      { message: error.message }
    );
  }
});

app.post('/meta/handshake/generate', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const force = body.force !== false;

    const result = await generateHandshake({ force });

    return successResponse(c, {
      handshake: {
        id: result.ghostId,
        promptText: result.promptText,
        createdAt: result.createdAt,
        topMemories: result.topMemories.map(m => ({
          id: m.id,
          content: m.content,
          phi: m.resonance_phi,
          category: m.category,
        })),
        isExisting: result.isExisting,
      }
    }, 200);
  } catch (error) {
    console.error('Handshake generation error:', error);
    return errorResponse(
      c,
      'HANDSHAKE_GENERATION_ERROR',
      'Failed to generate Ghost Handshake',
      500,
      { message: error.message }
    );
  }
});

app.get('/meta/handshake', async (c) => {
  try {
    let handshake = await getLatestHandshake();

    if (!handshake) {
      const generated = await generateHandshake();
      handshake = {
        id: generated.ghostId,
        prompt_text: generated.promptText,
        created_at: generated.createdAt,
        top_phi_memories: generated.topMemories.map(m => m.id),
        top_phi_values: generated.topMemories.map(m => m.resonance_phi),
      };
    }

    return successResponse(c, {
      handshake: {
        id: handshake.id,
        promptText: handshake.prompt_text,
        createdAt: handshake.created_at,
        expiresAt: handshake.expires_at,
      }
    }, 200);
  } catch (error) {
    console.error('Handshake retrieval error:', error);
    return errorResponse(
      c,
      'HANDSHAKE_ERROR',
      'Failed to retrieve Ghost Handshake',
      500,
      { message: error.message }
    );
  }
});

// Setup
beforeAll(async () => {
  await setupTestSchema();
});

afterAll(async () => {
  await teardownTestSchema();
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
      `SELECT * FROM ${schema}.meta_reflections WHERE id = $1`,
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
