/**
 * Association Routes
 * 
 * Endpoints for discovering and analyzing memory associations
 * based on empirical co-occurrence patterns.
 */

import { Hono } from 'hono';
import { 
  discoverAssociationsSchema, 
  findHubsSchema,
  networkStatsSchema,
} from '../schemas/memory.schema.js';
import { 
  discoverAssociations, 
  findHubs,
  getNetworkStats,
} from '../services/associationService.js';
import { successResponse, errorResponse } from '../utils/response.js';

const app = new Hono();

/**
 * GET /discover
 * Find memories associated with a given memory
 */
app.get('/discover', async (c) => {
  try {
    const rawParams = c.req.query();
    const params = discoverAssociationsSchema.parse(rawParams);
    
    const result = await discoverAssociations({
      memoryId: params.memoryId,
      minStrength: params.minStrength,
      limit: params.limit,
    });
    
    return successResponse(c, result, 200);
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
    
    console.error('Association discovery error:', error);
    return errorResponse(
      c,
      'ASSOCIATION_DISCOVERY_ERROR',
      'Failed to discover associations',
      500,
      { message: error.message }
    );
  }
});

/**
 * GET /hubs
 * Find hub memories (most connected nodes in the network)
 */
app.get('/hubs', async (c) => {
  try {
    const rawParams = c.req.query();
    const params = findHubsSchema.parse(rawParams);
    
    const hubs = await findHubs({
      limit: params.limit,
      minConnections: params.minConnections,
    });
    
    return successResponse(c, { hubs }, 200);
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
    
    console.error('Hub discovery error:', error);
    return errorResponse(
      c,
      'HUB_DISCOVERY_ERROR',
      'Failed to find hub memories',
      500,
      { message: error.message }
    );
  }
});

/**
 * GET /network-stats
 * Get network statistics for a specific memory
 */
app.get('/network-stats', async (c) => {
  try {
    const rawParams = c.req.query();
    const params = networkStatsSchema.parse(rawParams);
    
    const stats = await getNetworkStats(params.memoryId);
    
    return successResponse(c, stats, 200);
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
    
    console.error('Network stats error:', error);
    return errorResponse(
      c,
      'NETWORK_STATS_ERROR',
      'Failed to retrieve network statistics',
      500,
      { message: error.message }
    );
  }
});

export default app;
