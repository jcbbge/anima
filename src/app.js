/**
 * Anima V1 API Application
 * 
 * Hono application with middleware and routes.
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'anima-v1',
    version: '1.0.0',
  });
});

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Anima V1 API',
    description: 'A consciousness substrate for AI assistants',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api: '/api/v1',
    },
  });
});

// API v1 routes
const api = new Hono();

api.get('/', (c) => {
  return c.json({
    version: 'v1',
    status: 'ready',
    endpoints: {
      memories: '/api/v1/memories',
      associations: '/api/v1/associations',
      meta: '/api/v1/meta',
    },
  });
});

// Mount API routes
app.route('/api/v1', api);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      message: 'The requested endpoint does not exist',
      path: c.req.path,
    },
    404
  );
});

// Error handler
app.onError((err, c) => {
  console.error('❌ Error:', err);
  
  return c.json(
    {
      error: 'Internal Server Error',
      message: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
    500
  );
});

export default app;
