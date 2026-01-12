/**
 * Request timing middleware
 * Tracks response times and logs slow requests
 */
export function timingMiddleware() {
  return async (c, next) => {
    const start = Date.now();

    await next();

    const duration = Date.now() - start;

    // Add response header
    c.header('X-Response-Time', `${duration}ms`);

    // Log slow requests
    if (duration > 500) {
      console.warn(`[SLOW] ${c.req.method} ${c.req.path} took ${duration}ms`);
    }
  };
}
