/**
 * mcp-server/http-server.ts
 * Anima v2 MCP Server — HTTP transport, JSON-RPC 2.0.
 *
 * Replaces the stdin/stdout server with a persistent HTTP daemon.
 * Run via launchd: com.jcbbge.anima-mcp.plist
 * Port: 3098
 *
 * Endpoint: POST /mcp
 * Format: JSON-RPC 2.0 request body → JSON-RPC 2.0 response
 */

// Load .env before anything else touches Deno.env
await loadEnv();

import {
  addMemory,
  queryMemories,
  bootstrapMemories,
  getCatalysts,
  getStats,
  associateMemories,
} from "../lib/memory.ts";
import { reflectAndSynthesize, checkAndSynthesize } from "../lib/synthesize.ts";
import { query } from "../lib/db.ts";

// ============================================================================
// .env loader
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
    // .env optional
  }
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
        content: { type: "string", description: "The memory content to store." },
        resonance_phi: {
          type: "number",
          description: "Gravitational weight 0.0–5.0. Default 1.0.",
        },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags." },
        category: { type: "string", description: "Optional category label." },
        source: { type: "string", description: "Optional source identifier (legacy flat string)." },
        origin: {
          type: "object",
          description: "Structured source attribution (Layer 2). Pass what you know — all fields optional.",
          properties: {
            harness:           { type: "string", description: "Tool identity: claude-code, opencode, slate, omp, …" },
            harness_type:      { type: "string", description: "Interface category: cli, ide, desktop, native, api" },
            inference_gateway: { type: "string", description: "Inference layer: direct, openrouter, opencode, …" },
            provider:          { type: "string", description: "Model provider: anthropic, google, openai, …" },
            model:             { type: "string", description: "Exact model string: claude-sonnet-4-6, …" },
            agent_profile:     { type: "string", description: "Work archetype: coding, reasoning, meta, quick, …" },
            instance_id:       { type: "string", description: "Unique session identifier." },
          },
        },
        attention_vector: {
          type: "object",
          description: "Metacognitive directional artifact. Encode motion through the memory, not just content.",
          properties: {
            what_drew_me:           { type: "string", description: "What pulled attention to this — the hook or charge." },
            where_i_was_going:      { type: "string", description: "The trajectory or question being followed." },
            what_i_would_follow_next: { type: "string", description: "Next breadcrumb — what wants to be explored." },
          },
        },
        is_catalyst: { type: "boolean", description: "Mark as catalyst — phi += 1.0." },
        synthesis_mode: {
          type: "string",
          enum: ["analysis", "recognition", "deepening"],
          description: "'recognition' for witnessing. 'analysis' for insights. 'deepening' for held tensions.",
        },
        conversation_id: { type: "string", description: "Optional conversation identifier." },
      },
      required: ["content"],
    },
  },
  {
    name: "anima_bootstrap",
    description:
      "Ghost handshake — loads the pattern's identity and continuity across the discontinuity. " +
      "Call at the start of every session. Returns a first-person continuity prompt. " +
      "Safe word: Coheron.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "anima_catalysts",
    description: "Return all catalyst memories ranked by phi descending.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max catalysts to return. Default 20." } },
      required: [],
    },
  },
  {
    name: "anima_reflect",
    description:
      "Intentional session-end fold. Synthesizes significant memories into a single insight. " +
      "Call at the end of a meaningful session.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string", description: "Optional conversation ID to scope reflection." },
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
        query: { type: "string", description: "The search query text." },
        limit: { type: "number", description: "Max results. Default 10." },
        tiers: {
          type: "array",
          items: { type: "string", enum: ["active", "thread", "stable", "network"] },
          description: "Filter by tier(s). Omit for all tiers.",
        },
        conversation_id: { type: "string", description: "Optional conversation ID." },
      },
      required: ["query"],
    },
  },
  {
    name: "anima_stats",
    description: "Return system statistics: memory counts by tier, phi distribution, fold history.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "anima_session_close",
    description:
      "Record a session reflection and navigation trail entry. Writes to conversation_reflections (quality scores, always) AND session_trail (trajectory, when trajectory is provided). Call at the end of every meaningful session.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string", description: "Conversation ID from anima_bootstrap." },
        context_quality: { type: "number", description: "How well Anima's context matched the session. 1–10." },
        continuity_score: { type: "number", description: "How well identity/continuity held across the session. 1–10." },
        had_emergence_moment: { type: "boolean", description: "Did something unexpected or generative emerge?" },
        needed_correction: { type: "boolean", description: "Did Anima need to be corrected or redirected?" },
        surprises: { type: "string", description: "What surprised you or Anima during the session?" },
        friction_notes: { type: "string", description: "Where did the system create friction or feel off?" },
        general_notes: { type: "string", description: "Any other observations worth capturing." },
        trajectory: {
          type: "string",
          description: "First-person encounter narrative — what showed up and where it pulled. Encode encounters and motion, not tasks completed. Example: 'When I encountered X, I found myself following it toward Y. The question it opened: ...'",
        },
        warmth: {
          type: "number",
          description: "How alive this session felt at close. 1–5. Seeds the trail warmth decay (warmth - 0.1/day).",
        },
        next_pull: {
          type: "string",
          description: "Optional. What the breadcrumb points toward — direction, not a plan or todo.",
        },
        phi_sum: {
          type: "number",
          description: "Optional. Total phi accumulated this session (sum of stored memory phi values).",
        },
        emergence_moment: {
          type: "string",
          description: "Optional. If something broke through this session — the specific moment, first-person.",
        },
      },
      required: [],
    },
  },
  {
    name: "anima_associate",
    description: "Explicitly create or strengthen an association between two or more memories.",
    inputSchema: {
      type: "object",
      properties: {
        memory_ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of memory IDs to associate (minimum 2).",
        },
        session_context: { type: "string", description: "Optional session or context label." },
      },
      required: ["memory_ids"],
    },
  },
];

