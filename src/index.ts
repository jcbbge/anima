/**
 * Anima Server
 * 
 * Application and server startup combined.
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { serve } from 'bun';
import memoriesRoutes from './memory.ts';
import { getConfig, displayConfig, testConnection, gracefulShutdown } from './config.ts';

const config = getConfig();

// ============================================================================
// App
// ============================================================================

const app = new Hono();

app.use("*", requestId());
app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "anima",
    version: "1.0.0",
  });
});

app.get("/", (c) => {
  return c.json({
    name: "Anima",
    description: "Memory that persists across conversations",
    version: "1.0.0",
  });
});

const api = new Hono();

api.get("/", (c) => {
  return c.json({
    version: "v1",
    endpoints: {
      "memories/add": "POST /api/v1/memories/add",
      "memories/query": "POST /api/v1/memories/query",
      "memories/bootstrap": "GET /api/v1/memories/bootstrap",
    },
  });
});

api.route("/memories", memoriesRoutes);
app.route("/api/v1", api);

app.notFound((c) => {
  return c.json({ error: "Not Found", path: c.req.path }, 404);
});

app.onError((err, c) => {
  console.error("Error:", err);
  return c.json({ error: "Internal Server Error", message: (err as Error).message }, 500);
});

// ============================================================================
// Server
// ============================================================================

console.log('\n🧬 Anima V1 API Server');
console.log('========================\n');

displayConfig();

try {
  await testConnection();
  console.log('');
} catch (error) {
  console.error('Failed to connect to database. Exiting...\n');
  process.exit(1);
}

const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: '0.0.0.0',
});

console.log(`🚀 Server running on http://localhost:${config.port}`);
console.log(`   Health check: http://localhost:${config.port}/health`);
console.log(`   API: http://localhost:${config.port}/api/v1`);
console.log('\n✨ Ready to receive requests\n');

const shutdown = async () => {
  console.log('\n🛑 Shutting down gracefully...');
  server.stop();
  await gracefulShutdown();
  console.log('✅ Shutdown complete\n');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
