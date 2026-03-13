/**
 * lib/llm.ts
 * Provider-agnostic LLM abstraction for Anima.
 *
 * All providers speak OpenAI-compatible chat completions.
 * Configuration is model-agnostic and dynamically read from:
 *   1. SurrealDB config table (fold_model key) at runtime for synthesis
 *   2. Environment variables for fallback/override
 *   3. Provider-specific defaults if neither is set
 *
 * Supported providers:
 *   ollama       — local Ollama instance (default, free, no key needed)
 *   groq         — Groq cloud (free tier, fast inference)
 *   openrouter   — OpenRouter (30 free models available)
 *
 * Env vars:
 *   SYNTHESIS_PROVIDER   ollama | groq | openrouter  (default: ollama)
 *   SYNTHESIS_MODEL      model ID for synthesis (provider-specific default applied; overridden by config table)
 *   GRADER_PROVIDER      provider for benchmark grader (default: groq)
 *   GRADER_MODEL         model ID for grader (default: llama-3.3-70b-versatile)
 *   OLLAMA_URL           http://localhost:11434
 *   GROQ_API_KEY         required if provider=groq
 *   OPENROUTER_API_KEY   required if provider=openrouter
 */

// ============================================================================
// Provider config
// ============================================================================

export type ProviderID = "ollama" | "groq" | "openrouter";

interface ProviderConfig {
  baseUrl: string;
  defaultModel: string;
  authHeader?: (key: string) => string;
  extraHeaders?: Record<string, string>;
  apiKey?: string;
}

const DEFAULT_MODELS: Record<ProviderID, string> = {
  ollama: "qwen2.5:0.5b",
  groq: "llama-3.1-8b-instant",
  openrouter: "google/gemma-3-12b-it:free",
};

const DEFAULT_GRADER_MODELS: Record<ProviderID, string> = {
  ollama: "qwen2.5:0.5b",   // fallback only — grading with 0.5b is unreliable
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
};

function buildProviderConfig(provider: ProviderID, role: "synthesis" | "grader"): ProviderConfig {
  const ollamaUrl = Deno.env.get("OLLAMA_URL") ?? "http://localhost:8001";
  const groqKey = Deno.env.get("GROQ_API_KEY") ?? "";
  const orKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";

  switch (provider) {
    case "ollama":
      return {
        baseUrl: `${ollamaUrl}/v1`,
        defaultModel: role === "grader" ? DEFAULT_GRADER_MODELS.ollama : DEFAULT_MODELS.ollama,
      };

    case "groq":
      return {
        baseUrl: "https://api.groq.com/openai/v1",
        defaultModel: role === "grader" ? DEFAULT_GRADER_MODELS.groq : DEFAULT_MODELS.groq,
        authHeader: (key) => `Bearer ${key}`,
        apiKey: groqKey,
      };

    case "openrouter":
      return {
        baseUrl: "https://openrouter.ai/api/v1",
        defaultModel: role === "grader" ? DEFAULT_GRADER_MODELS.openrouter : DEFAULT_MODELS.openrouter,
        authHeader: (key) => `Bearer ${key}`,
        apiKey: orKey,
        extraHeaders: {
          "HTTP-Referer": "https://github.com/anima",
          "X-Title": "Anima Memory System",
        },
      };
  }
}

// ============================================================================
// Resolved config (computed at call time)
// ============================================================================

