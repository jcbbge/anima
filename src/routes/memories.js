/**
 * Memory Routes
 * 
 * API endpoints for memory operations.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  addMemorySchema,
  queryMemoriesSchema,
  bootstrapSchema,
  updateTierSchema,
} from '../schemas/memory.schema.js';
import {
  addMemory,
  queryMemories,
  loadBootstrap,
} from '../services/memoryService.js';
import { updateMemoryTier } from '../services/tierService.js';
import { getTopCatalysts, getResonanceStats } from '../services/resonanceService.js';
import { successResponse, errorResponse } from '../utils/response.js';

const memories = new Hono();

/**
 * POST /add - Add a new memory
 */
memories.post(
  '/add',
  zValidator('json', addMemorySchema, (result, c) => {
    if (!result.success) {
      return errorResponse(
        c,
        'VALIDATION_ERROR',
        'Request validation failed',
        400,
        { issues: result.error.issues }
      );
    }
  }),
  async (c) => {
    try {
      const data = c.req.valid('json');
      const result = await addMemory(data);

      const status = result.isDuplicate ? 200 : 201;
      const message = result.isDuplicate
        ? 'Existing memory returned'
        : 'Memory created successfully';

      return successResponse(
        c,
        {
          memory: result.memory,
          isDuplicate: result.isDuplicate,
          message,
        },
        status
      );
    } catch (error) {
      console.error('Error adding memory:', error);
      return errorResponse(
        c,
        error.code || 'MEMORY_ADD_ERROR',
        error.message || 'Failed to add memory',
        500,
        { details: error.details }
      );
    }
  }
);

/**
 * POST /query - Query memories with semantic search
 */
memories.post(
  '/query',
  zValidator('json', queryMemoriesSchema, (result, c) => {
    if (!result.success) {
      return errorResponse(
        c,
        'VALIDATION_ERROR',
        'Request validation failed',
        400,
        { issues: result.error.issues }
      );
    }
  }),
  async (c) => {
    try {
      const data = c.req.valid('json');
      const result = await queryMemories(data);

      return successResponse(
        c,
        {
          memories: result.memories,
          count: result.memories.length,
          query: data.query,
        },
        200,
        {
          queryTime: result.queryTime,
          ...(result.promotions && { promotions: result.promotions }),
        }
      );
    } catch (error) {
      console.error('Error querying memories:', error);
      return errorResponse(
        c,
        error.code || 'MEMORY_QUERY_ERROR',
        error.message || 'Failed to query memories',
        500,
        { details: error.details }
      );
    }
  }
);

/**
 * GET /bootstrap - Load bootstrap context for conversation
 */
memories.get(
  '/bootstrap',
  zValidator('query', bootstrapSchema, (result, c) => {
    if (!result.success) {
      return errorResponse(
        c,
        'VALIDATION_ERROR',
        'Request validation failed',
        400,
        { issues: result.error.issues }
      );
    }
  }),
  async (c) => {
    try {
      const data = c.req.valid('query');
      const result = await loadBootstrap(data);

      return successResponse(
        c,
        {
          memories: result.memories,
          distribution: result.distribution,
          ghostHandshake: result.ghostHandshake,
        },
        200
      );
    } catch (error) {
      console.error('Error loading bootstrap:', error);
      return errorResponse(
        c,
        error.code || 'BOOTSTRAP_ERROR',
        error.message || 'Failed to load bootstrap context',
        500,
        { details: error.details }
      );
    }
  }
);

/**
 * POST /update-tier - Manually update memory tier
 */
memories.post(
  '/update-tier',
  zValidator('json', updateTierSchema, (result, c) => {
    if (!result.success) {
      return errorResponse(
        c,
        'VALIDATION_ERROR',
        'Request validation failed',
        400,
        { issues: result.error.issues }
      );
    }
  }),
  async (c) => {
    try {
      const data = c.req.valid('json');
      const result = await updateMemoryTier({
        memoryId: data.memoryId,
        newTier: data.tier,
        reason: data.reason || 'manual',
      });

      // Return 404 if memory not found
      if (!result.memory) {
        return errorResponse(
          c,
          'MEMORY_NOT_FOUND',
          'Memory not found',
          404,
          { memoryId: data.memoryId }
        );
      }

      return successResponse(
        c,
        {
          memory: {
            id: result.memory.id,
            tier: result.memory.tier,
            tierLastUpdated: result.memory.tier_last_updated,
          },
          promotion: result.promotion,
          message: result.message,
        },
        200
      );
    } catch (error) {
      console.error('Error updating tier:', error);
      
      // Handle memory not found
      if (error.code === 'MEMORY_NOT_FOUND') {
        return errorResponse(
          c,
          'MEMORY_NOT_FOUND',
          error.message,
          404,
          error.details
        );
      }
      
      // Handle invalid tier
      if (error.code === 'INVALID_TIER') {
        return errorResponse(
          c,
          'INVALID_TIER',
          error.message,
          400,
          error.details
        );
      }
      
      return errorResponse(
        c,
        error.code || 'TIER_UPDATE_ERROR',
        error.message || 'Failed to update tier',
        500,
        { details: error.details }
      );
    }
  }
);

/**
 * GET /catalysts - Get top catalyst memories (high-phi)
 */
memories.get('/catalysts', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '10');
    const catalysts = await getTopCatalysts(limit);
    
    return successResponse(
      c,
      {
        catalysts: catalysts.map(m => ({
          id: m.id,
          content: m.content,
          phi: m.resonance_phi,
          isCatalyst: m.is_catalyst,
          category: m.category,
          tier: m.tier,
          accessCount: m.access_count,
          lastAccessed: m.last_accessed,
        })),
        count: catalysts.length,
      },
      200
    );
  } catch (error) {
    console.error('Error getting catalysts:', error);
    return errorResponse(
      c,
      'CATALYST_ERROR',
      'Failed to retrieve catalysts',
      500,
      { message: error.message }
    );
  }
});

/**
 * GET /stats - Get resonance statistics
 */
memories.get('/stats', async (c) => {
  try {
    const stats = await getResonanceStats();
    
    return successResponse(
      c,
      {
        stats: {
          totalPhi: parseFloat(stats.totalPhi),
          avgPhi: parseFloat(stats.avgPhi),
          maxPhi: parseFloat(stats.maxPhi),
          catalystCount: stats.catalystCount,
          totalMemories: stats.totalMemories,
          topCategory: stats.topCategory,
        }
      },
      200
    );
  } catch (error) {
    console.error('Error getting stats:', error);
    return errorResponse(
      c,
      'STATS_ERROR',
      'Failed to retrieve statistics',
      500,
      { message: error.message }
    );
  }
});

export default memories;
