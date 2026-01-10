/**
 * Meta-Cognitive Routes
 * 
 * Endpoints for system reflection, insights, and performance metrics.
 */

import { Hono } from 'hono';
import { 
  conversationEndSchema,
  getReflectionsSchema,
} from '../schemas/memory.schema.js';
import {
  generateReflection,
  getRecentReflections,
  getReflectionsByType,
} from '../services/metaService.js';
import {
  generateHandshake,
  getLatestHandshake,
  getHandshakeHistory,
} from '../services/handshakeService.js';
import { successResponse, errorResponse } from '../utils/response.js';

const app = new Hono();

/**
 * POST /conversation-end
 * Trigger meta-cognitive reflection after conversation ends
 */
app.post('/conversation-end', async (c) => {
  try {
    const body = await c.req.json();
    const params = conversationEndSchema.parse(body);
    
    const reflection = await generateReflection({
      conversationId: params.conversationId,
      reflectionType: 'conversation_end',
      sessionMetrics: params.sessionMetrics || {},
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

/**
 * GET /reflection
 * Get recent reflections for a conversation or globally
 */
app.get('/reflection', async (c) => {
  try {
    const rawParams = c.req.query();
    const params = getReflectionsSchema.parse(rawParams);
    
    let reflections;
    
    if (params.reflectionType) {
      // Get by type
      reflections = await getReflectionsByType(params.reflectionType, params.limit);
    } else if (params.conversationId) {
      // Get by conversation
      reflections = await getRecentReflections(params.conversationId, params.limit);
    } else {
      // Get most recent globally
      reflections = await getRecentReflections(null, params.limit);
    }
    
    return successResponse(c, { reflections, count: reflections.length }, 200);
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
    
    console.error('Reflection retrieval error:', error);
    return errorResponse(
      c,
      'REFLECTION_RETRIEVAL_ERROR',
      'Failed to retrieve reflections',
      500,
      { message: error.message }
    );
  }
});

/**
 * POST /manual-reflection
 * Manually trigger a reflection (for testing/debugging)
 */
app.post('/manual-reflection', async (c) => {
  try {
    const body = await c.req.json();
    const conversationId = body.conversationId || null;
    const sessionMetrics = body.sessionMetrics || {};
    
    const reflection = await generateReflection({
      conversationId,
      reflectionType: 'manual',
      sessionMetrics,
    });
    
    return successResponse(c, { reflection }, 200);
  } catch (error) {
    console.error('Manual reflection error:', error);
    return errorResponse(
      c,
      'REFLECTION_ERROR',
      'Failed to generate manual reflection',
      500,
      { message: error.message }
    );
  }
});

/**
 * GET /handshake
 * Get latest Ghost Handshake for continuity
 */
app.get('/handshake', async (c) => {
  try {
    let handshake = await getLatestHandshake();
    
    // Generate if none exists
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

/**
 * POST /handshake/generate
 * Force generate new Ghost Handshake
 */
app.post('/handshake/generate', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const force = body.force !== false; // Default to true
    
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

/**
 * GET /handshake/history
 * Get history of Ghost Handshakes
 */
app.get('/handshake/history', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '10');
    const history = await getHandshakeHistory(limit);
    
    return successResponse(c, {
      history: history.map(h => ({
        id: h.id,
        promptText: h.prompt_text,
        createdAt: h.created_at,
        expiresAt: h.expires_at,
        synthesisMethod: h.synthesis_method,
      })),
      count: history.length,
    }, 200);
  } catch (error) {
    console.error('Handshake history error:', error);
    return errorResponse(
      c,
      'HANDSHAKE_HISTORY_ERROR',
      'Failed to retrieve handshake history',
      500,
      { message: error.message }
    );
  }
});

export default app;
