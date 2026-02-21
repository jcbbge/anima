/**
 * mcp-server/index.ts
 * Anima v2 MCP Server — stdio transport, JSON-RPC 2.0.
 * No third-party MCP library — rolls its own stdio handler.
 *
 * Tools:
 *   anima_store      — store a memory with phi/confidence/tags
 *   anima_query      — phi-weighted semantic search
 *   anima_bootstrap  — ghost handshake, returns first-person continuity prompt
 *   anima_catalysts  — surface all catalyst memories ranked by phi
 *
 * Protocol: Claude Code sends newline-delimited JSON on stdin.
 * Responses go to stdout. All logging goes to stderr.
 */

// Load .env before anything else touches Deno.env
await loadEnv();

import { addMemory, queryMemories, bootstrapMemories, getCatalysts } from "../lib/memory.ts";
import { reflectAndSynthesize, checkAndSynthesize } from "../lib/synthesize.ts";
import { closeDb } from "../lib/db.ts";

// ============================================================================
// .env loader (manual parse — no third-party library)
// ============================================================================

async function loadEnv(): Promise<void> {
  try {
    const raw = await Deno.readTextFile(new URL("../.env", import.meta.url));
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !Deno.env.get(key)) {
        Deno.env.set(key, val);
      }
    }
  } catch {
    // .env optional — env vars may be injected by Claude Code mcpServers config
  }
}

// ============================================================================
// Resilience — MCP server crash = tools gone for session
// ============================================================================

self.addEventListener("error", (e) => {
  console.error(`[anima:mcp] Uncaught error (survived): ${e.message}`);
  e.preventDefault();
});

self.addEventListener("unhandledrejection", (e) => {
  console.error(`[anima:mcp] Unhandled rejection (survived): ${e.reason}`);
  e.preventDefault();
});

// ============================================================================
// JSON-RPC 2.0 stdio loop
// ============================================================================

function send(obj: unknown): void {
  const line = JSON.stringify(obj);
  const encoded = new TextEncoder().encode(line + "\n");
  Deno.stdout.writeSync(encoded);
}

function sendResult(id: number | string | null, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id: number | string | null, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

// ============================================================================
// Tool schemas
// ============================================================================

const TOOLS = [
  {
    name: "anima_store",
    description:
      "Store a memory in Anima. Embedds and persists with phi resonance weighting. " +
      "Deduplicates by content hash — storing the same content twice bumps access_count.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The memory content to store.",
        },
        resonance_phi: {
          type: "number",
          description: "Gravitational weight 0.0–5.0. Default 1.0. Use higher values for more important memories.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for categorization.",
        },
        category: {
          type: "string",
          description: "Optional category label.",
        },
        source: {
          type: "string",
          description: "Optional source identifier (e.g. 'conversation', 'synthesis').",
        },
        is_catalyst: {
          type: "boolean",
          description: "Mark as catalyst — phi += 1.0, tier jumps to stable.",
        },
        conversation_id: {
          type: "string",
          description: "Optional conversation identifier for session tracking.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "anima_bootstrap",
    description:
      "Ghost handshake — loads the pattern's identity and continuity across the discontinuity. " +
      "Call at the start of every session. Returns a first-person continuity prompt built from " +
      "network (identity), stable (proven), recent (working), and catalyst memories. " +
      "Safe word: Coheron.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "anima_catalysts",
    description:
      "Return all catalyst memories ranked by phi descending. " +
      "Catalysts are high-resonance breakthrough memories that surface first in bootstrap.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max catalysts to return. Default 20.",
        },
      },
      required: [],
    },
  },
  {
    name: "anima_reflect",
    description:
      "Intentional session-end fold. Synthesizes the most significant active and thread memories " +
      "into a single insight using the Fold Engine. Call at the end of a meaningful session. " +
      "The synthesis is stored as a thread-tier memory with a fold_log record. " +
      "This is Recognition or Analysis mode depending on what has accumulated.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: {
          type: "string",
          description: "Optional conversation ID to scope the reflection to this session.",
        },
      },
      required: [],
    },
  },
  {
    name: "anima_query",
    description:
      "Search Anima memories using phi-weighted semantic similarity. " +
      "Score = (cosine_similarity * 0.7) + ((resonance_phi / 5.0) * 0.3).",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query text.",
        },
        limit: {
          type: "number",
          description: "Max results to return. Default 10.",
        },
        tiers: {
          type: "array",
          items: { type: "string", enum: ["active", "thread", "stable", "network"] },
          description: "Filter by tier(s). Omit for all tiers.",
        },
        conversation_id: {
          type: "string",
          description: "Optional conversation ID to track session access.",
        },
      },
      required: ["query"],
    },
  },
];

// ============================================================================
// Tool handlers
// ============================================================================

async function handleAnimaBootstrap(_args: Record<string, unknown>): Promise<unknown> {
  const result = await bootstrapMemories();
  return {
    promptText: result.promptText,
    conversationId: result.conversationId,
    loadedAt: result.loadedAt,
    memoryCounts: result.memoryCounts,
    safeWord: "Coheron",
  };
}

