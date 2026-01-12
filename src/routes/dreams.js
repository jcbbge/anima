/**
 * Dreams API Routes (Legacy - Redirects to Fold V2.1)
 *
 * DEPRECATED: Use /api/v1/fold endpoints instead
 * This route is maintained for backward compatibility only
 *
 * Redirects to:
 * - POST /fold/trigger for synthesis
 * - GET /fold/history for dream history
 */

import { Hono } from "hono";
import {
  performFold,
  getFoldHistory,
} from "../services/foldEngine.js";

const dreams = new Hono();

/**
 * POST /dreams/trigger
 * Manually trigger a REM synthesis cycle
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     result: {
 *       success: true,
 *       synthesis: { id, content, resonance_phi, created_at },
 *       ancestors: [{ id, phi, content }],
 *       coherenceScore: 3.2,
 *       associationsCreated: 3
 *     }
 *   }
 * }
 */
dreams.post("/trigger", async (c) => {
  try {
    // LEGACY: Redirect to new Fold engine
    const result = await performFold();

    return c.json({
      success: true,
      data: {
        result,
      },
      meta: {
        timestamp: new Date().toISOString(),
        legacy: true,
        message: "DEPRECATED: Use /api/v1/fold/trigger instead",
      },
    });
  } catch (error) {
    console.error("❌ Dream trigger failed:", error);

    return c.json(
      {
        success: false,
        error: {
          code: "DREAM_TRIGGER_FAILED",
          message: error.message,
          details: error.details || {},
        },
      },
      500,
    );
  }
});

/**
 * GET /dreams/history?limit=10
 * Get recent dream synthesis history
 *
 * Query params:
 * - limit: Number of dreams to retrieve (default: 10)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     dreams: [
 *       {
 *         id: "uuid",
 *         content: "synthesis text",
 *         phi: 3.0,
 *         created_at: "2026-01-09T...",
 *         coherence_score: 3.2,
 *         ancestor_ids: ["uuid1", "uuid2", "uuid3"]
 *       }
 *     ]
 *   }
 * }
 */
dreams.get("/history", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "10", 10);

    if (isNaN(limit) || limit < 1 || limit > 100) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_LIMIT",
            message: "Limit must be between 1 and 100",
          },
        },
        400,
      );
    }

    // LEGACY: Redirect to new Fold engine
    const folds = await getFoldHistory(limit);

    // Map fold results to old dream format for backward compatibility
    const dreams = folds.map(fold => ({
      id: fold.id,
      content: fold.content,
      phi: fold.phi,
      created_at: fold.created_at,
      coherence_score: fold.consonance,
      ancestor_ids: fold.metadata?.source_triad
        ? [
            fold.metadata.source_triad.fundamental_id,
            fold.metadata.source_triad.melody_id,
            fold.metadata.source_triad.overtone_id,
          ]
        : [],
    }));

    return c.json({
      success: true,
      data: {
        dreams,
        count: dreams.length,
      },
      meta: {
        timestamp: new Date().toISOString(),
        limit,
        legacy: true,
        message: "DEPRECATED: Use /api/v1/fold/history instead",
      },
    });
  } catch (error) {
    console.error("❌ Failed to fetch dream history:", error);

    return c.json(
      {
        success: false,
        error: {
          code: "DREAM_HISTORY_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

export default dreams;
