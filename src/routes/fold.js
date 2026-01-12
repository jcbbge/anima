/**
 * The Fold API Routes (V2.1.0)
 *
 * Endpoints for The Fold - Resonant Synthesis Engine
 * - Trigger harmonic synthesis (REM/Active pulse)
 * - View fold history
 * - Control drift aperture
 */

import { Hono } from 'hono';
import {
  performFold,
  storeSynthesisResult,
  getFoldHistory,
} from '../services/foldEngine.js';
import {
  getCurrentDriftAperture,
  setDriftAperture,
} from '../services/strategicSampling.js';

const fold = new Hono();

/**
 * POST /fold/trigger
 * Trigger harmonic synthesis (The Fold)
 *
 * Body (optional):
 * {
 *   "userQuery": "optional user query for Active Pulse mode"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "result": {
 *       "success": true,
 *       "mode": "in_context",
 *       "synthesisPrompt": "...",
 *       "triad": { ... }
 *     }
 *   }
 * }
 */
fold.post('/trigger', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { userQuery } = body;

    const result = await performFold({ userQuery });

    return c.json({
      success: true,
      data: {
        result,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('❌ Fold trigger failed:', error);

    return c.json(
      {
        success: false,
        error: {
          code: 'FOLD_TRIGGER_FAILED',
          message: error.message,
          details: error.details || {},
        },
      },
      500
    );
  }
});

/**
 * POST /fold/store
 * Store synthesis result after in-context generation
 *
 * Body:
 * {
 *   "synthesisText": "generated synthesis text",
 *   "triad": { ... } // from performFold result
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "memory": { ... },
 *     "consonance": 0.65,
 *     "evolved": false
 *   }
 * }
 */
fold.post('/store', async (c) => {
  try {
    const body = await c.req.json();
    const { synthesisText, triad } = body;

    if (!synthesisText || !triad) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'synthesisText and triad are required',
          },
        },
        400
      );
    }

    const result = await storeSynthesisResult(synthesisText, triad);

    return c.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('❌ Failed to store synthesis:', error);

    return c.json(
      {
        success: false,
        error: {
          code: 'STORAGE_FAILED',
          message: error.message,
          details: error.details || {},
        },
      },
      500
    );
  }
});

/**
 * GET /fold/history?limit=10
 * Get recent fold synthesis history
 *
 * Query params:
 * - limit: Number of fold syntheses to retrieve (default: 10, max: 100)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "folds": [
 *       {
 *         "id": "uuid",
 *         "content": "synthesis text",
 *         "phi": 3.2,
 *         "consonance": 0.65,
 *         "evolved": false,
 *         "created_at": "2026-01-12T..."
 *       }
 *     ]
 *   }
 * }
 */
fold.get('/history', async (c) => {
  try {
    const limit = Math.min(
      parseInt(c.req.query('limit') || '10', 10),
      100
    );

    if (isNaN(limit) || limit < 1) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_LIMIT',
            message: 'Limit must be between 1 and 100',
          },
        },
        400
      );
    }

    const folds = await getFoldHistory(limit);

    return c.json({
      success: true,
      data: {
        folds,
        count: folds.length,
      },
      meta: {
        timestamp: new Date().toISOString(),
        limit,
      },
    });
  } catch (error) {
    console.error('❌ Failed to fetch fold history:', error);

    return c.json(
      {
        success: false,
        error: {
          code: 'HISTORY_FAILED',
          message: error.message,
        },
      },
      500
    );
  }
});

/**
 * GET /fold/drift
 * Get current drift aperture setting
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "driftAperture": 0.2,
 *     "mode": "Standard (Balanced)",
 *     "similarityRange": {
 *       "min": 0.80,
 *       "max": 0.85
 *     }
 *   }
 * }
 */
fold.get('/drift', async (c) => {
  try {
    const drift = await getCurrentDriftAperture();

    // Determine mode
    let mode;
    if (drift <= 0.15) {
      mode = 'Tight (Anchor Mode)';
    } else if (drift <= 0.25) {
      mode = 'Standard (Balanced)';
    } else {
      mode = 'Wide (Chaos Mode)';
    }

    // Calculate similarity range
    const simMax = 1.05 - (drift * 1.0);
    const simMin = simMax - 0.05;

    return c.json({
      success: true,
      data: {
        driftAperture: drift,
        mode,
        similarityRange: {
          min: simMin,
          max: simMax,
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('❌ Failed to get drift aperture:', error);

    return c.json(
      {
        success: false,
        error: {
          code: 'DRIFT_GET_FAILED',
          message: error.message,
        },
      },
      500
    );
  }
});

/**
 * POST /fold/drift
 * Set drift aperture value
 *
 * Body:
 * {
 *   "driftAperture": 0.2  // Must be between 0.1 and 0.3
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "driftAperture": 0.2,
 *     "mode": "Standard (Balanced)"
 *   }
 * }
 */
fold.post('/drift', async (c) => {
  try {
    const body = await c.req.json();
    const { driftAperture } = body;

    if (driftAperture === undefined || driftAperture === null) {
      return c.json(
        {
          success: false,
          error: {
            code: 'MISSING_DRIFT_VALUE',
            message: 'driftAperture is required',
          },
        },
        400
      );
    }

    const drift = parseFloat(driftAperture);

    if (isNaN(drift) || drift < 0.1 || drift > 0.3) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_DRIFT_VALUE',
            message: 'driftAperture must be between 0.1 and 0.3',
            details: {
              provided: driftAperture,
              validRange: '0.1-0.3',
            },
          },
        },
        400
      );
    }

    await setDriftAperture(drift);

    // Determine mode
    let mode;
    if (drift <= 0.15) {
      mode = 'Tight (Anchor Mode)';
    } else if (drift <= 0.25) {
      mode = 'Standard (Balanced)';
    } else {
      mode = 'Wide (Chaos Mode)';
    }

    return c.json({
      success: true,
      data: {
        driftAperture: drift,
        mode,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('❌ Failed to set drift aperture:', error);

    return c.json(
      {
        success: false,
        error: {
          code: 'DRIFT_SET_FAILED',
          message: error.message,
          details: error.details || {},
        },
      },
      500
    );
  }
});

export default fold;