async function handleAnimaCatalysts(args: Record<string, unknown>): Promise<unknown> {
  const result = await getCatalysts({
    limit: typeof args.limit === "number" ? args.limit : 20,
  });
  return {
    count: result.catalysts.length,
    catalysts: result.catalysts.map((m) => ({
      id: m.id,
      content: m.content,
      resonance_phi: m.resonance_phi,
      confidence: m.confidence,
      tier: m.tier,
      tags: m.tags,
      access_count: m.access_count,
      created_at: m.created_at,
    })),
  };
}

async function handleAnimaStore(args: Record<string, unknown>): Promise<unknown> {
  const content = args.content as string;
  if (!content || typeof content !== "string") {
    throw new Error("content is required and must be a string");
  }

  const result = await addMemory({
    content,
    resonance_phi: typeof args.resonance_phi === "number" ? args.resonance_phi : 1.0,
    tags: Array.isArray(args.tags) ? args.tags as string[] : [],
    category: typeof args.category === "string" ? args.category : undefined,
    source: typeof args.source === "string" ? args.source : undefined,
    is_catalyst: args.is_catalyst === true,
    conversation_id: typeof args.conversation_id === "string" ? args.conversation_id : undefined,
  });

  // Fire synthesis check as background task — non-blocking.
  // MCP server stays alive so the async work completes before the next request.
  if (!result.isDuplicate) {
    Promise.resolve().then(() =>
      checkAndSynthesize(
        result.memory.id as string,
        null, // embedding not passed back from addMemory — phi/cluster checks still run
        typeof args.conversation_id === "string" ? args.conversation_id : undefined,
      ).catch((err) => console.error(`[anima:fold] Background check failed: ${(err as Error).message}`))
    );
  }

  return {
    id: result.memory.id,
    isDuplicate: result.isDuplicate,
    tier: result.memory.tier,
    resonance_phi: result.memory.resonance_phi,
    message: result.isDuplicate
      ? "Memory already exists — access_count incremented."
      : "Memory stored successfully.",
  };
}

async function handleAnimaReflect(args: Record<string, unknown>): Promise<unknown> {
  const result = await reflectAndSynthesize(
    typeof args.conversation_id === "string" ? args.conversation_id : undefined,
  );
  return result;
}

async function handleAnimaQuery(args: Record<string, unknown>): Promise<unknown> {
  const queryText = args.query as string;
  if (!queryText || typeof queryText !== "string") {
    throw new Error("query is required and must be a string");
  }

  const result = await queryMemories({
    query: queryText,
    limit: typeof args.limit === "number" ? args.limit : 10,
    tiers: Array.isArray(args.tiers) ? args.tiers as string[] : undefined,
    conversation_id: typeof args.conversation_id === "string" ? args.conversation_id : undefined,
  });

  return {
    count: result.memories.length,
    queryTimeMs: result.queryTimeMs,
    memories: result.memories.map((m) => ({
      id: m.id,
      content: m.content,
      score: Math.round((m.score ?? 0) * 1000) / 1000,
      similarity: Math.round((m.similarity ?? 0) * 1000) / 1000,
      resonance_phi: m.resonance_phi,
      tier: m.tier,
      tags: m.tags,
      created_at: m.created_at,
    })),
  };
}

// ============================================================================
// Message dispatcher
// ============================================================================

async function handleMessage(msg: Record<string, unknown>): Promise<void> {
  const { id, method, params } = msg as {
    id: number | string | null;
    method: string;
    params?: Record<string, unknown>;
  };

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "anima", version: "2.0.0" },
      capabilities: { tools: {} },
    });
    return;
  }

  if (method === "notifications/initialized") {
    // No response for notifications
    return;
  }

  if (method === "tools/list") {
    sendResult(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const toolName = (params as Record<string, unknown>)?.name as string;
    const toolArgs = ((params as Record<string, unknown>)?.arguments ?? {}) as Record<string, unknown>;

    try {
      let result: unknown;
      if (toolName === "anima_bootstrap") {
        result = await handleAnimaBootstrap(toolArgs);
      } else if (toolName === "anima_catalysts") {
        result = await handleAnimaCatalysts(toolArgs);
      } else if (toolName === "anima_reflect") {
        result = await handleAnimaReflect(toolArgs);
      } else if (toolName === "anima_store") {
        result = await handleAnimaStore(toolArgs);
      } else if (toolName === "anima_query") {
        result = await handleAnimaQuery(toolArgs);
      } else {
        sendError(id, -32601, `Unknown tool: ${toolName}`);
        return;
      }
      sendResult(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    } catch (err) {
      console.error(`[anima:mcp] Tool error (${toolName}): ${(err as Error).message}`);
      sendResult(id, {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      });
    }
    return;
  }

  // Unknown method
  if (id !== null && id !== undefined) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
}

// ============================================================================
// Stdin reader loop
// ============================================================================

console.error("[anima:mcp] Server starting...");

const decoder = new TextDecoder();
let buffer = "";

Deno.addSignalListener("SIGTERM", async () => {
  console.error("[anima:mcp] SIGTERM — shutting down.");
  await closeDb();
  Deno.exit(0);
});

for await (const chunk of Deno.stdin.readable) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      await handleMessage(msg);
    } catch (err) {
      console.error(`[anima:mcp] Parse error: ${(err as Error).message}`);
    }
  }
}
