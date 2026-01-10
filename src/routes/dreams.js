/**
 * Dreams API Routes
 *
 * Endpoints for The Fold (REM Synthesis Engine)
 * - Trigger manual REM synthesis
 * - View dream history
 */

import { Hono } from "hono";
import {
  performREM,
  triggerDream,
  getDreamHistory,
} from "../services/dreamService.js";

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
    const result = await triggerDream();

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

    const dreams = await getDreamHistory(limit);

    return c.json({
      success: true,
      data: {
        dreams,
        count: dreams.length,
      },
      meta: {
        timestamp: new Date().toISOString(),
        limit,
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
