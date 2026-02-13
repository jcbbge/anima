/**
 * Utilities
 * 
 * Hashing and HTTP response helpers.
 */

import type { Context } from "hono";

// ============================================================================
// Hashing
// ============================================================================

export function generateHash(content: string): string {
  if (!content || typeof content !== "string") {
    throw new Error("Content must be a non-empty string");
  }
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}

// ============================================================================
// HTTP Responses
// ============================================================================

export function successResponse<T>(
  c: Context,
  data: T,
  status = 200,
  metaOverrides: Record<string, unknown> = {},
) {
  return c.json({
    success: true,
    data,
    meta: {
      requestId: c.get('requestId'),
      timestamp: new Date().toISOString(),
      ...metaOverrides,
    },
  }, status);
}

export function errorResponse(
  c: Context,
  code: string,
  message: string,
  status = 500,
) {
  return c.json({
    success: false,
    error: { code, message },
    meta: {
      requestId: c.get('requestId'),
      timestamp: new Date().toISOString(),
    },
  }, status);
}
