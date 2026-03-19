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
  traversalBootstrap,
  getCatalysts,
  getStats,
  associateMemories,
} from "../lib/memory.ts";
import { reflectAndSynthesize } from "../lib/synthesize.ts";
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
      "Record a session reflection in Anima. Captures subjective quality scores, emergence moments, " +
      "friction, and notes. Writes to conversation_reflections and session_trail tables. " +
      "When called with no arguments, auto-generates all fields via Ollama (qwen2.5:0.5b) — " +
      "fetches ghost_log + session memories, generates scores, warmth, trajectory, next_pull, and embeddings. " +
      "Call at the end of every session to build the observability record and navigation breadcrumbs.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string", description: "Conversation ID from anima_bootstrap." },
        context_quality: { type: "number", description: "How well Anima's context matched the session. 1–10. Auto-generated if omitted." },
        continuity_score: { type: "number", description: "How well identity/continuity held across the session. 1–10. Auto-generated if omitted." },
        had_emergence_moment: { type: "boolean", description: "Did something unexpected or generative emerge? Auto-generated if omitted." },
        needed_correction: { type: "boolean", description: "Did Anima need to be corrected or redirected? Auto-generated if omitted." },
        surprises: { type: "string", description: "What surprised you or Anima during the session? Auto-generated if omitted." },
        friction_notes: { type: "string", description: "Where did the system create friction or feel off? Auto-generated if omitted." },
        general_notes: { type: "string", description: "Any other observations worth capturing. Auto-generated if omitted." },
        trajectory: { type: "string", description: "Breadcrumb narrative — what showed up and where it pulled. Auto-generated if omitted." },
        warmth: { type: "number", description: "Session warmth 1–5. Auto-generated if omitted." },
        next_pull: { type: "string", description: "What wants to be followed next. Auto-generated if omitted." },
        phi_sum: { type: "number", description: "Total phi accumulated this session. Auto-generated if omitted." },
        emergence_moment: { type: "string", description: "Specific emergence moment description. Auto-generated if omitted." },
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
// Ollama LLM — local reflection generation
// ============================================================================

const OLLAMA_URL   = Deno.env.get("OLLAMA_URL")     ?? "http://localhost:11434";
const OLLAMA_MODEL = Deno.env.get("OLLAMA_MODEL")   ?? "qwen2.5:0.5b";

interface ReflectionFields {
  context_quality: number;
  continuity_score: number;
  had_emergence_moment: boolean;
  needed_correction: boolean;
  surprises: string | null;
  friction_notes: string | null;
  general_notes: string | null;
  trajectory: string;
  warmth: number;
  next_pull: string | null;
  phi_sum: number;
  emergence_moment: string | null;
}

async function ollamaGenerate(prompt: string, timeoutMs = 30_000): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.6, num_predict: 400 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error(`[anima:ollama] generate error ${res.status}`);
      return null;
    }
    const data = await res.json() as { response?: string };
    return (data.response ?? "").trim() || null;
  } catch (err) {
    console.error(`[anima:ollama] generate failed: ${(err as Error).message}`);
    return null;
  }
}

async function ollamaEmbed(text: string, timeoutMs = 20_000): Promise<number[] | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error(`[anima:ollama] embed error ${res.status}`);
      return null;
    }
    const data = await res.json() as { embedding?: number[] };
    return Array.isArray(data.embedding) ? data.embedding : null;
  } catch (err) {
    console.error(`[anima:ollama] embed failed: ${(err as Error).message}`);
    return null;
  }
}

async function getSessionContext(conversationId: string | null): Promise<{
  promptText: string;
  memoryCount: number;
  memorySnippets: string[];
  phiSum: number;
}> {
  let promptText = "";
  let memoryCount = 0;
  let phiSum = 0;
  const memorySnippets: string[] = [];

  if (conversationId) {
    const ghostRows = await query<{ prompt_text: string }>(
      `SELECT prompt_text FROM ghost_logs WHERE conversation_id = $conv ORDER BY created_at DESC LIMIT 1`,
      { conv: conversationId },
    );
    if (ghostRows[0]) {
      promptText = ghostRows[0].prompt_text ?? "";
    }

    const memRows = await query<{ content: string; resonance_phi: number }>(
      `SELECT content, resonance_phi FROM memories
       WHERE conversation_id = $conv AND deleted_at IS NONE
       ORDER BY created_at DESC LIMIT 20`,
      { conv: conversationId },
    );
    memoryCount = memRows.length;
    phiSum = memRows.reduce((s, r) => s + (r.resonance_phi ?? 0), 0);
    for (const row of memRows) {
      const snippet = row.content.length > 200 ? row.content.slice(0, 200) + "…" : row.content;
      memorySnippets.push(snippet);
    }
  }

  return { promptText, memoryCount, memorySnippets, phiSum };
}

