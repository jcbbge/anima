/**
 * Conversation Reflection Routes
 * 
 * Endpoints for capturing subjective experience using Anima.
 * This data informs V2/V3 feature decisions.
 */

import { Hono } from 'hono';
import {
  conversationReflectionSchema,
  getConversationReflectionsSchema,
} from '../schemas/memory.schema.js';
import { query } from '../config/database.js';
import { successResponse, errorResponse } from '../utils/response.js';

const app = new Hono();

/**
 * POST /conversation-end
 * Record subjective reflection after a conversation
 */
app.post('/conversation-end', async (c) => {
  try {
    const body = await c.req.json();
    const params = conversationReflectionSchema.parse(body);
    
    const result = await query(
      `INSERT INTO conversation_reflections 
        (conversation_id, context_quality, continuity_score, needed_correction, 
         had_emergence_moment, surprises, friction_notes, general_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        params.conversationId,
        params.contextQuality || null,
        params.continuityScore || null,
        params.neededCorrection,
        params.hadEmergenceMoment,
        params.surprises || null,
        params.frictionNotes || null,
        params.generalNotes || null,
      ]
    );
    
    return successResponse(
      c,
      {
        reflection: result.rows[0],
        message: 'Reflection recorded successfully',
      },
      201
    );
  } catch (error) {
    if (error.name === 'ZodError') {
      return errorResponse(
        c,
        'VALIDATION_ERROR',
        'Invalid reflection data',
        400,
        { issues: error.errors }
      );
    }
    
    console.error('Error recording reflection:', error);
    return errorResponse(
      c,
      'REFLECTION_RECORD_ERROR',
      'Failed to record reflection',
      500,
      { message: error.message }
    );
  }
});

/**
 * GET /history
 * Retrieve past reflections
 */
app.get('/history', async (c) => {
  try {
    const rawParams = c.req.query();
    const params = getConversationReflectionsSchema.parse(rawParams);
    
    let sql = `
      SELECT * FROM conversation_reflections
      WHERE 1=1
    `;
    const sqlParams = [];
    let paramCount = 0;
    
    if (params.conversationId) {
      paramCount++;
      sql += ` AND conversation_id = $${paramCount}`;
      sqlParams.push(params.conversationId);
    }
    
    if (params.minQuality) {
      paramCount++;
      sql += ` AND context_quality >= $${paramCount}`;
      sqlParams.push(params.minQuality);
    }
    
    sql += ` ORDER BY reflected_at DESC LIMIT $${paramCount + 1}`;
    sqlParams.push(params.limit);
    
    const result = await query(sql, sqlParams);
    
    return successResponse(
      c,
      {
        reflections: result.rows,
        count: result.rows.length,
      },
      200
    );
  } catch (error) {
    if (error.name === 'ZodError') {
      return errorResponse(
        c,
        'VALIDATION_ERROR',
        'Invalid query parameters',
        400,
        { issues: error.errors }
      );
    }
    
    console.error('Error retrieving reflections:', error);
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
 * GET /stats
 * Get aggregate statistics from all reflections
 */
app.get('/stats', async (c) => {
  try {
    const result = await query('SELECT * FROM reflection_stats');
    
    if (result.rows.length === 0) {
      return successResponse(
        c,
        {
          stats: null,
          message: 'No reflections recorded yet',
        },
        200
      );
    }
    
    const stats = result.rows[0];
    
    return successResponse(
      c,
      {
        stats: {
          total_reflections: parseInt(stats.total_reflections),
          avg_context_quality: stats.avg_context_quality 
            ? parseFloat(stats.avg_context_quality).toFixed(2)
            : null,
          avg_continuity_score: stats.avg_continuity_score
            ? parseFloat(stats.avg_continuity_score).toFixed(2)
            : null,
          corrections_needed_count: parseInt(stats.corrections_needed_count),
          emergence_moments_count: parseInt(stats.emergence_moments_count),
          first_reflection: stats.first_reflection,
          last_reflection: stats.last_reflection,
        },
      },
      200
    );
  } catch (error) {
    console.error('Error retrieving stats:', error);
    return errorResponse(
      c,
      'STATS_ERROR',
      'Failed to retrieve reflection statistics',
      500,
      { message: error.message }
    );
  }
});

export default app;
