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

export default app;