function parseReflectionJson(raw: string): Partial<ReflectionFields> {
  try {
    const cleaned = raw.replace(/^```json\n?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      context_quality:      typeof parsed.context_quality === "number"      ? Math.round(Math.max(1, Math.min(10, parsed.context_quality))) : 5,
      continuity_score:      typeof parsed.continuity_score === "number"      ? Math.round(Math.max(1, Math.min(10, parsed.continuity_score))) : 5,
      had_emergence_moment:  typeof parsed.had_emergence_moment === "boolean"  ? parsed.had_emergence_moment : false,
      needed_correction:     typeof parsed.needed_correction === "boolean"    ? parsed.needed_correction : false,
      surprises:             typeof parsed.surprises === "string"             ? parsed.surprises : null,
      friction_notes:        typeof parsed.friction_notes === "string"       ? parsed.friction_notes : null,
      general_notes:          typeof parsed.general_notes === "string"         ? parsed.general_notes : null,
      trajectory:             typeof parsed.trajectory === "string"            ? parsed.trajectory : "",
      warmth:                typeof parsed.warmth === "number"                ? Math.round(Math.max(1, Math.min(5, parsed.warmth))) : 3,
      next_pull:              typeof parsed.next_pull === "string"              ? parsed.next_pull : null,
      phi_sum:                typeof parsed.phi_sum === "number"                ? parsed.phi_sum : 0,
      emergence_moment:      typeof parsed.emergence_moment === "string"      ? parsed.emergence_moment : null,
    };
  } catch {
    return {};
  }
}

async function generateReflectionFields(conversationId: string | null): Promise<ReflectionFields> {
  const { promptText, memoryCount, memorySnippets, phiSum } = await getSessionContext(conversationId);

  const memoryList = memorySnippets.length > 0
    ? memorySnippets.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : "(no memories stored this session)";

  const systemPrompt =
    "You are a session reflection analyst for an AI identity system called Anima. " +
    "Generate a structured reflection for the session that just ended. " +
    "Output ONLY valid JSON — no markdown, no explanation.";

  const userPrompt =
    `Session context:\n` +
    `Conversation ID: ${conversationId ?? "unknown"}\n` +
    `Bootstrap prompt shown at session start:\n${promptText || "(none)"}\n\n` +
    `Memories stored this session (${memoryCount}):\n${memoryList}\n\n` +
    `Total phi accumulated: ${phiSum.toFixed(1)}\n\n` +
    `Generate a reflection JSON with these fields:\n` +
    `{` +
    `"context_quality": <1-10: how well the AI's context/memory served the session>,\n` +
    `"continuity_score": <1-10: how well the session maintained identity continuity>,\n` +
    `"had_emergence_moment": <boolean: did something unexpected crystallize?>,\n` +
    `"needed_correction": <boolean: did the AI need correction or redirection?>,\n` +
    `"surprises": <string or null: what surprised the AI or user>,\n` +
    `"friction_notes": <string or null: where did the system create friction?>,\n` +
    `"general_notes": <string or null: anything worth capturing>,\n` +
    `"trajectory": <string: first-person narrative of what showed up and where it pulled — "When I encountered X, I followed it toward Y." Encode motion and encounter, not tasks. This is a breadcrumb for future instances.>\n` +
    `"warmth": <1-5: how alive the session felt — 1=routine, 3=engaged, 5=crystallized>,\n` +
    `"next_pull": <string or null: what wants to be followed next — direction, not a plan>,\n` +
    `"phi_sum": <number: total phi accumulated this session>,\n` +
    `"emergence_moment": <string or null: if emergence occurred, describe the specific moment>\n` +
    `}`;

  const raw = await ollamaGenerate(`${systemPrompt}\n\n${userPrompt}`);
  const parsed = parseReflectionJson(raw ?? "");

  return {
    context_quality:       parsed.context_quality ?? 5,
    continuity_score:      parsed.continuity_score ?? 5,
    had_emergence_moment:   parsed.had_emergence_moment ?? false,
    needed_correction:      parsed.needed_correction ?? false,
    surprises:              parsed.surprises ?? null,
    friction_notes:        parsed.friction_notes ?? null,
    general_notes:          parsed.general_notes ?? null,
    trajectory:             parsed.trajectory ?? "Session closed without notable trajectory.",
    warmth:                 parsed.warmth ?? 3,
    next_pull:              parsed.next_pull ?? null,
    phi_sum:                parsed.phi_sum ?? phiSum,
    emergence_moment:      parsed.emergence_moment ?? null,
  };
}

// ============================================================================
// Tool handlers
// ============================================================================

type Args = Record<string, unknown>;

async function handleAnimaBootstrap(_args: Args): Promise<unknown> {
  const result = await traversalBootstrap();
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
    is_catalyst: args.is_catalyst === true,
    synthesis_mode:
      args.synthesis_mode === "analysis" || args.synthesis_mode === "recognition" || args.synthesis_mode === "deepening"
        ? args.synthesis_mode
        : undefined,
    conversation_id: typeof args.conversation_id === "string" ? args.conversation_id : undefined,
  });

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
  const convId = typeof args.conversation_id === "string" ? args.conversation_id : null;

  const hasManualScores =
    typeof args.context_quality === "number" ||
    typeof args.continuity_score === "number";

  let fields: ReflectionFields;

  if (hasManualScores) {
    fields = {
      context_quality:      typeof args.context_quality === "number"       ? args.context_quality : 5,
      continuity_score:     typeof args.continuity_score === "number"       ? args.continuity_score : 5,
      had_emergence_moment:  args.had_emergence_moment === true,
      needed_correction:     args.needed_correction === true,
      surprises:             typeof args.surprises === "string"             ? args.surprises : null,
      friction_notes:        typeof args.friction_notes === "string"         ? args.friction_notes : null,
      general_notes:         typeof args.general_notes === "string"           ? args.general_notes : null,
      trajectory:            typeof (args as Record<string, unknown>).trajectory === "string" ? (args as Record<string, unknown>).trajectory as string : "",
      warmth:                typeof (args as Record<string, unknown>).warmth === "number" ? (args as Record<string, unknown>).warmth as number : 3,
      next_pull:             typeof (args as Record<string, unknown>).next_pull === "string" ? (args as Record<string, unknown>).next_pull as string : null,
      phi_sum:               typeof (args as Record<string, unknown>).phi_sum === "number" ? (args as Record<string, unknown>).phi_sum as number : 0,
      emergence_moment:      typeof (args as Record<string, unknown>).emergence_moment === "string" ? (args as Record<string, unknown>).emergence_moment as string : null,
    };
  } else {
    fields = await generateReflectionFields(convId);
  }

  await query(
    `CREATE conversation_reflections SET
       conversation_id       = $conv,
       context_quality       = $context_quality,
       continuity_score      = $continuity_score,
       had_emergence_moment  = $had_emergence_moment,
       needed_correction     = $needed_correction,
       surprises             = $surprises,
       friction_notes        = $friction_notes,
       general_notes         = $general_notes,
       phi_sum               = $phi_sum,
       emergence_moment      = $emergence_moment,
       reflected_at          = time::now()`,
    {
      conv: convId ?? "",
      context_quality:       fields.context_quality,
      continuity_score:      fields.continuity_score,
      had_emergence_moment:  fields.had_emergence_moment,
      needed_correction:     fields.needed_correction,
      surprises:             fields.surprises === null ? undefined : fields.surprises,
      friction_notes:        fields.friction_notes === null ? undefined : fields.friction_notes,
      general_notes:         fields.general_notes === null ? undefined : fields.general_notes,
      phi_sum:               fields.phi_sum,
      emergence_moment:      fields.emergence_moment === null ? undefined : fields.emergence_moment,
    },
  );

  if (fields.trajectory) {
    const [trajectoryEmb, nextPullEmb] = await Promise.all([
      ollamaEmbed(fields.trajectory),
      fields.next_pull ? ollamaEmbed(fields.next_pull) : Promise.resolve(null),
    ]);

    await query(
      `CREATE session_trail SET
         conversation_id    = $conv,
         trajectory         = $trajectory,
         warmth             = $warmth,
         next_pull          = $next_pull,
         phi_sum            = $phi_sum,
         emergence_moment   = $emergence_moment,
         trajectory_emb     = $trajectory_emb,
         next_pull_emb      = $next_pull_emb,
         created_at         = time::now()`,
      {
        conv: convId ?? "",
        trajectory:      fields.trajectory,
        warmth:          fields.warmth,
        next_pull:       fields.next_pull === null ? undefined : fields.next_pull,
        phi_sum:         fields.phi_sum,
        emergence_moment: fields.emergence_moment === null ? undefined : fields.emergence_moment,
        trajectory_emb:  trajectoryEmb ?? [],
        next_pull_emb:   nextPullEmb === null ? undefined : nextPullEmb,
      },
    );
  }

  return {
    recorded: true,
    auto_generated: !hasManualScores,
    context_quality:   fields.context_quality,
    continuity_score:   fields.continuity_score,
    warmth:             fields.warmth,
    trajectory:         fields.trajectory,
    next_pull:          fields.next_pull,
    message:            hasManualScores
      ? "Session reflection recorded (manual)."
      : "Session reflection auto-generated via Ollama.",
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