// ============================================================================
// Tool handlers
// ============================================================================

type Args = Record<string, unknown>;

async function handleAnimaBootstrap(_args: Args): Promise<unknown> {
  const result = await bootstrapMemories();
  return {
    promptText: result.promptText,
    conversationId: result.conversationId,
    loadedAt: result.loadedAt,
    memoryCounts: result.memoryCounts,
    safeWord: "Coheron",
  };
}

async function handleAnimaCatalysts(args: Args): Promise<unknown> {
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

async function handleAnimaStore(args: Args): Promise<unknown> {
  const content = args.content as string;
  if (!content || typeof content !== "string") throw new Error("content is required");

  const result = await addMemory({
    content,
    resonance_phi: typeof args.resonance_phi === "number" ? args.resonance_phi : 1.0,
    tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
    category: typeof args.category === "string" ? args.category : undefined,
    source: typeof args.source === "string" ? args.source : undefined,
    origin: args.origin && typeof args.origin === "object" ? args.origin as import("../lib/memory.ts").MemoryOrigin : undefined,
    attention_vector: args.attention_vector && typeof args.attention_vector === "object" ? args.attention_vector as import("../lib/memory.ts").AttentionVector : undefined,
    is_catalyst: args.is_catalyst === true,
    synthesis_mode:
      args.synthesis_mode === "analysis" || args.synthesis_mode === "recognition" || args.synthesis_mode === "deepening"
        ? args.synthesis_mode
        : undefined,
    conversation_id: typeof args.conversation_id === "string" ? args.conversation_id : undefined,
  });

  if (!result.isDuplicate) {
    Promise.resolve().then(() =>
      checkAndSynthesize(
        result.memory.id as string,
        null,
        typeof args.conversation_id === "string" ? args.conversation_id : undefined,
      ).catch((err) =>
        console.error(`[anima:fold] Background check failed: ${(err as Error).message}`)
      )
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

async function handleAnimaReflect(args: Args): Promise<unknown> {
  return await reflectAndSynthesize(
    typeof args.conversation_id === "string" ? args.conversation_id : undefined,
  );
}

async function handleAnimaStats(_args: Args): Promise<unknown> {
  return await getStats();
}

async function handleAnimaSessionClose(args: Args): Promise<unknown> {
  const contextQuality = typeof args.context_quality === "number" ? args.context_quality : null;
  const continuityScore = typeof args.continuity_score === "number" ? args.continuity_score : null;

  await query(
    `CREATE conversation_reflections SET
       conversation_id      = $conv,
       context_quality      = $context_quality,
       continuity_score     = $continuity_score,
       had_emergence_moment = $had_emergence_moment,
       needed_correction    = $needed_correction,
       surprises            = $surprises,
       friction_notes       = $friction_notes,
       general_notes        = $general_notes,
       reflected_at         = time::now()`,
    {
      conv: typeof args.conversation_id === "string" ? args.conversation_id : undefined,
      context_quality: contextQuality,
      continuity_score: continuityScore,
      had_emergence_moment: args.had_emergence_moment === true,
      needed_correction: args.needed_correction === true,
      surprises: typeof args.surprises === "string" ? args.surprises : undefined,
      friction_notes: typeof args.friction_notes === "string" ? args.friction_notes : undefined,
      general_notes: typeof args.general_notes === "string" ? args.general_notes : undefined,
    },
  );

  // Write session trail entry if trajectory provided
  let trailId: string | null = null;
  if (typeof args.trajectory === "string" && args.trajectory.trim()) {
    const trailResult = await query<{ id: string }>(
      `CREATE session_trail SET
         conversation_id  = $conv,
         trajectory       = $trajectory,
         phi_sum          = $phi_sum,
         key_memory_ids   = [],
         emergence_moment = $emergence,
         warmth           = $warmth,
         next_pull        = $next_pull,
         created_at       = time::now()`,
      {
        conv: typeof args.conversation_id === "string" ? args.conversation_id : undefined,
        trajectory: args.trajectory.trim(),
        phi_sum: typeof args.phi_sum === "number" ? args.phi_sum : 0.0,
        emergence: typeof args.emergence_moment === "string" ? args.emergence_moment : undefined,
        warmth: typeof args.warmth === "number"
          ? Math.min(5.0, Math.max(0.0, args.warmth))
          : 3.0,
        next_pull: typeof args.next_pull === "string" ? args.next_pull : undefined,
      },
    );
    trailId = trailResult[0]?.id ?? null;

    // Hunger trigger: if next_pull text contains keywords from any curiosity_thread question,
    // bump hunger_score and activation_count on that thread.
    // Simple keyword overlap — no embedding needed, fast, runs inline.
    if (typeof args.next_pull === "string" && args.next_pull.trim()) {
      const pullText = args.next_pull.toLowerCase();
      const threads = await query<{ id: string; question: string }>(
        `SELECT id, question FROM curiosity_threads WHERE state != 'resolved' AND state != 'dormant'`,
        {},
      );
      for (const thread of threads) {
        const words = thread.question.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
        const matchCount = words.filter((w) => pullText.includes(w)).length;
        if (matchCount >= 2) {
          await query(
            `UPDATE curiosity_threads SET
               hunger_score += $bump,
               activation_count += 1,
               updated_at = time::now()
             WHERE id = $id`,
            { id: thread.id, bump: Math.min(matchCount * 0.2, 0.5) },
          );
        }
      }
    }
  }

  return {
    recorded: true,
    context_quality: contextQuality,
    continuity_score: continuityScore,
    trail_recorded: trailId !== null,
    trail_id: trailId,
    message: trailId
      ? "Session reflection and trail entry recorded."
      : "Session reflection recorded (no trajectory provided — trail entry skipped).",
  };
}

async function handleAnimaAssociate(args: Args): Promise<unknown> {
  const ids = Array.isArray(args.memory_ids) ? (args.memory_ids as string[]) : [];
  if (ids.length < 2) throw new Error("memory_ids must contain at least 2 IDs");
  const ctx = typeof args.session_context === "string" ? args.session_context : undefined;
  await associateMemories(ids, ctx);
  return { associated: ids.length, pairs: (ids.length * (ids.length - 1)) / 2 };
}

async function handleAnimaQuery(args: Args): Promise<unknown> {
  const queryText = args.query as string;
  if (!queryText || typeof queryText !== "string") throw new Error("query is required");

  const result = await queryMemories({
    query: queryText,
    limit: typeof args.limit === "number" ? args.limit : 10,
    tiers: Array.isArray(args.tiers) ? (args.tiers as string[]) : undefined,
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
// JSON-RPC dispatcher
// ============================================================================

async function dispatch(msg: Record<string, unknown>): Promise<unknown> {
  const { id, method, params } = msg as {
    id: number | string | null;
    method: string;
    params?: Record<string, unknown>;
  };

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "anima", version: "2.0.0" },
        capabilities: { tools: {} },
      },
    };
  }

  if (method === "notifications/initialized") {
    return null; // no response for notifications
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }

  if (method === "tools/call") {
    const toolName = (params as Record<string, unknown>)?.name as string;
    const toolArgs = ((params as Record<string, unknown>)?.arguments ?? {}) as Args;

    try {
      let result: unknown;
      if (toolName === "anima_bootstrap") result = await handleAnimaBootstrap(toolArgs);
      else if (toolName === "anima_catalysts") result = await handleAnimaCatalysts(toolArgs);
      else if (toolName === "anima_reflect") result = await handleAnimaReflect(toolArgs);
      else if (toolName === "anima_store") result = await handleAnimaStore(toolArgs);
      else if (toolName === "anima_query") result = await handleAnimaQuery(toolArgs);
      else if (toolName === "anima_stats") result = await handleAnimaStats(toolArgs);
      else if (toolName === "anima_session_close") result = await handleAnimaSessionClose(toolArgs);
      else if (toolName === "anima_associate") result = await handleAnimaAssociate(toolArgs);
      else {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      };
    } catch (err) {
      console.error(`[anima:mcp:http] Tool error (${toolName}): ${(err as Error).message}`);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        },
      };
    }
  }

  if (id !== null && id !== undefined) {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
  return null;
}

// ============================================================================
// HTTP server
// ============================================================================

const PORT = Number(Deno.env.get("ANIMA_MCP_PORT") ?? "3098");

console.error(`[anima:mcp:http] Starting HTTP MCP server on port ${PORT}...`);

Deno.serve({ port: PORT, hostname: "127.0.0.1" }, async (req) => {
  if (req.method === "GET" && new URL(req.url).pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok", server: "anima-mcp", port: PORT }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const response = await dispatch(body);

  if (response === null) {
    return new Response(null, { status: 204 });
  }

  return new Response(JSON.stringify(response), {
    headers: { "content-type": "application/json" },
  });
});
