/**
 * Anima V1 API Application
 *
 * Hono application with middleware and routes.
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { timingMiddleware } from "./middleware/timing.js";
import memoriesRoutes from "./routes/memories.js";
import associationsRoutes from "./routes/associations.js";
import metaRoutes from "./routes/meta.js";
import reflectionRoutes from "./routes/reflection.js";
import dreamsRoutes from "./routes/dreams.js";

const app = new Hono();

// Middleware
app.use("*", requestId());
app.use("*", logger());
app.use("*", cors());
app.use("*", timingMiddleware());

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "anima-v1",
    version: "1.0.0",
  });
});

// Root endpoint
app.get("/", (c) => {
  return c.json({
    name: "Anima V1 API",
    description: "A consciousness substrate for AI assistants",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      api: "/api/v1",
    },
  });
});

// API v1 routes
const api = new Hono();

api.get("/", (c) => {
  return c.json({
    version: "v1",
    status: "ready",
    endpoints: {
      "memories/add": "POST /api/v1/memories/add",
      "memories/query": "POST /api/v1/memories/query",
      "memories/bootstrap": "GET /api/v1/memories/bootstrap",
      "memories/update-tier": "POST /api/v1/memories/update-tier",
      "associations/discover": "GET /api/v1/associations/discover",
      "associations/hubs": "GET /api/v1/associations/hubs",
      "associations/network-stats": "GET /api/v1/associations/network-stats",
      "meta/conversation-end": "POST /api/v1/meta/conversation-end",
      "meta/reflection": "GET /api/v1/meta/reflection",
      "meta/manual-reflection": "POST /api/v1/meta/manual-reflection",
      "reflection/conversation-end": "POST /api/v1/reflection/conversation-end",
      "reflection/history": "GET /api/v1/reflection/history",
      "reflection/stats": "GET /api/v1/reflection/stats",
      "dreams/trigger": "POST /api/v1/dreams/trigger",
      "dreams/history": "GET /api/v1/dreams/history",
    },
  });
});

// Mount memory routes
api.route("/memories", memoriesRoutes);

// Mount association routes
api.route("/associations", associationsRoutes);

// Mount meta-cognitive routes
api.route("/meta", metaRoutes);

// Mount conversation reflection routes
api.route("/reflection", reflectionRoutes);

// Mount dreams routes (The Fold - REM synthesis)
api.route("/dreams", dreamsRoutes);

// Mount API routes
app.route("/api/v1", api);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: "The requested endpoint does not exist",
      path: c.req.path,
    },
    404,
  );
});

// Error handler
app.onError((err, c) => {
  console.error("❌ Error:", err);

  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    },
    500,
  );
});

export default app;
