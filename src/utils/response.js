/**
 * Response Utilities
 * 
 * Helper functions for consistent API responses.
 */

/**
 * Create a success response
 * 
 * @param {Object} c - Hono context
 * @param {*} data - Response data
 * @param {number} status - HTTP status code
 * @param {Object} metaOverrides - Additional meta fields
 * @returns {Response} JSON response
 */
export function successResponse(c, data, status = 200, metaOverrides = {}) {
  return c.json(
    {
      success: true,
      data,
      meta: {
        requestId: c.get('requestId'),
        timestamp: new Date().toISOString(),
        ...metaOverrides,
      },
    },
    status
  );
}

/**
 * Create an error response
 * 
 * @param {Object} c - Hono context
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {number} status - HTTP status code
 * @param {Object} details - Additional error details
 * @returns {Response} JSON response
 */
export function errorResponse(c, code, message, status = 500, details = {}) {
  return c.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(Object.keys(details).length > 0 && { details }),
      },
      meta: {
        requestId: c.get('requestId'),
        timestamp: new Date().toISOString(),
      },
    },
    status
  );
}

/**
 * Create a validation error response
 * 
 * @param {Object} c - Hono context
 * @param {Object} zodError - Zod validation error
 * @returns {Response} JSON response
 */
export function validationErrorResponse(c, zodError) {
  const details = zodError.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

  return errorResponse(
    c,
    'VALIDATION_ERROR',
    'Request validation failed',
    400,
    { issues: details }
  );
}