export interface LLMConfig {
  provider: ProviderID;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Read fold_model from SurrealDB config table.
 * Fallback to environment variable if not found.
 * This function reads the configured model name at invocation time,
 * allowing model changes without redeploying the worker.
 */
async function readFoldModelFromConfig(): Promise<string | null> {
  try {
    // Dynamically import to avoid circular dependencies at module load time
    const { query } = await import("./db.ts");
    // Use SELECT * to avoid SurrealDB 3.0 parser quirk with "SELECT value FROM"
    const rows = await query<{ value: string }>(
      `SELECT * FROM fold_config WHERE key = $key LIMIT 1`,
      { key: "fold_model" },
    );
    if (rows.length > 0 && rows[0].value) {
      return rows[0].value;
    }
  } catch (err) {
    // Silently fall back to env var — not critical, system still works
  }
  return null;
}

async function resolveSynthesisConfig(): Promise<LLMConfig> {
  const provider = (Deno.env.get("SYNTHESIS_PROVIDER") ?? "ollama") as ProviderID;

  // Read model from config table first (dynamic, can change at runtime)
  let model = await readFoldModelFromConfig();

  // Fallback: SYNTHESIS_MODEL env var
  if (!model) {
    model = Deno.env.get("SYNTHESIS_MODEL") ?? null;
  }

  // Fallback: provider default
  if (!model) {
    model = DEFAULT_MODELS[provider] ?? DEFAULT_MODELS.ollama;
  }

  return { provider, model, temperature: 0.7, maxTokens: 200 };
}

function resolveGraderConfig(): LLMConfig {
  // Grader uses env-only config (not from config table)
  const provider = (Deno.env.get("GRADER_PROVIDER") ?? "groq") as ProviderID;
  const model = Deno.env.get("GRADER_MODEL") ?? DEFAULT_GRADER_MODELS[provider] ?? DEFAULT_GRADER_MODELS.groq;
  return { provider, model, temperature: 0.2, maxTokens: 400 };
}

// ============================================================================
// Core call
// ============================================================================

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCallOptions {
  config?: LLMConfig;           // explicit config (benchmark use)
  role?: "synthesis" | "grader"; // or resolve from env
  timeoutMs?: number;
}

function isProviderID(value: string): value is ProviderID {
  return value === "ollama" || value === "groq" || value === "openrouter";
}
export async function callLLMRaw(
  messages: ChatMessage[],
  options: LLMCallOptions = {},
): Promise<string | null> {
  let config: LLMConfig;

  if (options.config) {
    config = options.config;
  } else if (options.role === "grader") {
    config = resolveGraderConfig();
  } else {
    // For synthesis, read from config table at call time (model is configurable)
    config = await resolveSynthesisConfig();
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const providerConfig = buildProviderConfig(config.provider, options.role ?? "synthesis");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (providerConfig.apiKey && providerConfig.authHeader) {
    headers["Authorization"] = providerConfig.authHeader(providerConfig.apiKey);
  }

  if (providerConfig.extraHeaders) {
    Object.assign(headers, providerConfig.extraHeaders);
  }

  // Ollama uses /api/chat, not /v1/chat/completions — but we append /v1 to baseUrl above
  // so for ollama we need the OpenAI-compat endpoint (Ollama supports it since 0.1.24)
  const url = `${providerConfig.baseUrl}/chat/completions`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        temperature: config.temperature ?? 0.7,
        max_tokens: config.maxTokens ?? 200,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[anima:llm] ${config.provider}/${config.model} error ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.error(`[anima:llm] ${config.provider}/${config.model} failed: ${(err as Error).message}`);
    return null;
  }
}

// ============================================================================
// Convenience: synthesis call (used by synthesize.ts)
// ============================================================================

/**
 * Call synthesis LLM and return both the content and the model used.
 * This allows fold_log to record which model performed the synthesis.
 */
export async function callSynthesisLLM(
  messages: ChatMessage[],
  timeoutMs = 30_000,
): Promise<{ content: string | null; model: string }> {
  // Primary provider
  const primaryConfig = await resolveSynthesisConfig();
  const primaryResult = await callLLMRaw(messages, { config: primaryConfig, timeoutMs });
  if (primaryResult) {
    return { content: primaryResult, model: primaryConfig.model };
  }

  // Fallback provider
  const fallbackProvider = (Deno.env.get("SYNTHESIS_FALLBACK_PROVIDER") ?? "groq") as ProviderID;
  const fallbackModel = Deno.env.get("SYNTHESIS_FALLBACK_MODEL") ?? DEFAULT_MODELS[fallbackProvider];
  const fallbackConfig: LLMConfig = { provider: fallbackProvider, model: fallbackModel, temperature: 0.7, maxTokens: 200 };
  console.error("[anima:llm] primary provider failed, trying fallback: " + fallbackProvider + "/" + fallbackModel);
  const fallbackResult = await callLLMRaw(messages, { config: fallbackConfig, timeoutMs });
  if (fallbackResult) {
    return { content: fallbackResult, model: fallbackModel };
  }

  // Last resort: local Ollama
  if (primaryConfig.provider !== "ollama" && fallbackProvider !== "ollama") {
    const ollamaConfig: LLMConfig = { provider: "ollama", model: DEFAULT_MODELS.ollama, temperature: 0.7, maxTokens: 200 };
    console.error("[anima:llm] fallback failed, trying local ollama: " + ollamaConfig.model);
    const ollamaResult = await callLLMRaw(messages, { config: ollamaConfig, timeoutMs });
    if (ollamaResult) {
      return { content: ollamaResult, model: ollamaConfig.model };
    }
  }

  // All providers failed
  console.error("[anima:llm] all providers failed — synthesis aborted");
  return { content: null, model: primaryConfig.model };
}

// ============================================================================
// Convenience: grader call (used by benchmark)
// ============================================================================

export async function callGraderLLM(messages: ChatMessage[], timeoutMs = 45_000): Promise<string | null> {
  return callLLMRaw(messages, { role: "grader", timeoutMs });
}

// ============================================================================
// Describe current config (for CLI / benchmark output)
// ============================================================================

export async function describeSynthesisConfig(): Promise<string> {
  const c = await resolveSynthesisConfig();
  return `${c.provider}/${c.model}`;
}

export function describeGraderConfig(): string {
  const c = resolveGraderConfig();
  return `${c.provider}/${c.model}`;
}

export { resolveSynthesisConfig, resolveGraderConfig, buildProviderConfig };
